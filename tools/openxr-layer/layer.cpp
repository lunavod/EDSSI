// EDSSI's VR cockpit as an OpenXR API layer: in a game that runs on an OpenXR runtime (Virtual
// Desktop's VDXR, with the EDVR mod), it hangs EDSSI's panels as quad layers added to each frame the
// game submits, the way OpenKneeboard does.
//
// It is inert until EDSSI's bridge (edssi-openxr-bridge.exe) is running: it looks for the bridge's
// shared memory (shared.h) now and then, and while there is none every call passes straight
// through. With it, each xrEndFrame copies whichever panel textures have changed into swapchains of
// its own on the game's D3D11 device and appends one layer per panel, head-locked (VIEW space) or
// pinned in the world (LOCAL space), within the system's layer limit: a quad, or a cylinder for a
// curved panel, faded by a colour scale when its alpha is below 1. The cylinder and colour scale
// extensions are enabled on the instance by this layer when the runtime has them; without them
// panels stay flat and opaque. It also works out which panel the head is turned towards and writes
// that back for the tuning keys.
//
// Only D3D11 sessions are dressed; any other graphics binding is passed through untouched.
// Logs to openxr-layer.log beside the DLL.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <d3d11_1.h>
#include <dxgi1_2.h>

#define XR_USE_GRAPHICS_API_D3D11
#define XR_USE_PLATFORM_WIN32
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>
#include <openxr/openxr_loader_negotiation.h>

#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "pose.h"
#include "shared.h"

using namespace edssi_xr;

namespace {

constexpr const char *kLayerName = "XR_APILAYER_EDSSI_cockpit";
/** How often, in frames, to look for the bridge while it isn't there. */
constexpr uint64_t kLookEvery = 90;

HMODULE g_module = nullptr;
// The runtime has these and the layer enabled them on the instance.
bool g_cylinder = false;
bool g_colorScale = false;
std::mutex g_lock;  // every hook below holds it; the game's calls are few and short

// The next layer down (or the runtime).
PFN_xrGetInstanceProcAddr g_next = nullptr;
PFN_xrDestroyInstance g_destroyInstance = nullptr;
PFN_xrCreateSession g_createSession = nullptr;
PFN_xrDestroySession g_destroySession = nullptr;
PFN_xrEndFrame g_endFrame = nullptr;
PFN_xrGetSystemProperties g_getSystemProperties = nullptr;
PFN_xrCreateReferenceSpace g_createReferenceSpace = nullptr;
PFN_xrDestroySpace g_destroySpace = nullptr;
PFN_xrLocateSpace g_locateSpace = nullptr;
PFN_xrEnumerateSwapchainFormats g_enumerateSwapchainFormats = nullptr;
PFN_xrCreateSwapchain g_createSwapchain = nullptr;
PFN_xrDestroySwapchain g_destroySwapchain = nullptr;
PFN_xrEnumerateSwapchainImages g_enumerateSwapchainImages = nullptr;
PFN_xrAcquireSwapchainImage g_acquireSwapchainImage = nullptr;
PFN_xrWaitSwapchainImage g_waitSwapchainImage = nullptr;
PFN_xrReleaseSwapchainImage g_releaseSwapchainImage = nullptr;

// ---------------------------------------------------------------------------------------------
// Log

std::wstring BesideModule(const wchar_t *name) {
  wchar_t path[MAX_PATH];
  DWORD length = GetModuleFileNameW(g_module, path, MAX_PATH);
  std::wstring result(path, length);
  return result.substr(0, result.find_last_of(L"\\/") + 1) + name;
}

void Log(const char *format, ...) {
  char message[1024];
  va_list args;
  va_start(args, format);
  vsnprintf(message, sizeof message, format, args);
  va_end(args);
  static std::wstring path = BesideModule(L"openxr-layer.log");
  static bool trimmed = false;
  if (!trimmed) {
    // One log for every program that loads the layer: start it afresh once it is large.
    trimmed = true;
    WIN32_FILE_ATTRIBUTE_DATA data;
    if (GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data) &&
        data.nFileSizeLow > 2 * 1024 * 1024) {
      DeleteFileW(path.c_str());
    }
  }
  SYSTEMTIME now;
  GetLocalTime(&now);
  FILE *file = _wfopen(path.c_str(), L"a");
  if (file == nullptr) return;
  fprintf(file, "%04u-%02u-%02u %02u:%02u:%02u.%03u [%lu] %s\n", now.wYear, now.wMonth, now.wDay,
          now.wHour, now.wMinute, now.wSecond, now.wMilliseconds, GetCurrentProcessId(), message);
  fclose(file);
}

std::string ExeName() {
  char path[MAX_PATH];
  DWORD length = GetModuleFileNameA(nullptr, path, MAX_PATH);
  return std::string(path, length);
}

template <typename T>
void Release(T *&p) {
  if (p != nullptr) p->Release();
  p = nullptr;
}

// ---------------------------------------------------------------------------------------------
// The bridge's shared memory

struct Bridge {
  HANDLE mapping = nullptr;
  Shared *shared = nullptr;
  uint64_t lastLook = 0;
  bool announced = false;

  bool Open(uint64_t frame) {
    if (shared != nullptr) {
      // A bridge that has gone leaves its block behind for as long as we hold it; let go of it
      // when the process that wrote it is no longer there, so a new bridge's block is found.
      if (frame % kLookEvery == 0) {
        HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, shared->bridgePid);
        bool alive = process != nullptr && WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
        if (process != nullptr) CloseHandle(process);
        if (!alive) {
          Log("the bridge (pid %u) has gone", shared->bridgePid);
          Close();
        }
      }
      return shared != nullptr;
    }
    if (lastLook != 0 && frame - lastLook < kLookEvery) return false;
    lastLook = frame == 0 ? 1 : frame;
    mapping = OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, kMappingName);
    if (mapping == nullptr) return false;
    shared = static_cast<Shared *>(MapViewOfFile(mapping, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0,
                                                 sizeof(Shared)));
    if (shared == nullptr || shared->magic != kMagic || shared->version != kVersion) {
      if (!announced) Log("found a cockpit block of another version; leaving it alone");
      announced = true;
      Close();
      return false;
    }
    Log("found the bridge (pid %u)", shared->bridgePid);
    shared->layerPid = static_cast<long>(GetCurrentProcessId());
    return true;
  }

  void Close() {
    if (shared != nullptr) UnmapViewOfFile(shared);
    if (mapping != nullptr) CloseHandle(mapping);
    shared = nullptr;
    mapping = nullptr;
  }

  /** A consistent copy of the bridge's half, or false if it is mid-write too often. */
  bool Snapshot(Shared &out) const {
    for (int attempt = 0; attempt < 8; attempt++) {
      long before = shared->sequence;
      if (before & 1) {
        YieldProcessor();
        continue;
      }
      MemoryBarrier();
      memcpy(&out, shared, offsetof(Shared, layerPid));
      MemoryBarrier();
      if (shared->sequence == before) return true;
    }
    return false;
  }

  void Problem(const char *text) {
    if (shared == nullptr) return;
    strncpy_s(shared->problem, text, _TRUNCATE);
    InterlockedIncrement(&shared->layerProblem);
  }
};

// ---------------------------------------------------------------------------------------------
// A session and its panels

struct Slot {
  std::wstring name;
  uint32_t generation = 0;
  ID3D11Texture2D *source = nullptr;
  IDXGIKeyedMutex *mutex = nullptr;
  XrSwapchain swapchain = XR_NULL_HANDLE;
  std::vector<ID3D11Texture2D *> images;
  uint32_t width = 0, height = 0;
  uint32_t copied = 0;
  bool ready = false;  // the swapchain has a released image worth showing
  bool failed = false;

  void Clear() {
    Release(source);
    Release(mutex);
    if (swapchain != XR_NULL_HANDLE) g_destroySwapchain(swapchain);
    swapchain = XR_NULL_HANDLE;
    images.clear();  // owned by the swapchain
    width = height = 0;
    ready = false;
    name.clear();
    generation = 0;
    copied = 0;
    failed = false;
  }
};

struct Session {
  XrSession handle = XR_NULL_HANDLE;
  ID3D11Device *device = nullptr;
  ID3D11Device1 *device1 = nullptr;
  ID3D11DeviceContext *context = nullptr;
  ID3D10Multithread *multithread = nullptr;
  XrSpace view = XR_NULL_HANDLE, local = XR_NULL_HANDLE;
  int64_t format = 0;
  uint32_t maxLayers = 16;
  Slot slots[kMaxPanels];
  uint64_t frames = 0;
  bool usable = false;
  bool setUp = false;
  bool haveAnchor = false;
  bool anchorRefused = false;
  Mat34 anchor{};
  int32_t pinnedFor = INT32_MIN;
  std::string gazing;
  // One per panel this frame; reserved up front, so the pointers into it hold for the frame.
  struct PanelLayer {
    union {
      XrCompositionLayerBaseHeader header;
      XrCompositionLayerQuad quad;
      XrCompositionLayerCylinderKHR cylinder;
    };
    XrCompositionLayerColorScaleBiasKHR scale;
  };
  std::vector<PanelLayer> quads;
  std::vector<const XrCompositionLayerBaseHeader *> layers;
};

std::map<XrSession, Session *> g_sessions;
Bridge g_bridge;
XrInstance g_instance = XR_NULL_HANDLE;

void DropSession(Session *s) {
  for (auto &slot : s->slots) slot.Clear();
  if (s->view != XR_NULL_HANDLE) g_destroySpace(s->view);
  if (s->local != XR_NULL_HANDLE) g_destroySpace(s->local);
  Release(s->multithread);
  Release(s->context);
  Release(s->device1);
  Release(s->device);
  delete s;
}

/** Makes sure the slot holds the bridge's current texture for the panel and a swapchain to match. */
bool Prepare(Session &s, Slot &slot, const SharedPanel &panel, int index) {
  std::wstring name(panel.texture, wcsnlen(panel.texture, kNameChars));
  if (name.empty()) return false;
  if (slot.name == name && slot.generation == panel.generation && slot.source != nullptr) {
    return true;
  }
  if (slot.failed && slot.name == name && slot.generation == panel.generation) return false;

  bool sizeChanged = slot.width != panel.width || slot.height != panel.height;
  Release(slot.source);
  Release(slot.mutex);
  slot.name = name;
  slot.generation = panel.generation;
  slot.copied = 0;
  slot.failed = true;  // until it works

  HRESULT hr = s.device1->OpenSharedResourceByName(
      name.c_str(), DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
      __uuidof(ID3D11Texture2D), reinterpret_cast<void **>(&slot.source));
  if (FAILED(hr)) {
    Log("panel %d (%s): could not open its texture: 0x%08lx", index, panel.id,
        static_cast<unsigned long>(hr));
    g_bridge.Problem("a panel texture could not be opened on the game's GPU");
    return false;
  }
  slot.source->QueryInterface(__uuidof(IDXGIKeyedMutex), reinterpret_cast<void **>(&slot.mutex));

  if (sizeChanged || slot.swapchain == XR_NULL_HANDLE) {
    if (slot.swapchain != XR_NULL_HANDLE) g_destroySwapchain(slot.swapchain);
    slot.swapchain = XR_NULL_HANDLE;
    slot.images.clear();
    slot.ready = false;
    XrSwapchainCreateInfo info{XR_TYPE_SWAPCHAIN_CREATE_INFO};
    info.usageFlags = XR_SWAPCHAIN_USAGE_TRANSFER_DST_BIT | XR_SWAPCHAIN_USAGE_SAMPLED_BIT |
                      XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT;
    info.format = s.format;
    info.sampleCount = 1;
    info.width = panel.width;
    info.height = panel.height;
    info.faceCount = 1;
    info.arraySize = 1;
    info.mipCount = 1;
    XrResult result = g_createSwapchain(s.handle, &info, &slot.swapchain);
    if (XR_FAILED(result)) {
      Log("panel %d (%s): xrCreateSwapchain %ux%u -> %d", index, panel.id, panel.width,
          panel.height, static_cast<int>(result));
      g_bridge.Problem("the runtime would not make a swapchain for a panel");
      slot.swapchain = XR_NULL_HANDLE;
      return false;
    }
    uint32_t count = 0;
    g_enumerateSwapchainImages(slot.swapchain, 0, &count, nullptr);
    std::vector<XrSwapchainImageD3D11KHR> images(count, {XR_TYPE_SWAPCHAIN_IMAGE_D3D11_KHR});
    g_enumerateSwapchainImages(slot.swapchain, count, &count,
                               reinterpret_cast<XrSwapchainImageBaseHeader *>(images.data()));
    for (auto &image : images) slot.images.push_back(image.texture);
    slot.width = panel.width;
    slot.height = panel.height;
    Log("panel %d (%s): %ux%u, %u swapchain images", index, panel.id, panel.width, panel.height,
        count);
  }
  slot.failed = false;
  return true;
}

/** Copies the panel's latest frame into the next swapchain image, if there is a new one. */
void Refresh(Session &s, Slot &slot, const SharedPanel &panel) {
  if (slot.ready && slot.copied == panel.frame) return;
  if (panel.frame == 0) return;
  // Never wait on the bridge: a frame it is still writing is picked up next time round.
  if (slot.mutex != nullptr && slot.mutex->AcquireSync(0, 0) != S_OK) return;

  uint32_t index = 0;
  XrSwapchainImageAcquireInfo acquire{XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
  if (XR_SUCCEEDED(g_acquireSwapchainImage(slot.swapchain, &acquire, &index))) {
    XrSwapchainImageWaitInfo wait{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
    wait.timeout = 50'000'000;  // 50 ms
    if (XR_SUCCEEDED(g_waitSwapchainImage(slot.swapchain, &wait)) && index < slot.images.size()) {
      D3D11_BOX box{0, 0, 0, slot.width, slot.height, 1};
      s.context->CopySubresourceRegion(slot.images[index], 0, 0, 0, 0, slot.source, 0, &box);
      slot.copied = panel.frame;
      slot.ready = true;
    }
    XrSwapchainImageReleaseInfo release{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
    g_releaseSwapchainImage(slot.swapchain, &release);
  }
  if (slot.mutex != nullptr) slot.mutex->ReleaseSync(0);
}

bool Locate(Session &s, XrTime time, Mat34 &head) {
  XrSpaceLocation location{XR_TYPE_SPACE_LOCATION};
  if (XR_FAILED(g_locateSpace(s.view, s.local, time, &location))) return false;
  const XrSpaceLocationFlags needed =
      XR_SPACE_LOCATION_ORIENTATION_VALID_BIT | XR_SPACE_LOCATION_POSITION_VALID_BIT;
  if ((location.locationFlags & needed) != needed) return false;
  head = MatrixFromPose(location.pose);
  return true;
}

/** The quads for this frame, appended after the game's own layers. */
void Dress(Session &s, const XrFrameEndInfo *info) {
  s.quads.clear();
  s.quads.reserve(kMaxPanels);
  Shared rig;
  if (!g_bridge.Snapshot(rig) || !rig.visible) return;
  InterlockedExchange(&g_bridge.shared->layerPid, static_cast<long>(GetCurrentProcessId()));

  bool world = rig.lock == kLockWorld;
  Mat34 head{};
  bool haveHead = false;
  if (world && rig.anchor != s.pinnedFor) {
    haveHead = Locate(s, info->displayTime, head);
    if (haveHead) {
      s.anchor = Upright(head);
      s.haveAnchor = true;
      s.pinnedFor = rig.anchor;
      s.anchorRefused = false;
      Log("pinned at %.2f,%.2f,%.2f", s.anchor.m[3], s.anchor.m[7], s.anchor.m[11]);
    } else if (!s.anchorRefused) {
      s.anchorRefused = true;
      Log("the runtime would not say where the head is; following the head instead");
    }
  }
  bool pinned = world && s.haveAnchor;

  uint32_t room = s.maxLayers > info->layerCount ? s.maxLayers - info->layerCount : 0;
  uint32_t count = std::min(rig.panelCount, kMaxPanels);
  for (uint32_t i = 0; i < count && s.quads.size() < room; i++) {
    const SharedPanel &panel = rig.panels[i];
    Slot &slot = s.slots[i];
    if (!Prepare(s, slot, panel, static_cast<int>(i))) continue;
    Refresh(s, slot, panel);
    if (!slot.ready) continue;

    Mat34 local;
    memcpy(local.m, panel.matrix, sizeof local.m);
    Mat34 placed = pinned ? Concat(s.anchor, local) : local;
    XrSwapchainSubImage image{};
    image.swapchain = slot.swapchain;
    image.imageRect = {{0, 0}, {static_cast<int32_t>(slot.width), static_cast<int32_t>(slot.height)}};
    float width = panel.widthMeters > 0 ? panel.widthMeters : 0.5f;
    float aspect = static_cast<float>(slot.width) / static_cast<float>(slot.height);
    s.quads.emplace_back();
    Session::PanelLayer &out = s.quads.back();
    memset(&out, 0, sizeof out);
    // OpenVR's curvature: the share of a full circle the panel's width wraps (0 flat, 1 closed).
    float curvature = std::min(panel.curvature, 0.95f);
    if (g_cylinder && curvature > 0.001f) {
      XrCompositionLayerCylinderKHR &cylinder = out.cylinder;
      cylinder.type = XR_TYPE_COMPOSITION_LAYER_CYLINDER_KHR;
      cylinder.centralAngle = 2.0f * 3.14159265f * curvature;
      cylinder.radius = width / cylinder.centralAngle;
      cylinder.aspectRatio = aspect;
      // The panel's centre stays where the matrix puts it; the axis is `radius` in front of it
      // (the panel faces +Z, towards the viewer), so the panel bends towards the viewer.
      Mat34 axis = placed;
      float zx = placed.m[2], zy = placed.m[6], zz = placed.m[10];
      float n = std::sqrt(zx * zx + zy * zy + zz * zz);
      if (n < 1e-6f) n = 1.0f;
      axis.m[3] += cylinder.radius * zx / n;
      axis.m[7] += cylinder.radius * zy / n;
      axis.m[11] += cylinder.radius * zz / n;
      cylinder.pose = PoseFromMatrix(axis);
      cylinder.subImage = image;
    } else {
      XrCompositionLayerQuad &quad = out.quad;
      quad.type = XR_TYPE_COMPOSITION_LAYER_QUAD;
      quad.pose = PoseFromMatrix(placed);
      quad.size = {width, width / aspect};
      quad.subImage = image;
    }
    // Shared by both: the header's fields sit at the same offsets.
    XrCompositionLayerQuad &common = out.quad;
    common.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
    common.space = pinned ? s.local : s.view;
    common.eyeVisibility = XR_EYE_VISIBILITY_BOTH;
    // Fading: the texture is premultiplied, so every channel scales.
    float alpha = std::clamp(panel.alpha, 0.0f, 1.0f);
    if (g_colorScale && alpha < 0.999f) {
      out.scale.type = XR_TYPE_COMPOSITION_LAYER_COLOR_SCALE_BIAS_KHR;
      out.scale.colorScale = {alpha, alpha, alpha, alpha};
      out.scale.colorBias = {0, 0, 0, 0};
      out.header.next = &out.scale;
    }
  }
  // Panels the bridge no longer has go, swapchains and all.
  for (uint32_t i = count; i < kMaxPanels; i++) {
    if (s.slots[i].swapchain != XR_NULL_HANDLE || s.slots[i].source != nullptr) s.slots[i].Clear();
  }

  // Which panel the head is turned towards, for the tuning keys.
  if (s.frames % 9 == 0) {
    Mat34 at{};
    bool haveLook = haveHead || Locate(s, info->displayTime, at);
    if (haveHead) at = head;
    if (haveLook) {
      Mat34 origin = pinned ? s.anchor : at;
      float best = kGazeCosine;
      const char *picked = nullptr;
      for (uint32_t i = 0; i < count; i++) {
        const SharedPanel &panel = rig.panels[i];
        if (!panel.gaze || !s.slots[i].ready) continue;
        Mat34 local;
        memcpy(local.m, panel.matrix, sizeof local.m);
        Mat34 placed = Concat(origin, local);
        float cosine = GazeCosine(at, placed.m[3], placed.m[7], placed.m[11]);
        if (cosine > best) {
          best = cosine;
          picked = panel.id;
        }
      }
      if (picked != nullptr && s.gazing != picked) {
        s.gazing = picked;
        strncpy_s(g_bridge.shared->gazeId, picked, _TRUNCATE);
        InterlockedIncrement(&g_bridge.shared->gazeSerial);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Hooks

bool SetUp(Session &s);

XRAPI_ATTR XrResult XRAPI_CALL HookEndFrame(XrSession session, const XrFrameEndInfo *info) {
  std::unique_lock<std::mutex> lock(g_lock);
  auto found = g_sessions.find(session);
  if (found == g_sessions.end() || !found->second->usable || info == nullptr) {
    lock.unlock();
    return g_endFrame(session, info);
  }
  Session &s = *found->second;
  uint64_t frame = s.frames++;
  if (!g_bridge.Open(frame) || !SetUp(s)) {
    lock.unlock();
    return g_endFrame(session, info);
  }

  if (s.multithread != nullptr) s.multithread->Enter();
  Dress(s, info);
  if (s.multithread != nullptr) s.multithread->Leave();

  if (s.quads.empty()) {
    lock.unlock();
    return g_endFrame(session, info);
  }
  if (frame == 0 || s.frames % 5000 == 0 || s.layers.capacity() == 0) {
    Log("frame %llu: the game sent %u layer(s); adding %zu panel(s)",
        static_cast<unsigned long long>(frame), info->layerCount, s.quads.size());
  }
  InterlockedIncrement(&g_bridge.shared->layerFrames);

  s.layers.assign(info->layers, info->layers + info->layerCount);
  for (auto &panel : s.quads) s.layers.push_back(&panel.header);
  XrFrameEndInfo dressed = *info;
  dressed.layerCount = static_cast<uint32_t>(s.layers.size());
  dressed.layers = s.layers.data();
  lock.unlock();
  return g_endFrame(session, &dressed);
}

XRAPI_ATTR XrResult XRAPI_CALL HookCreateSession(XrInstance instance,
                                                 const XrSessionCreateInfo *createInfo,
                                                 XrSession *session) {
  XrResult result = g_createSession(instance, createInfo, session);
  if (XR_FAILED(result)) return result;

  const XrGraphicsBindingD3D11KHR *binding = nullptr;
  for (auto *next = static_cast<const XrBaseInStructure *>(createInfo->next); next != nullptr;
       next = next->next) {
    if (next->type == XR_TYPE_GRAPHICS_BINDING_D3D11_KHR) {
      binding = reinterpret_cast<const XrGraphicsBindingD3D11KHR *>(next);
    } else {
      Log("xrCreateSession: chained struct %d", static_cast<int>(next->type));
    }
  }
  std::lock_guard<std::mutex> lock(g_lock);
  if (binding == nullptr || binding->device == nullptr) {
    Log("xrCreateSession: not a D3D11 session; the cockpit stays out of it");
    return result;
  }

  auto *s = new Session();
  s->handle = *session;
  s->device = binding->device;
  s->device->AddRef();
  s->device->GetImmediateContext(&s->context);
  s->device->QueryInterface(__uuidof(ID3D11Device1), reinterpret_cast<void **>(&s->device1));
  if (SUCCEEDED(s->context->QueryInterface(__uuidof(ID3D10Multithread),
                                           reinterpret_cast<void **>(&s->multithread)))) {
    if (!s->multithread->GetMultithreadProtected()) Release(s->multithread);
  }

  XrSystemProperties properties{XR_TYPE_SYSTEM_PROPERTIES};
  if (XR_SUCCEEDED(g_getSystemProperties(instance, createInfo->systemId, &properties))) {
    s->maxLayers = properties.graphicsProperties.maxLayerCount;
  }

  // Nothing is asked of the session until the bridge turns up (SetUp): without EDSSI running, the
  // layer touches nothing of the game's beyond noting the device.
  s->usable = s->device1 != nullptr;
  Log("xrCreateSession: D3D11, Device1 %s, multithread-protected %s, max layers %u",
      s->device1 ? "yes" : "no", s->multithread ? "yes" : "no", s->maxLayers);
  g_sessions[*session] = s;
  return result;
}

/** What the panels need of a session, made the first time the bridge is there to fill them. */
bool SetUp(Session &s) {
  if (s.setUp) return s.usable;
  s.setUp = true;
  int64_t formats[128];
  uint32_t count = 0;
  g_enumerateSwapchainFormats(s.handle, 128, &count, formats);
  // Chromium paints BGRA, sRGB-encoded: an _SRGB swapchain shows it as painted, and the copy is
  // allowed because both are B8G8R8A8_TYPELESS underneath.
  for (int64_t wanted : {static_cast<int64_t>(DXGI_FORMAT_B8G8R8A8_UNORM_SRGB),
                         static_cast<int64_t>(DXGI_FORMAT_B8G8R8A8_UNORM)}) {
    if (std::find(formats, formats + count, wanted) != formats + count) {
      s.format = wanted;
      break;
    }
  }

  XrReferenceSpaceCreateInfo space{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
  space.poseInReferenceSpace.orientation.w = 1.0f;
  space.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_VIEW;
  XrResult viewMade = g_createReferenceSpace(s.handle, &space, &s.view);
  space.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL;
  XrResult localMade = g_createReferenceSpace(s.handle, &space, &s.local);

  s.usable = s.format != 0 && XR_SUCCEEDED(viewMade) && XR_SUCCEEDED(localMade);
  Log("session set up: format %lld, spaces %d/%d -> %s", static_cast<long long>(s.format),
      static_cast<int>(viewMade), static_cast<int>(localMade),
      s.usable ? "panels can be hung" : "the cockpit stays out");
  if (!s.usable) g_bridge.Problem("the game's OpenXR session cannot take the panels; see openxr-layer.log");
  if (s.usable) InterlockedIncrement(&g_bridge.shared->layerSessions);
  return s.usable;
}

XRAPI_ATTR XrResult XRAPI_CALL HookDestroySession(XrSession session) {
  {
    std::lock_guard<std::mutex> lock(g_lock);
    auto found = g_sessions.find(session);
    if (found != g_sessions.end()) {
      Log("xrDestroySession after %llu frames", static_cast<unsigned long long>(found->second->frames));
      DropSession(found->second);
      g_sessions.erase(found);
    }
  }
  return g_destroySession(session);
}

XRAPI_ATTR XrResult XRAPI_CALL HookDestroyInstance(XrInstance instance) {
  {
    std::lock_guard<std::mutex> lock(g_lock);
    for (auto &[handle, s] : g_sessions) DropSession(s);
    g_sessions.clear();
    g_bridge.Close();
    g_instance = XR_NULL_HANDLE;
  }
  Log("xrDestroyInstance");
  return g_destroyInstance(instance);
}

XRAPI_ATTR XrResult XRAPI_CALL HookGetInstanceProcAddr(XrInstance instance, const char *name,
                                                       PFN_xrVoidFunction *function) {
  XrResult result = g_next(instance, name, function);
  if (XR_FAILED(result)) return result;
  if (strcmp(name, "xrGetInstanceProcAddr") == 0) {
    *function = reinterpret_cast<PFN_xrVoidFunction>(HookGetInstanceProcAddr);
  } else if (strcmp(name, "xrDestroyInstance") == 0) {
    *function = reinterpret_cast<PFN_xrVoidFunction>(HookDestroyInstance);
  } else if (strcmp(name, "xrCreateSession") == 0) {
    *function = reinterpret_cast<PFN_xrVoidFunction>(HookCreateSession);
  } else if (strcmp(name, "xrDestroySession") == 0) {
    *function = reinterpret_cast<PFN_xrVoidFunction>(HookDestroySession);
  } else if (strcmp(name, "xrEndFrame") == 0) {
    *function = reinterpret_cast<PFN_xrVoidFunction>(HookEndFrame);
  }
  return result;
}

template <typename T>
bool Resolve(XrInstance instance, const char *name, T &slot) {
  PFN_xrVoidFunction function = nullptr;
  g_next(instance, name, &function);
  slot = reinterpret_cast<T>(function);
  return slot != nullptr;
}

XRAPI_ATTR XrResult XRAPI_CALL HookCreateApiLayerInstance(const XrInstanceCreateInfo *info,
                                                          const XrApiLayerCreateInfo *layerInfo,
                                                          XrInstance *instance) {
  XrApiLayerNextInfo *mine = layerInfo->nextInfo;
  if (mine == nullptr || strcmp(mine->layerName, kLayerName) != 0) {
    Log("the chain doesn't start with this layer; giving up");
    return XR_ERROR_INITIALIZATION_FAILED;
  }
  g_next = mine->nextGetInstanceProcAddr;
  XrApiLayerCreateInfo nextLayerInfo = *layerInfo;
  nextLayerInfo.nextInfo = mine->next;

  // Curved and faded panels need two extensions the game didn't ask for: enable them on its
  // instance when the runtime has them (the game can't tell the difference).
  std::vector<std::string> available;
  PFN_xrEnumerateInstanceExtensionProperties enumerate = nullptr;
  if (XR_SUCCEEDED(g_next(XR_NULL_HANDLE, "xrEnumerateInstanceExtensionProperties",
                          reinterpret_cast<PFN_xrVoidFunction *>(&enumerate))) &&
      enumerate != nullptr) {
    uint32_t n = 0;
    if (XR_SUCCEEDED(enumerate(nullptr, 0, &n, nullptr)) && n > 0) {
      std::vector<XrExtensionProperties> props(n, {XR_TYPE_EXTENSION_PROPERTIES});
      if (XR_SUCCEEDED(enumerate(nullptr, n, &n, props.data()))) {
        for (uint32_t i = 0; i < n; i++) available.emplace_back(props[i].extensionName);
      }
    }
  }
  std::vector<const char *> names(info->enabledExtensionNames,
                                  info->enabledExtensionNames + info->enabledExtensionCount);
  auto enable = [&](const char *extension) {
    if (std::find(available.begin(), available.end(), extension) == available.end()) return false;
    for (const char *name : names) {
      if (strcmp(name, extension) == 0) return true;
    }
    names.push_back(extension);
    return true;
  };
  g_cylinder = enable(XR_KHR_COMPOSITION_LAYER_CYLINDER_EXTENSION_NAME);
  g_colorScale = enable(XR_KHR_COMPOSITION_LAYER_COLOR_SCALE_BIAS_EXTENSION_NAME);
  XrInstanceCreateInfo withOurs = *info;
  withOurs.enabledExtensionCount = static_cast<uint32_t>(names.size());
  withOurs.enabledExtensionNames = names.data();
  XrResult result = mine->nextCreateApiLayerInstance(&withOurs, &nextLayerInfo, instance);
  if (XR_FAILED(result) && names.size() != info->enabledExtensionCount) {
    Log("xrCreateInstance with the cylinder / colour scale extensions -> %d; again without",
        static_cast<int>(result));
    g_cylinder = g_colorScale = false;
    result = mine->nextCreateApiLayerInstance(info, &nextLayerInfo, instance);
  }
  Log("runtime extensions: cylinder %s, colour scale %s", g_cylinder ? "yes" : "no",
      g_colorScale ? "yes" : "no");
  Log("xrCreateInstance from \"%s\" (engine \"%s\", API %u.%u) in %s -> %d",
      info->applicationInfo.applicationName, info->applicationInfo.engineName,
      XR_VERSION_MAJOR(info->applicationInfo.apiVersion),
      XR_VERSION_MINOR(info->applicationInfo.apiVersion), ExeName().c_str(),
      static_cast<int>(result));
  if (XR_FAILED(result)) return result;

  bool d3d11 = false;
  for (uint32_t i = 0; i < info->enabledExtensionCount; i++) {
    if (strcmp(info->enabledExtensionNames[i], XR_KHR_D3D11_ENABLE_EXTENSION_NAME) == 0) d3d11 = true;
  }
  bool ok = Resolve(*instance, "xrDestroyInstance", g_destroyInstance) &&
            Resolve(*instance, "xrCreateSession", g_createSession) &&
            Resolve(*instance, "xrDestroySession", g_destroySession) &&
            Resolve(*instance, "xrEndFrame", g_endFrame) &&
            Resolve(*instance, "xrGetSystemProperties", g_getSystemProperties) &&
            Resolve(*instance, "xrCreateReferenceSpace", g_createReferenceSpace) &&
            Resolve(*instance, "xrDestroySpace", g_destroySpace) &&
            Resolve(*instance, "xrLocateSpace", g_locateSpace) &&
            Resolve(*instance, "xrEnumerateSwapchainFormats", g_enumerateSwapchainFormats) &&
            Resolve(*instance, "xrCreateSwapchain", g_createSwapchain) &&
            Resolve(*instance, "xrDestroySwapchain", g_destroySwapchain) &&
            Resolve(*instance, "xrEnumerateSwapchainImages", g_enumerateSwapchainImages) &&
            Resolve(*instance, "xrAcquireSwapchainImage", g_acquireSwapchainImage) &&
            Resolve(*instance, "xrWaitSwapchainImage", g_waitSwapchainImage) &&
            Resolve(*instance, "xrReleaseSwapchainImage", g_releaseSwapchainImage);
  if (!ok) Log("  some function is missing below this layer; it will pass everything through");
  if (!d3d11) Log("  the app did not enable XR_KHR_D3D11_enable; nothing will be hung");
  g_instance = *instance;
  return result;
}

}  // namespace

extern "C" __declspec(dllexport) XrResult XRAPI_CALL xrNegotiateLoaderApiLayerInterface(
    const XrNegotiateLoaderInfo *loaderInfo, const char *layerName,
    XrNegotiateApiLayerRequest *request) {
  if (loaderInfo == nullptr || request == nullptr ||
      loaderInfo->structType != XR_LOADER_INTERFACE_STRUCT_LOADER_INFO ||
      request->structType != XR_LOADER_INTERFACE_STRUCT_API_LAYER_REQUEST ||
      loaderInfo->minInterfaceVersion > XR_CURRENT_LOADER_API_LAYER_VERSION ||
      loaderInfo->maxInterfaceVersion < XR_CURRENT_LOADER_API_LAYER_VERSION) {
    Log("can't speak this loader's interface");
    return XR_ERROR_INITIALIZATION_FAILED;
  }
  (void)layerName;
  request->layerInterfaceVersion = XR_CURRENT_LOADER_API_LAYER_VERSION;
  request->layerApiVersion = XR_API_VERSION_1_0;
  request->getInstanceProcAddr = HookGetInstanceProcAddr;
  request->createApiLayerInstance = HookCreateApiLayerInstance;
  return XR_SUCCESS;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_module = instance;
    DisableThreadLibraryCalls(instance);
  }
  return TRUE;
}
