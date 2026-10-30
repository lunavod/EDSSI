// edssi-openxr-bridge.exe: the OpenXR counterpart of tools/vr-overlay-host. EDSSI runs it the same
// way and speaks the same protocol to it over stdin (src/main/vr/protocol.ts): the rig as JSON, and
// each panel's frame as an NT handle to the texture Chromium painted (or, failing that, as pixels).
//
// It does not talk to any VR runtime. It copies every frame into a texture of its own per panel,
// shared by name with a keyed mutex, and publishes the rig and those names in shared memory
// (shared.h) for the API layer inside the game, which hangs them in the headset. Copying here is
// what lets each of Chromium's textures go straight back: nothing ever reads one after `took`.
//
// Replies on stdout, one JSON object per line, as the OpenVR host does: `ready`, `took`, `want`,
// `gaze`, `layer`, `error`.
//
//   edssi-openxr-bridge.exe --parent <pid>

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <d3d11_1.h>
#include <dxgi1_2.h>

#include <atomic>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "json.h"
#include "shared.h"

using namespace edssi_xr;

namespace {

constexpr uint8_t kMagicByte = 0xED;
constexpr uint8_t kFrame = 1, kState = 2, kTexture = 3;
constexpr uint32_t kMaxPayload = 4096u * 4096u * 4u;
constexpr ULONGLONG kAskEveryMs = 1000;

std::mutex g_out;

std::string Escape(const std::string &text) {
  std::string out;
  for (char c : text) {
    if (c == '"' || c == '\\') out += '\\';
    if (static_cast<unsigned char>(c) < 0x20) continue;
    out += c;
  }
  return out;
}

void Reply(const char *type, const std::string &message, const char *extra = "") {
  std::lock_guard<std::mutex> lock(g_out);
  printf("{\"type\":\"%s\",\"message\":\"%s\"%s}\n", type, Escape(message).c_str(), extra);
  fflush(stdout);
}

struct Message {
  uint8_t kind;
  std::vector<uint8_t> payload;
};

/** Reads framed messages off stdin; a frame or texture newer than one still waiting replaces it. */
struct Mailbox {
  std::mutex lock;
  std::condition_variable ready;
  std::deque<Message> queue;
  bool closed = false;

  void Put(Message m) {
    std::lock_guard<std::mutex> guard(lock);
    queue.push_back(std::move(m));
    ready.notify_one();
  }
  bool Take(Message &m, DWORD waitMs) {
    std::unique_lock<std::mutex> guard(lock);
    if (queue.empty()) ready.wait_for(guard, std::chrono::milliseconds(waitMs));
    if (queue.empty()) return false;
    m = std::move(queue.front());
    queue.pop_front();
    return true;
  }
};

bool ReadExact(HANDLE in, uint8_t *data, size_t length) {
  while (length > 0) {
    DWORD got = 0;
    if (!ReadFile(in, data, static_cast<DWORD>(std::min<size_t>(length, 1 << 20)), &got, nullptr) ||
        got == 0) {
      return false;
    }
    data += got;
    length -= got;
  }
  return true;
}

void ReadLoop(Mailbox *box) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  while (true) {
    uint8_t header[6];
    if (!ReadExact(in, header, 6)) break;
    uint32_t length;
    memcpy(&length, header + 2, 4);
    if (header[0] != kMagicByte || length > kMaxPayload) {
      Reply("error", "the stream from EDSSI lost its place; stopping");
      break;
    }
    Message m{header[1], std::vector<uint8_t>(length)};
    if (length > 0 && !ReadExact(in, m.payload.data(), length)) break;
    box->Put(std::move(m));
  }
  std::lock_guard<std::mutex> guard(box->lock);
  box->closed = true;
  box->ready.notify_one();
}

template <typename T>
void Release(T *&p) {
  if (p != nullptr) p->Release();
  p = nullptr;
}

/** One panel's texture: what the layer copies out of. */
struct Target {
  ID3D11Texture2D *texture = nullptr;
  IDXGIKeyedMutex *mutex = nullptr;
  HANDLE named = nullptr;  // keeps the name alive
  std::wstring name;
  uint32_t width = 0, height = 0, generation = 0, frame = 0;
  bool painted = false;
  ULONGLONG askedAt = 0;
};

struct Bridge {
  DWORD parentPid = 0;
  HANDLE parent = nullptr;
  ID3D11Device *device = nullptr;
  ID3D11Device1 *device1 = nullptr;
  ID3D11DeviceContext *context = nullptr;
  HANDLE mapping = nullptr;
  Shared *shared = nullptr;
  std::map<std::string, Target> targets;
  std::vector<std::string> order;  // the panels, in the order the last state listed them
  uint32_t nextName = 0;
  Json rig;
  bool haveRig = false;
  long seenGaze = 0, seenProblem = 0, seenLayer = 0;

  bool Start(std::string &why) {
    D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
                                   D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, 2, D3D11_SDK_VERSION,
                                   &device, nullptr, &context);
    if (FAILED(hr)) {
      why = "no D3D11 device: " + std::to_string(hr);
      return false;
    }
    device->QueryInterface(__uuidof(ID3D11Device1), reinterpret_cast<void **>(&device1));
    if (device1 == nullptr) {
      why = "the D3D11 device cannot open NT handles";
      return false;
    }
    mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, sizeof(Shared),
                                 kMappingName);
    if (mapping == nullptr) {
      why = "could not make the shared memory: " + std::to_string(GetLastError());
      return false;
    }
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
      why = "another bridge is already running";
      return false;
    }
    shared = static_cast<Shared *>(
        MapViewOfFile(mapping, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, sizeof(Shared)));
    if (shared == nullptr) {
      why = "could not map the shared memory";
      return false;
    }
    memset(shared, 0, sizeof(Shared));
    shared->version = kVersion;
    shared->bridgePid = GetCurrentProcessId();
    MemoryBarrier();
    shared->magic = kMagic;
    return true;
  }

  void BeginWrite() {
    InterlockedIncrement(&shared->sequence);
    MemoryBarrier();
  }
  void EndWrite() {
    MemoryBarrier();
    InterlockedIncrement(&shared->sequence);
  }

  /** Writes the rig and every panel's texture into the shared block. */
  void Publish() {
    BeginWrite();
    if (haveRig) {
      shared->visible = rig["visible"].Truthy(false) ? 1 : 0;
      shared->lock = rig["lock"].text == "world" ? kLockWorld : kLockHead;
      shared->anchor = static_cast<int32_t>(rig["anchor"].Num());
      const Json &panels = rig["panels"];
      order.clear();
      uint32_t count = 0;
      for (const Json &panel : panels.items) {
        if (count >= kMaxPanels) break;
        SharedPanel &out = shared->panels[count];
        const std::string &id = panel["id"].text;
        order.push_back(id);
        memset(out.id, 0, sizeof out.id);
        strncpy_s(out.id, id.c_str(), _TRUNCATE);
        const Json &matrix = panel["matrix"];
        for (int i = 0; i < 12; i++) {
          out.matrix[i] = i < static_cast<int>(matrix.items.size())
                              ? static_cast<float>(matrix.items[i].Num())
                              : (i == 0 || i == 5 || i == 10 ? 1.0f : 0.0f);
        }
        out.widthMeters = static_cast<float>(panel["widthMeters"].Num(0.5));
        out.alpha = static_cast<float>(panel["alpha"].Num(1));
        out.curvature = static_cast<float>(panel["curvature"].Num(0));
        out.gaze = panel["gaze"].Truthy(true) ? 1 : 0;
        auto found = targets.find(id);
        if (found != targets.end() && found->second.painted) {
          const Target &t = found->second;
          wcsncpy_s(out.texture, t.name.c_str(), _TRUNCATE);
          out.width = t.width;
          out.height = t.height;
          out.generation = t.generation;
          out.frame = t.frame;
        } else {
          memset(out.texture, 0, sizeof out.texture);
          out.width = out.height = out.generation = out.frame = 0;
        }
        count++;
      }
      shared->panelCount = count;
    }
    EndWrite();
  }

  /** The panel's texture, made afresh at a new size. */
  Target *Ensure(const std::string &id, uint32_t width, uint32_t height) {
    Target &t = targets[id];
    if (t.texture != nullptr && t.width == width && t.height == height) return &t;
    Release(t.texture);
    Release(t.mutex);
    if (t.named != nullptr) CloseHandle(t.named);
    t.named = nullptr;

    D3D11_TEXTURE2D_DESC desc{};
    desc.Width = width;
    desc.Height = height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
    desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX;
    if (FAILED(device->CreateTexture2D(&desc, nullptr, &t.texture))) {
      Reply("error", id + ": could not make its shared texture");
      return nullptr;
    }
    t.texture->QueryInterface(__uuidof(IDXGIKeyedMutex), reinterpret_cast<void **>(&t.mutex));
    IDXGIResource1 *resource = nullptr;
    t.texture->QueryInterface(__uuidof(IDXGIResource1), reinterpret_cast<void **>(&resource));
    wchar_t name[kNameChars];
    swprintf_s(name, L"Local\\EDSSI-OpenXR-%lu-%u", GetCurrentProcessId(), ++nextName);
    HRESULT hr = resource != nullptr
                     ? resource->CreateSharedHandle(nullptr,
                                                    DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
                                                    name, &t.named)
                     : E_NOINTERFACE;
    Release(resource);
    if (FAILED(hr) || t.mutex == nullptr) {
      Reply("error", id + ": could not share its texture");
      Release(t.texture);
      Release(t.mutex);
      return nullptr;
    }
    t.name = name;
    t.width = width;
    t.height = height;
    t.generation++;
    t.painted = false;
    return &t;
  }

  /**
   * Waits (briefly) for the copy to have run on the GPU. Flushing only starts it, and the frame is
   * handed back to Chromium straight after, which may draw the next one into it at once.
   */
  void Finish() {
    if (finished == nullptr) {
      D3D11_QUERY_DESC desc{D3D11_QUERY_EVENT, 0};
      device->CreateQuery(&desc, &finished);
    }
    if (finished == nullptr) return;
    context->End(finished);
    context->Flush();
    ULONGLONG deadline = GetTickCount64() + 20;
    while (context->GetData(finished, nullptr, 0, D3D11_ASYNC_GETDATA_DONOTFLUSH) == S_FALSE &&
           GetTickCount64() < deadline) {
      YieldProcessor();
    }
  }
  ID3D11Query *finished = nullptr;

  void Painted(Target &t) {
    t.frame++;
    t.painted = true;
    Publish();
  }

  void OnTexture(const std::vector<uint8_t> &p) {
    if (p.empty()) return;
    size_t idLength = p[0];
    if (p.size() < 1 + idLength + 24 + 8) return;
    std::string id(reinterpret_cast<const char *>(p.data() + 1), idLength);
    uint32_t v[6];
    memcpy(v, p.data() + 1 + idLength, 24);
    uint64_t handle;
    memcpy(&handle, p.data() + 1 + idLength + 24, 8);
    uint32_t x = v[0], y = v[1], width = v[2], height = v[3];

    HANDLE local = nullptr;
    ID3D11Texture2D *source = nullptr;
    if (parent != nullptr &&
        DuplicateHandle(parent, reinterpret_cast<HANDLE>(handle), GetCurrentProcess(), &local, 0,
                        FALSE, DUPLICATE_SAME_ACCESS)) {
      device1->OpenSharedResource1(local, __uuidof(ID3D11Texture2D),
                                   reinterpret_cast<void **>(&source));
    }
    if (source != nullptr && width > 0 && height > 0) {
      Target *t = Ensure(id, width, height);
      if (t != nullptr && t->mutex->AcquireSync(0, 200) == S_OK) {
        D3D11_BOX box{x, y, 0, x + width, y + height, 1};
        context->CopySubresourceRegion(t->texture, 0, 0, 0, 0, source, 0, &box);
        t->mutex->ReleaseSync(0);
        Finish();
        Painted(*t);
      }
    } else {
      Reply("error", id + ": its frame could not be opened");
    }
    Release(source);
    if (local != nullptr) CloseHandle(local);
    // Copied (or hopeless): Chromium may have it back.
    Reply("took", id + " " + std::to_string(handle));
  }

  void OnFrame(const std::vector<uint8_t> &p) {
    if (p.empty()) return;
    size_t idLength = p[0];
    if (p.size() < 1 + idLength + 8) return;
    std::string id(reinterpret_cast<const char *>(p.data() + 1), idLength);
    uint32_t width, height;
    memcpy(&width, p.data() + 1 + idLength, 4);
    memcpy(&height, p.data() + 1 + idLength + 4, 4);
    size_t at = 1 + idLength + 8;
    if (width == 0 || height == 0 || p.size() - at != static_cast<size_t>(width) * height * 4) return;
    Target *t = Ensure(id, width, height);
    if (t == nullptr || t->mutex->AcquireSync(0, 200) != S_OK) return;
    context->UpdateSubresource(t->texture, 0, nullptr, p.data() + at, width * 4, 0);
    t->mutex->ReleaseSync(0);
    Painted(*t);
  }

  void OnState(const std::vector<uint8_t> &p) {
    Json parsed = Json::Parse(std::string(p.begin(), p.end()));
    if (parsed.kind != Json::Object) {
      Reply("error", "a state message could not be read");
      return;
    }
    rig = std::move(parsed);
    haveRig = true;
    Publish();
  }

  /** What the layer has said since last time, passed on to EDSSI. */
  void Listen() {
    long layer = shared->layerPid;
    if (layer != seenLayer) {
      seenLayer = layer;
      Reply("layer", "the cockpit is being hung in process " + std::to_string(layer));
    }
    long gaze = shared->gazeSerial;
    if (gaze != seenGaze) {
      seenGaze = gaze;
      char id[kIdBytes];
      memcpy(id, shared->gazeId, kIdBytes);
      id[kIdBytes - 1] = 0;
      Reply("gaze", id);
    }
    long problem = shared->layerProblem;
    if (problem != seenProblem) {
      seenProblem = problem;
      char text[sizeof shared->problem];
      memcpy(text, shared->problem, sizeof text);
      text[sizeof text - 1] = 0;
      Reply("error", std::string("the layer says: ") + text);
    }
  }

  /** Asks EDSSI to paint any listed panel that has no frame yet; see AskForFrames in the host. */
  void AskForFrames() {
    ULONGLONG now = GetTickCount64();
    for (const std::string &id : order) {
      Target &t = targets[id];
      if (t.painted || now - t.askedAt < kAskEveryMs) continue;
      t.askedAt = now;
      Reply("want", id);
    }
  }

  bool Orphaned() const {
    return parent != nullptr && WaitForSingleObject(parent, 0) == WAIT_OBJECT_0;
  }
};

}  // namespace

int wmain(int argc, wchar_t **argv) {
  Bridge bridge;
  for (int i = 1; i + 1 < argc; i++) {
    if (wcscmp(argv[i], L"--parent") == 0) bridge.parentPid = wcstoul(argv[i + 1], nullptr, 10);
  }
  if (bridge.parentPid != 0) {
    bridge.parent = OpenProcess(PROCESS_DUP_HANDLE | SYNCHRONIZE, FALSE, bridge.parentPid);
  }

  std::string why;
  if (!bridge.Start(why)) {
    Reply("unavailable", "the OpenXR bridge could not start: " + why);
    return 1;
  }
  Reply("ready", "the OpenXR bridge is up; the layer in the game hangs the panels.",
        bridge.parent != nullptr ? ",\"textures\":true" : ",\"textures\":false");

  Mailbox box;
  std::thread reader(ReadLoop, &box);
  reader.detach();

  while (true) {
    Message m;
    while (box.Take(m, 50)) {
      if (m.kind == kTexture) bridge.OnTexture(m.payload);
      else if (m.kind == kFrame) bridge.OnFrame(m.payload);
      else if (m.kind == kState) bridge.OnState(m.payload);
    }
    bridge.Listen();
    bridge.AskForFrames();
    bool closed;
    {
      std::lock_guard<std::mutex> guard(box.lock);
      closed = box.closed && box.queue.empty();
    }
    if (closed || bridge.Orphaned()) break;
  }
  // Tell a layer still holding the block that there is nothing to show; it lets go on its own.
  bridge.BeginWrite();
  bridge.shared->visible = 0;
  bridge.shared->panelCount = 0;
  bridge.EndWrite();
  return 0;
}
