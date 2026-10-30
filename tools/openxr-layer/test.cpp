// openxr-layer-test.exe: the layer and the bridge, end to end, with no headset, no runtime and no
// game. It plays every other part itself:
//
// - EDSSI: starts the real edssi-openxr-bridge.exe, feeds it the rig and a "Chromium" texture (an
//   NT-handle texture on a device of its own, the page in a corner of a larger texture) plus two
//   panels sent as pixels, and reads its replies;
// - the loader: negotiates with the real edssi_openxr_layer.dll and chains it onto
// - a fake runtime, here in this file, which owns real D3D11 swapchain textures on the "game's"
//   device, reports a head pose of the test's choosing, and records what each xrEndFrame was given.
//
// It checks the quads the layer adds (space, pose, size, which swapchain), reads their pixels back
// from the swapchain images, and checks pinning in the world, gaze, hiding, the layer limit and
// what happens when the bridge goes. Exit code 0 means every check passed.
//
//   openxr-layer-test.exe        (from out/openxr-layer, beside the DLL and the bridge)

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
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "pose.h"

using namespace edssi_xr;

namespace {

int g_failures = 0;

void Check(bool ok, const char *what) {
  printf("%s %s\n", ok ? "  ok  " : "  FAIL", what);
  if (!ok) g_failures++;
}

bool Near(float a, float b, float eps = 1e-3f) { return std::fabs(a - b) <= eps; }

bool SamePose(const XrPosef &a, const XrPosef &b) {
  bool position = Near(a.position.x, b.position.x) && Near(a.position.y, b.position.y) &&
                  Near(a.position.z, b.position.z);
  float dot = a.orientation.x * b.orientation.x + a.orientation.y * b.orientation.y +
              a.orientation.z * b.orientation.z + a.orientation.w * b.orientation.w;
  return position && Near(std::fabs(dot), 1.0f, 1e-3f);
}

// ---------------------------------------------------------------------------------------------
// The fake runtime

struct FakeSwapchain {
  std::vector<ID3D11Texture2D *> images;
  uint32_t next = 0;
  uint32_t width = 0, height = 0;
  int64_t format = 0;
  int acquired = -1;
  int released = -1;  // the image a layer submitted now would show
};

struct Recorded {
  XrStructureType type;
  XrSpace space;
  XrPosef pose;
  XrExtent2Df size;
  XrSwapchain swapchain;
  XrRect2Di rect;
  int image;  // the swapchain's released image at the time
  // A cylinder is recorded with the pose and size of its surface's centre (as a quad would be),
  // and its own figures here.
  bool cylinder = false;
  float radius = 0, centralAngle = 0, aspect = 0;
  bool scaled = false;  // a colour scale was chained to it
  XrColor4f scale{};
};

struct Fake {
  ID3D11Device *device = nullptr;
  std::map<uintptr_t, FakeSwapchain> swapchains;
  std::map<uintptr_t, XrReferenceSpaceType> spaces;
  uintptr_t nextHandle = 0x1000;
  uint32_t maxLayers = 16;
  Mat34 head{{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0}};
  bool headValid = true;
  std::vector<Recorded> lastFrame;
  uint32_t lastGameLayers = 0;
  std::vector<std::string> enabled;  // the extensions xrCreateInstance was given
  int frames = 0;
  int liveSwapchains = 0;
} g_fake;

XRAPI_ATTR XrResult XRAPI_CALL FakeDestroyInstance(XrInstance) { return XR_SUCCESS; }

XRAPI_ATTR XrResult XRAPI_CALL FakeCreateSession(XrInstance, const XrSessionCreateInfo *info,
                                                 XrSession *session) {
  auto *binding = static_cast<const XrGraphicsBindingD3D11KHR *>(info->next);
  if (binding == nullptr || binding->type != XR_TYPE_GRAPHICS_BINDING_D3D11_KHR) {
    return XR_ERROR_GRAPHICS_DEVICE_INVALID;
  }
  g_fake.device = binding->device;
  *session = reinterpret_cast<XrSession>(g_fake.nextHandle++);
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeDestroySession(XrSession) { return XR_SUCCESS; }

XRAPI_ATTR XrResult XRAPI_CALL FakeGetSystemProperties(XrInstance, XrSystemId,
                                                       XrSystemProperties *p) {
  strcpy_s(p->systemName, "fake headset");
  p->graphicsProperties.maxLayerCount = g_fake.maxLayers;
  p->graphicsProperties.maxSwapchainImageWidth = 4096;
  p->graphicsProperties.maxSwapchainImageHeight = 4096;
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeCreateReferenceSpace(XrSession,
                                                        const XrReferenceSpaceCreateInfo *info,
                                                        XrSpace *space) {
  uintptr_t h = g_fake.nextHandle++;
  g_fake.spaces[h] = info->referenceSpaceType;
  *space = reinterpret_cast<XrSpace>(h);
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeDestroySpace(XrSpace space) {
  g_fake.spaces.erase(reinterpret_cast<uintptr_t>(space));
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeLocateSpace(XrSpace space, XrSpace base, XrTime,
                                               XrSpaceLocation *location) {
  // Only VIEW in LOCAL is asked for.
  if (g_fake.spaces[reinterpret_cast<uintptr_t>(space)] != XR_REFERENCE_SPACE_TYPE_VIEW ||
      g_fake.spaces[reinterpret_cast<uintptr_t>(base)] != XR_REFERENCE_SPACE_TYPE_LOCAL) {
    return XR_ERROR_VALIDATION_FAILURE;
  }
  location->locationFlags =
      g_fake.headValid ? XR_SPACE_LOCATION_ORIENTATION_VALID_BIT | XR_SPACE_LOCATION_POSITION_VALID_BIT
                       : 0;
  location->pose = PoseFromMatrix(g_fake.head);
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeEnumerateSwapchainFormats(XrSession, uint32_t capacity,
                                                             uint32_t *count, int64_t *formats) {
  const int64_t mine[] = {DXGI_FORMAT_R8G8B8A8_UNORM_SRGB, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB,
                          DXGI_FORMAT_R8G8B8A8_UNORM};
  *count = 3;
  if (capacity >= 3) memcpy(formats, mine, sizeof mine);
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeCreateSwapchain(XrSession, const XrSwapchainCreateInfo *info,
                                                   XrSwapchain *swapchain) {
  FakeSwapchain s;
  s.width = info->width;
  s.height = info->height;
  s.format = info->format;
  for (int i = 0; i < 3; i++) {
    D3D11_TEXTURE2D_DESC desc{};
    desc.Width = info->width;
    desc.Height = info->height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = static_cast<DXGI_FORMAT>(info->format);
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
    ID3D11Texture2D *texture = nullptr;
    if (FAILED(g_fake.device->CreateTexture2D(&desc, nullptr, &texture))) {
      return XR_ERROR_SWAPCHAIN_FORMAT_UNSUPPORTED;
    }
    s.images.push_back(texture);
  }
  uintptr_t h = g_fake.nextHandle++;
  g_fake.swapchains[h] = s;
  g_fake.liveSwapchains++;
  *swapchain = reinterpret_cast<XrSwapchain>(h);
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeDestroySwapchain(XrSwapchain swapchain) {
  auto found = g_fake.swapchains.find(reinterpret_cast<uintptr_t>(swapchain));
  if (found == g_fake.swapchains.end()) return XR_ERROR_HANDLE_INVALID;
  for (auto *t : found->second.images) t->Release();
  g_fake.swapchains.erase(found);
  g_fake.liveSwapchains--;
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeEnumerateSwapchainImages(XrSwapchain swapchain,
                                                            uint32_t capacity, uint32_t *count,
                                                            XrSwapchainImageBaseHeader *images) {
  FakeSwapchain &s = g_fake.swapchains[reinterpret_cast<uintptr_t>(swapchain)];
  *count = static_cast<uint32_t>(s.images.size());
  if (capacity == 0) return XR_SUCCESS;
  auto *d3d = reinterpret_cast<XrSwapchainImageD3D11KHR *>(images);
  for (uint32_t i = 0; i < capacity && i < s.images.size(); i++) d3d[i].texture = s.images[i];
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeAcquireSwapchainImage(XrSwapchain swapchain,
                                                         const XrSwapchainImageAcquireInfo *,
                                                         uint32_t *index) {
  FakeSwapchain &s = g_fake.swapchains[reinterpret_cast<uintptr_t>(swapchain)];
  if (s.acquired >= 0) return XR_ERROR_CALL_ORDER_INVALID;
  s.acquired = static_cast<int>(s.next);
  *index = s.next;
  s.next = (s.next + 1) % s.images.size();
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeWaitSwapchainImage(XrSwapchain, const XrSwapchainImageWaitInfo *) {
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeReleaseSwapchainImage(XrSwapchain swapchain,
                                                         const XrSwapchainImageReleaseInfo *) {
  FakeSwapchain &s = g_fake.swapchains[reinterpret_cast<uintptr_t>(swapchain)];
  if (s.acquired < 0) return XR_ERROR_CALL_ORDER_INVALID;
  s.released = s.acquired;
  s.acquired = -1;
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeEndFrame(XrSession, const XrFrameEndInfo *info) {
  g_fake.frames++;
  g_fake.lastFrame.clear();
  g_fake.lastGameLayers = 0;
  if (info->layerCount > g_fake.maxLayers) return XR_ERROR_LAYER_LIMIT_EXCEEDED;
  for (uint32_t i = 0; i < info->layerCount; i++) {
    const XrCompositionLayerBaseHeader *layer = info->layers[i];
    Recorded r{};
    if (layer->type == XR_TYPE_COMPOSITION_LAYER_QUAD) {
      auto *quad = reinterpret_cast<const XrCompositionLayerQuad *>(layer);
      r = {quad->type, quad->space, quad->pose, quad->size, quad->subImage.swapchain,
           quad->subImage.imageRect, -1};
    } else if (layer->type == XR_TYPE_COMPOSITION_LAYER_CYLINDER_KHR) {
      if (std::find(g_fake.enabled.begin(), g_fake.enabled.end(),
                    XR_KHR_COMPOSITION_LAYER_CYLINDER_EXTENSION_NAME) == g_fake.enabled.end()) {
        return XR_ERROR_LAYER_INVALID;  // the extension wasn't enabled
      }
      auto *cyl = reinterpret_cast<const XrCompositionLayerCylinderKHR *>(layer);
      if (!(cyl->radius > 0) || !(cyl->centralAngle > 0) || !(cyl->aspectRatio > 0)) {
        return XR_ERROR_VALIDATION_FAILURE;
      }
      // Back from the axis to the middle of the visible surface: `radius` along -Z.
      Mat34 axis = MatrixFromPose(cyl->pose);
      Mat34 surface = axis;
      surface.m[3] -= cyl->radius * axis.m[2];
      surface.m[7] -= cyl->radius * axis.m[6];
      surface.m[11] -= cyl->radius * axis.m[10];
      float arc = cyl->radius * cyl->centralAngle;
      r = {cyl->type, cyl->space, PoseFromMatrix(surface), {arc, arc / cyl->aspectRatio},
           cyl->subImage.swapchain, cyl->subImage.imageRect, -1};
      r.cylinder = true;
      r.radius = cyl->radius;
      r.centralAngle = cyl->centralAngle;
      r.aspect = cyl->aspectRatio;
    } else {
      g_fake.lastGameLayers++;
      continue;
    }
    for (auto *next = static_cast<const XrBaseInStructure *>(layer->next); next != nullptr;
         next = next->next) {
      if (next->type == XR_TYPE_COMPOSITION_LAYER_COLOR_SCALE_BIAS_KHR) {
        if (std::find(g_fake.enabled.begin(), g_fake.enabled.end(),
                      XR_KHR_COMPOSITION_LAYER_COLOR_SCALE_BIAS_EXTENSION_NAME) ==
            g_fake.enabled.end()) {
          return XR_ERROR_LAYER_INVALID;
        }
        r.scaled = true;
        r.scale = reinterpret_cast<const XrCompositionLayerColorScaleBiasKHR *>(next)->colorScale;
      }
    }
    auto found = g_fake.swapchains.find(reinterpret_cast<uintptr_t>(r.swapchain));
    if (found == g_fake.swapchains.end() || found->second.released < 0) {
      return XR_ERROR_LAYER_INVALID;  // a swapchain with nothing released may not be submitted
    }
    r.image = found->second.released;
    g_fake.lastFrame.push_back(r);
  }
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeEnumerateInstanceExtensionProperties(
    const char *, uint32_t capacity, uint32_t *count, XrExtensionProperties *properties) {
  const char *mine[] = {XR_KHR_D3D11_ENABLE_EXTENSION_NAME,
                        XR_KHR_COMPOSITION_LAYER_CYLINDER_EXTENSION_NAME,
                        XR_KHR_COMPOSITION_LAYER_COLOR_SCALE_BIAS_EXTENSION_NAME};
  *count = 3;
  if (capacity == 0) return XR_SUCCESS;
  if (capacity < 3) return XR_ERROR_SIZE_INSUFFICIENT;
  for (int i = 0; i < 3; i++) {
    strcpy_s(properties[i].extensionName, mine[i]);
    properties[i].extensionVersion = 1;
  }
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeGetInstanceProcAddr(XrInstance, const char *name,
                                                       PFN_xrVoidFunction *function) {
  static const std::map<std::string, PFN_xrVoidFunction> table = {
      {"xrEnumerateInstanceExtensionProperties",
       reinterpret_cast<PFN_xrVoidFunction>(FakeEnumerateInstanceExtensionProperties)},
      {"xrDestroyInstance", reinterpret_cast<PFN_xrVoidFunction>(FakeDestroyInstance)},
      {"xrCreateSession", reinterpret_cast<PFN_xrVoidFunction>(FakeCreateSession)},
      {"xrDestroySession", reinterpret_cast<PFN_xrVoidFunction>(FakeDestroySession)},
      {"xrEndFrame", reinterpret_cast<PFN_xrVoidFunction>(FakeEndFrame)},
      {"xrGetSystemProperties", reinterpret_cast<PFN_xrVoidFunction>(FakeGetSystemProperties)},
      {"xrCreateReferenceSpace", reinterpret_cast<PFN_xrVoidFunction>(FakeCreateReferenceSpace)},
      {"xrDestroySpace", reinterpret_cast<PFN_xrVoidFunction>(FakeDestroySpace)},
      {"xrLocateSpace", reinterpret_cast<PFN_xrVoidFunction>(FakeLocateSpace)},
      {"xrEnumerateSwapchainFormats",
       reinterpret_cast<PFN_xrVoidFunction>(FakeEnumerateSwapchainFormats)},
      {"xrCreateSwapchain", reinterpret_cast<PFN_xrVoidFunction>(FakeCreateSwapchain)},
      {"xrDestroySwapchain", reinterpret_cast<PFN_xrVoidFunction>(FakeDestroySwapchain)},
      {"xrEnumerateSwapchainImages",
       reinterpret_cast<PFN_xrVoidFunction>(FakeEnumerateSwapchainImages)},
      {"xrAcquireSwapchainImage", reinterpret_cast<PFN_xrVoidFunction>(FakeAcquireSwapchainImage)},
      {"xrWaitSwapchainImage", reinterpret_cast<PFN_xrVoidFunction>(FakeWaitSwapchainImage)},
      {"xrReleaseSwapchainImage", reinterpret_cast<PFN_xrVoidFunction>(FakeReleaseSwapchainImage)},
  };
  auto found = table.find(name);
  if (found == table.end()) {
    *function = nullptr;
    return XR_ERROR_FUNCTION_UNSUPPORTED;
  }
  *function = found->second;
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL FakeCreateInstance(const XrInstanceCreateInfo *info,
                                                  const XrApiLayerCreateInfo *, XrInstance *instance) {
  g_fake.enabled.assign(info->enabledExtensionNames,
                        info->enabledExtensionNames + info->enabledExtensionCount);
  *instance = reinterpret_cast<XrInstance>(static_cast<uintptr_t>(0x42));
  return XR_SUCCESS;
}

// ---------------------------------------------------------------------------------------------
// EDSSI's side: the bridge process

struct BridgeProcess {
  PROCESS_INFORMATION pi{};
  HANDLE in = nullptr;   // we write
  HANDLE out = nullptr;  // we read
  std::mutex lock;
  std::vector<std::string> lines;
  std::thread reader;

  bool Start(const std::wstring &exe) {
    SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
    HANDLE childIn, childOut;
    CreatePipe(&childIn, &in, &sa, 1 << 20);
    CreatePipe(&out, &childOut, &sa, 1 << 16);
    SetHandleInformation(in, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(out, HANDLE_FLAG_INHERIT, 0);
    STARTUPINFOW si{sizeof si};
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = childIn;
    si.hStdOutput = childOut;
    si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    std::wstring command = L"\"" + exe + L"\" --parent " + std::to_wstring(GetCurrentProcessId());
    BOOL made = CreateProcessW(nullptr, command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                               nullptr, nullptr, &si, &pi);
    CloseHandle(childIn);
    CloseHandle(childOut);
    if (!made) return false;
    reader = std::thread([this] {
      std::string rest;
      char buffer[4096];
      DWORD got;
      while (ReadFile(out, buffer, sizeof buffer, &got, nullptr) && got > 0) {
        rest.append(buffer, got);
        size_t at;
        while ((at = rest.find('\n')) != std::string::npos) {
          std::lock_guard<std::mutex> guard(lock);
          lines.push_back(rest.substr(0, at));
          rest.erase(0, at + 1);
        }
      }
    });
    return true;
  }

  void Send(uint8_t kind, const std::vector<uint8_t> &payload) {
    std::vector<uint8_t> message(6 + payload.size());
    message[0] = 0xED;
    message[1] = kind;
    uint32_t length = static_cast<uint32_t>(payload.size());
    memcpy(message.data() + 2, &length, 4);
    memcpy(message.data() + 6, payload.data(), payload.size());
    DWORD wrote;
    WriteFile(in, message.data(), static_cast<DWORD>(message.size()), &wrote, nullptr);
  }

  void State(const std::string &json) { Send(2, std::vector<uint8_t>(json.begin(), json.end())); }

  void Texture(const std::string &id, uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t cw,
               uint32_t ch, HANDLE handle) {
    std::vector<uint8_t> p(1 + id.size() + 24 + 8);
    p[0] = static_cast<uint8_t>(id.size());
    memcpy(p.data() + 1, id.data(), id.size());
    uint32_t v[6] = {x, y, w, h, cw, ch};
    memcpy(p.data() + 1 + id.size(), v, 24);
    uint64_t value = reinterpret_cast<uint64_t>(handle);
    memcpy(p.data() + 1 + id.size() + 24, &value, 8);
    Send(3, p);
  }

  void Pixels(const std::string &id, uint32_t w, uint32_t h, uint32_t bgra) {
    std::vector<uint8_t> p(1 + id.size() + 8 + w * h * 4);
    p[0] = static_cast<uint8_t>(id.size());
    memcpy(p.data() + 1, id.data(), id.size());
    memcpy(p.data() + 1 + id.size(), &w, 4);
    memcpy(p.data() + 1 + id.size() + 4, &h, 4);
    for (uint32_t i = 0; i < w * h; i++) memcpy(p.data() + 1 + id.size() + 8 + i * 4, &bgra, 4);
    Send(1, p);
  }

  /** Waits for a reply line containing `text`. */
  bool WaitFor(const std::string &text, DWORD ms = 5000) {
    ULONGLONG end = GetTickCount64() + ms;
    while (GetTickCount64() < end) {
      {
        std::lock_guard<std::mutex> guard(lock);
        for (auto &line : lines) {
          if (line.find(text) != std::string::npos) return true;
        }
      }
      Sleep(10);
    }
    return false;
  }

  void Stop() {
    if (in != nullptr) CloseHandle(in);
    in = nullptr;
    if (pi.hProcess != nullptr) {
      if (WaitForSingleObject(pi.hProcess, 5000) != WAIT_OBJECT_0) TerminateProcess(pi.hProcess, 1);
      CloseHandle(pi.hProcess);
      CloseHandle(pi.hThread);
      pi.hProcess = nullptr;
    }
    if (reader.joinable()) reader.join();
    if (out != nullptr) CloseHandle(out);
    out = nullptr;
  }
};

// ---------------------------------------------------------------------------------------------
// GPU helpers

ID3D11Device *MakeDevice(ID3D11DeviceContext **context) {
  ID3D11Device *device = nullptr;
  D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
                               D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, 2, D3D11_SDK_VERSION,
                               &device, nullptr, context))) {
    return nullptr;
  }
  return device;
}

/** One pixel of a texture, as 0xAARRGGBB-in-BGRA-order (the raw 32 bits). */
uint32_t ReadPixel(ID3D11Device *device, ID3D11Texture2D *texture, uint32_t x, uint32_t y) {
  D3D11_TEXTURE2D_DESC desc;
  texture->GetDesc(&desc);
  desc.Width = 1;
  desc.Height = 1;
  desc.Usage = D3D11_USAGE_STAGING;
  desc.BindFlags = 0;
  desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  desc.MiscFlags = 0;
  ID3D11Texture2D *staging = nullptr;
  device->CreateTexture2D(&desc, nullptr, &staging);
  ID3D11DeviceContext *context = nullptr;
  device->GetImmediateContext(&context);
  D3D11_BOX box{x, y, 0, x + 1, y + 1, 1};
  context->CopySubresourceRegion(staging, 0, 0, 0, 0, texture, 0, &box);
  D3D11_MAPPED_SUBRESOURCE mapped;
  uint32_t value = 0;
  if (SUCCEEDED(context->Map(staging, 0, D3D11_MAP_READ, 0, &mapped))) {
    memcpy(&value, mapped.pData, 4);
    context->Unmap(staging, 0);
  }
  staging->Release();
  context->Release();
  return value;
}

std::wstring HereFile(const wchar_t *name) {
  wchar_t path[MAX_PATH];
  DWORD length = GetModuleFileNameW(nullptr, path, MAX_PATH);
  std::wstring result(path, length);
  return result.substr(0, result.find_last_of(L"\\/") + 1) + name;
}

// ---------------------------------------------------------------------------------------------

void PoseTests() {
  printf("pose.h\n");
  Mat34 identity{{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0}};
  XrPosef p = PoseFromMatrix(identity);
  Check(Near(p.orientation.w, 1) && Near(p.position.z, 0), "identity matrix -> identity pose");

  // 90 degrees about +Y: x -> -z.
  Mat34 yaw{{0, 0, 1, 1, 0, 1, 0, 2, -1, 0, 0, 3}};
  XrPosef q = PoseFromMatrix(yaw);
  Mat34 back = MatrixFromPose(q);
  bool same = true;
  for (int i = 0; i < 12; i++) same = same && Near(back.m[i], yaw.m[i]);
  Check(same, "matrix -> pose -> matrix round trip (yaw 90)");

  Mat34 a = Concat(yaw, identity);
  same = true;
  for (int i = 0; i < 12; i++) same = same && Near(a.m[i], yaw.m[i]);
  Check(same, "Concat with identity");

  // A head pitched down 30 degrees and yawed: upright keeps the yaw and position, drops the pitch.
  float c = std::cos(0.5236f), s = std::sin(0.5236f);
  Mat34 pitched{{1, 0, 0, 5, 0, c, s, 1.5f, 0, -s, c, 2}};
  Mat34 up = Upright(Concat(yaw, pitched));
  Check(Near(up.m[5], 1) && Near(up.m[4], 0) && Near(up.m[6], 0), "Upright: y axis is world up");
  Mat34 headYawed = Concat(yaw, pitched);
  Check(Near(up.m[3], headYawed.m[3]) && Near(up.m[11], headYawed.m[11]), "Upright: keeps the position");
  // Forward of the upright frame is the level part of the head's forward.
  float hx = -headYawed.m[2], hz = -headYawed.m[10];
  float len = std::sqrt(hx * hx + hz * hz);
  Check(Near(-up.m[2], hx / len) && Near(-up.m[10], hz / len), "Upright: faces where the head faces");

  Check(GazeCosine(identity, 0, 0, -1) > 0.99f, "gaze straight ahead");
  Check(GazeCosine(identity, 1, 0, 0) < 0.01f, "gaze to the side");
}

std::string RigJson(bool visible, const char *lock, int anchor) {
  char json[2048];
  snprintf(json, sizeof json,
           "{\"visible\":%s,\"lock\":\"%s\",\"anchor\":%d,\"panels\":["
           "{\"id\":\"main\",\"matrix\":[1,0,0,0.1,0,1,0,0.2,0,0,1,-1],\"widthMeters\":0.8,"
           "\"alpha\":1,\"curvature\":0.1},"
           "{\"id\":\"left\",\"matrix\":[0,0,1,-1,0,1,0,0,-1,0,0,0],\"widthMeters\":0.5,"
           "\"alpha\":1,\"curvature\":0},"
           "{\"id\":\"seam-1\",\"matrix\":[1,0,0,0,0,1,0,-0.3,0,0,1,-1],\"widthMeters\":0.1,"
           "\"alpha\":0.5,\"curvature\":0,\"gaze\":false}]}",
           visible ? "true" : "false", lock, anchor);
  return json;
}

}  // namespace

int wmain() {
  PoseTests();

  printf("bridge + layer + fake runtime\n");
  ID3D11DeviceContext *chromiumContext = nullptr, *gameContext = nullptr;
  ID3D11Device *chromium = MakeDevice(&chromiumContext);
  ID3D11Device *game = MakeDevice(&gameContext);
  if (chromium == nullptr || game == nullptr) {
    printf("  SKIP no hardware D3D11 device\n");
    return 2;
  }

  // "Chromium's" frame: a 64x32 texture with the page in a 40x20 corner at (4,2), drawn in a
  // colour of its own; the padding around it is another colour, which must not show.
  const uint32_t kPage = 0xFF2080C0, kPadding = 0xFF00FF00;  // BGRA bytes as a little-endian word
  D3D11_TEXTURE2D_DESC desc{};
  desc.Width = 64;
  desc.Height = 32;
  desc.MipLevels = 1;
  desc.ArraySize = 1;
  desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  desc.SampleDesc.Count = 1;
  desc.Usage = D3D11_USAGE_DEFAULT;
  desc.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
  desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
  std::vector<uint32_t> pixels(64 * 32, kPadding);
  for (uint32_t y = 2; y < 22; y++)
    for (uint32_t x = 4; x < 44; x++) pixels[y * 64 + x] = kPage;
  D3D11_SUBRESOURCE_DATA data{pixels.data(), 64 * 4, 0};
  ID3D11Texture2D *page = nullptr;
  chromium->CreateTexture2D(&desc, &data, &page);
  IDXGIResource1 *resource = nullptr;
  page->QueryInterface(__uuidof(IDXGIResource1), reinterpret_cast<void **>(&resource));
  HANDLE pageHandle = nullptr;
  resource->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
                               nullptr, &pageHandle);
  chromiumContext->Flush();
  Check(pageHandle != nullptr, "made an NT-handle texture standing in for Chromium's");

  BridgeProcess bridge;
  Check(bridge.Start(HereFile(L"edssi-openxr-bridge.exe")), "started edssi-openxr-bridge.exe");
  Check(bridge.WaitFor("\"ready\"") && bridge.WaitFor("\"textures\":true"), "bridge: ready, textures");
  bridge.State(RigJson(true, "head", 0));
  Check(bridge.WaitFor("\"want\",\"message\":\"main\""), "bridge asks for a frame of a blank panel");
  bridge.Texture("main", 4, 2, 40, 20, 64, 32, pageHandle);
  char took[64];
  snprintf(took, sizeof took, "main %llu", static_cast<unsigned long long>(
                                              reinterpret_cast<uintptr_t>(pageHandle)));
  Check(bridge.WaitFor(took), "bridge gives Chromium's frame back (took)");
  bridge.Pixels("left", 8, 4, 0xFF0000FF);
  bridge.Pixels("seam-1", 4, 2, 0x80FFFFFF);
  Sleep(200);

  // The loader's part.
  HMODULE layer = LoadLibraryW(HereFile(L"edssi_openxr_layer.dll").c_str());
  Check(layer != nullptr, "loaded edssi_openxr_layer.dll");
  if (layer == nullptr) return 1;
  auto negotiate = reinterpret_cast<PFN_xrNegotiateLoaderApiLayerInterface>(
      GetProcAddress(layer, "xrNegotiateLoaderApiLayerInterface"));
  XrNegotiateLoaderInfo loaderInfo{XR_LOADER_INTERFACE_STRUCT_LOADER_INFO,
                                   XR_LOADER_INFO_STRUCT_VERSION,
                                   sizeof(XrNegotiateLoaderInfo),
                                   1,
                                   1,
                                   XR_MAKE_VERSION(1, 0, 0),
                                   XR_MAKE_VERSION(1, 0x3ff, 0xfff)};
  XrNegotiateApiLayerRequest request{XR_LOADER_INTERFACE_STRUCT_API_LAYER_REQUEST,
                                     XR_API_LAYER_INFO_STRUCT_VERSION,
                                     sizeof(XrNegotiateApiLayerRequest)};
  Check(negotiate != nullptr &&
            XR_SUCCEEDED(negotiate(&loaderInfo, "XR_APILAYER_EDSSI_cockpit", &request)),
        "negotiated with the layer");

  XrApiLayerNextInfo next{XR_LOADER_INTERFACE_STRUCT_API_LAYER_NEXT_INFO,
                          XR_API_LAYER_NEXT_INFO_STRUCT_VERSION, sizeof(XrApiLayerNextInfo)};
  strcpy_s(next.layerName, "XR_APILAYER_EDSSI_cockpit");
  next.nextGetInstanceProcAddr = FakeGetInstanceProcAddr;
  next.nextCreateApiLayerInstance = FakeCreateInstance;
  XrApiLayerCreateInfo layerInfo{XR_LOADER_INTERFACE_STRUCT_API_LAYER_CREATE_INFO,
                                 XR_API_LAYER_CREATE_INFO_STRUCT_VERSION,
                                 sizeof(XrApiLayerCreateInfo)};
  layerInfo.nextInfo = &next;
  XrInstanceCreateInfo createInfo{XR_TYPE_INSTANCE_CREATE_INFO};
  strcpy_s(createInfo.applicationInfo.applicationName, "openxr-layer-test");
  createInfo.applicationInfo.apiVersion = XR_MAKE_VERSION(1, 0, 0);
  const char *extensions[] = {XR_KHR_D3D11_ENABLE_EXTENSION_NAME};
  createInfo.enabledExtensionCount = 1;
  createInfo.enabledExtensionNames = extensions;
  XrInstance instance = XR_NULL_HANDLE;
  Check(XR_SUCCEEDED(request.createApiLayerInstance(&createInfo, &layerInfo, &instance)),
        "xrCreateInstance through the layer");

  auto get = request.getInstanceProcAddr;
  PFN_xrCreateSession createSession = nullptr;
  PFN_xrEndFrame endFrame = nullptr;
  PFN_xrDestroySession destroySession = nullptr;
  PFN_xrDestroyInstance destroyInstance = nullptr;
  get(instance, "xrCreateSession", reinterpret_cast<PFN_xrVoidFunction *>(&createSession));
  get(instance, "xrEndFrame", reinterpret_cast<PFN_xrVoidFunction *>(&endFrame));
  get(instance, "xrDestroySession", reinterpret_cast<PFN_xrVoidFunction *>(&destroySession));
  get(instance, "xrDestroyInstance", reinterpret_cast<PFN_xrVoidFunction *>(&destroyInstance));
  Check(endFrame != FakeEndFrame && createSession != FakeCreateSession,
        "the layer hooks xrCreateSession and xrEndFrame");

  XrGraphicsBindingD3D11KHR binding{XR_TYPE_GRAPHICS_BINDING_D3D11_KHR};
  binding.device = game;
  XrSessionCreateInfo sessionInfo{XR_TYPE_SESSION_CREATE_INFO};
  sessionInfo.next = &binding;
  sessionInfo.systemId = 1;
  XrSession session = XR_NULL_HANDLE;
  Check(XR_SUCCEEDED(createSession(instance, &sessionInfo, &session)), "xrCreateSession (D3D11)");

  // The game's own layer: a projection, which the layer must pass on untouched and first.
  XrCompositionLayerProjection projection{XR_TYPE_COMPOSITION_LAYER_PROJECTION};
  const XrCompositionLayerBaseHeader *gameLayers[] = {
      reinterpret_cast<const XrCompositionLayerBaseHeader *>(&projection)};
  auto frames = [&](int count) {
    XrResult last = XR_SUCCESS;
    for (int i = 0; i < count; i++) {
      XrFrameEndInfo info{XR_TYPE_FRAME_END_INFO};
      info.displayTime = 1000 + g_fake.frames;
      info.environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
      info.layerCount = 1;
      info.layers = gameLayers;
      last = endFrame(session, &info);
    }
    return last;
  };
  auto quadFor = [&](float width) -> const Recorded * {
    for (auto &r : g_fake.lastFrame)
      if (Near(r.size.width, width)) return &r;
    return nullptr;
  };
  Check(g_fake.spaces.empty(), "nothing is made in the session before its first frame");
  Check(XR_SUCCEEDED(frames(3)), "frames go through");
  uintptr_t viewSpace = 0, localSpace = 0;
  for (auto &[h, type] : g_fake.spaces) {
    if (type == XR_REFERENCE_SPACE_TYPE_VIEW) viewSpace = h;
    if (type == XR_REFERENCE_SPACE_TYPE_LOCAL) localSpace = h;
  }
  Check(viewSpace != 0 && localSpace != 0, "with the bridge there, the layer made VIEW and LOCAL spaces");
  Check(g_fake.lastGameLayers == 1, "the game's projection layer is still there");
  Check(g_fake.lastFrame.size() == 3, "three panels added as quads");

  const Recorded *main = quadFor(0.8f);
  Check(main != nullptr, "the main panel is there, 0.8 m wide");
  if (main != nullptr) {
    Check(Near(main->size.height, 0.4f), "its height follows the page's aspect (40x20 -> 0.4 m)");
    Check(reinterpret_cast<uintptr_t>(main->space) == viewSpace, "head-locked: in VIEW space");
    XrPosef expected = PoseFromMatrix(Mat34{{1, 0, 0, 0.1f, 0, 1, 0, 0.2f, 0, 0, 1, -1}});
    Check(SamePose(main->pose, expected), "its pose is the matrix EDSSI sent");
    FakeSwapchain &sc = g_fake.swapchains[reinterpret_cast<uintptr_t>(main->swapchain)];
    Check(sc.width == 40 && sc.height == 20, "its swapchain is the page's size, not the texture's");
    Check(sc.format == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, "BGRA sRGB swapchain format chosen");
    uint32_t centre = ReadPixel(game, sc.images[main->image], 20, 10);
    uint32_t corner = ReadPixel(game, sc.images[main->image], 0, 0);
    printf("        centre %08x corner %08x\n", centre, corner);
    Check(centre == kPage && corner == kPage, "its pixels are the page's, without the padding");
    Check(main->rect.extent.width == 40 && main->rect.extent.height == 20, "sub-image rect");
  }
  // Curved and faded: the layer enabled the two extensions (the app asked for D3D11 only); main
  // (curvature 0.1) is a cylinder wrapping a tenth of a circle with its centre where the matrix
  // says (checked above through the surface pose), left (0) a flat quad, seam-1 (alpha 0.5) faded.
  auto enabled = [](const char *name) {
    return std::find(g_fake.enabled.begin(), g_fake.enabled.end(), name) != g_fake.enabled.end();
  };
  Check(enabled(XR_KHR_D3D11_ENABLE_EXTENSION_NAME) &&
            enabled(XR_KHR_COMPOSITION_LAYER_CYLINDER_EXTENSION_NAME) &&
            enabled(XR_KHR_COMPOSITION_LAYER_COLOR_SCALE_BIAS_EXTENSION_NAME),
        "the layer enabled the cylinder and colour scale extensions on the game's instance");
  if (main != nullptr) {
    Check(main->cylinder && Near(main->centralAngle, 2 * 3.14159265f * 0.1f) &&
              Near(main->radius, 0.8f / (2 * 3.14159265f * 0.1f)) && Near(main->aspect, 2.0f),
          "a curved panel is a cylinder (curvature 0.1: 36 degrees, radius 1.27 m, aspect 2)");
    Check(!main->scaled, "an opaque panel has no colour scale");
  }
  const Recorded *seam = quadFor(0.1f);
  Check(seam != nullptr && !seam->cylinder && seam->scaled && Near(seam->scale.r, 0.5f) &&
            Near(seam->scale.a, 0.5f),
        "a panel at alpha 0.5 is faded by a colour scale (premultiplied: every channel 0.5)");
  const Recorded *left = quadFor(0.5f);
  Check(left != nullptr && !left->cylinder, "a flat panel (curvature 0) stays a quad");
  if (left != nullptr) {
    FakeSwapchain &sc = g_fake.swapchains[reinterpret_cast<uintptr_t>(left->swapchain)];
    Check(ReadPixel(game, sc.images[left->image], 3, 2) == 0xFF0000FF,
          "a panel sent as pixels shows them");
  } else {
    Check(false, "the left panel is there");
  }

  // A new frame of the page reaches the headset.
  const uint32_t kPage2 = 0xFF406080;
  for (auto &p : pixels) p = kPage2;
  chromiumContext->UpdateSubresource(page, 0, nullptr, pixels.data(), 64 * 4, 0);
  chromiumContext->Flush();
  bridge.Texture("main", 4, 2, 40, 20, 64, 32, pageHandle);
  Sleep(150);
  frames(2);
  main = quadFor(0.8f);
  if (main != nullptr) {
    FakeSwapchain &sc = g_fake.swapchains[reinterpret_cast<uintptr_t>(main->swapchain)];
    Check(ReadPixel(game, sc.images[main->image], 20, 10) == kPage2, "a new frame shows up");
  }

  // Pinned in the world: where the head is when the anchor changes, level.
  float c = std::cos(0.4f), s = std::sin(0.4f);
  Mat34 yawed{{c, 0, s, 0.3f, 0, 1, 0, 1.2f, -s, 0, c, -0.5f}};
  float pc = std::cos(-0.3f), ps = std::sin(-0.3f);
  g_fake.head = Concat(yawed, Mat34{{1, 0, 0, 0, 0, pc, -ps, 0, 0, ps, pc, 0}});
  bridge.State(RigJson(true, "world", 1));
  Sleep(150);
  frames(2);
  main = quadFor(0.8f);
  if (main != nullptr) {
    Check(reinterpret_cast<uintptr_t>(main->space) == localSpace, "world-locked: in LOCAL space");
    XrPosef expected =
        PoseFromMatrix(Concat(Upright(g_fake.head), Mat34{{1, 0, 0, 0.1f, 0, 1, 0, 0.2f, 0, 0, 1, -1}}));
    Check(SamePose(main->pose, expected), "pinned upright where the head was");
  }
  // Turning the head doesn't move a pinned rig, but does change what is looked at.
  Mat34 pinnedPose = g_fake.head;
  float lc = std::cos(1.5708f + 0.4f), ls = std::sin(1.5708f + 0.4f);
  g_fake.head = Mat34{{lc, 0, ls, 0.3f, 0, 1, 0, 1.2f, -ls, 0, lc, -0.5f}};
  frames(20);
  main = quadFor(0.8f);
  if (main != nullptr) {
    XrPosef expected =
        PoseFromMatrix(Concat(Upright(pinnedPose), Mat34{{1, 0, 0, 0.1f, 0, 1, 0, 0.2f, 0, 0, 1, -1}}));
    Check(SamePose(main->pose, expected), "a pinned rig stays put when the head turns");
  }
  Check(bridge.WaitFor("\"gaze\",\"message\":\"left\""), "looking left picks the left panel (gaze)");
  g_fake.head = pinnedPose;
  frames(20);
  Check(bridge.WaitFor("\"gaze\",\"message\":\"main\""), "looking back picks main again");

  // Hidden: nothing added.
  bridge.State(RigJson(false, "world", 1));
  Sleep(150);
  frames(2);
  Check(g_fake.lastFrame.empty() && g_fake.lastGameLayers == 1, "hidden: no quads, game untouched");
  bridge.State(RigJson(true, "head", 1));
  Sleep(150);

  // The system's layer limit: a session on a runtime that takes only two layers gets one panel.
  XrSession limited = XR_NULL_HANDLE;
  g_fake.maxLayers = 2;
  createSession(instance, &sessionInfo, &limited);
  {
    XrFrameEndInfo info{XR_TYPE_FRAME_END_INFO};
    info.layerCount = 1;
    info.layers = gameLayers;
    XrResult r = endFrame(limited, &info);
    Check(XR_SUCCEEDED(r) && g_fake.lastFrame.size() == 1, "the layer limit is respected (2 -> 1 panel)");
  }
  destroySession(limited);
  g_fake.maxLayers = 16;

  // The bridge goes: the layer lets go and the game's frames go through bare.
  bridge.Stop();
  frames(200);
  Check(g_fake.lastFrame.empty() && g_fake.lastGameLayers == 1, "bridge gone: no quads");

  // A session made with no bridge running is left entirely alone.
  {
    size_t spaces = g_fake.spaces.size();
    int swapchains = g_fake.liveSwapchains;
    XrSession bare = XR_NULL_HANDLE;
    createSession(instance, &sessionInfo, &bare);
    XrFrameEndInfo info{XR_TYPE_FRAME_END_INFO};
    info.layerCount = 1;
    info.layers = gameLayers;
    for (int i = 0; i < 100; i++) endFrame(bare, &info);
    Check(g_fake.spaces.size() == spaces && g_fake.liveSwapchains == swapchains &&
              g_fake.lastFrame.empty(),
          "no bridge: the layer makes nothing in the session and adds nothing");
    destroySession(bare);
  }

  int before = g_fake.liveSwapchains;
  destroySession(session);
  Check(g_fake.liveSwapchains == 0, "xrDestroySession frees the layer's swapchains");
  printf("        swapchains before destroy: %d\n", before);
  destroyInstance(instance);

  CloseHandle(pageHandle);
  resource->Release();
  page->Release();
  printf(g_failures == 0 ? "ALL PASSED\n" : "%d FAILED\n", g_failures);
  return g_failures == 0 ? 0 : 1;
}
