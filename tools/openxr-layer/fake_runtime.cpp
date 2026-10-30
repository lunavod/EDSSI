// fake_runtime.dll: an OpenXR "runtime" with no headset, for running the whole chain headless —
// the real Khronos loader, EDSSI's layer (found through the registry like any implicit layer) and
// this — under xr-client.exe. Point the loader at it with XR_RUNTIME_JSON=<out>\fake_runtime.json.
//
// It does just enough for a D3D11 app: one system, sessions that start at once, swapchains of real
// textures on the app's device, frames paced at about 90 Hz, and a head that stays at the origin
// looking down -Z. xrEndFrame records the layers it is given; every FAKE_XR_DUMP_EVERY frames
// (default 300) it writes each quad's current image to FAKE_XR_DUMP_DIR as a .bmp, with a line per
// layer in layers.txt, which is as close to a compositor's mirror as this gets.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <d3d11.h>

#define XR_USE_GRAPHICS_API_D3D11
#define XR_USE_PLATFORM_WIN32
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>
#include <openxr/openxr_loader_negotiation.h>

#include <cstdio>
#include <cstring>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace {

struct Swapchain {
  std::vector<ID3D11Texture2D *> images;
  uint32_t next = 0, width = 0, height = 0;
  int acquired = -1, released = -1;
  int64_t format = 0;
};

std::mutex g_lock;
ID3D11Device *g_device = nullptr;
std::map<uintptr_t, Swapchain> g_swapchains;
std::map<uintptr_t, XrReferenceSpaceType> g_spaces;
uintptr_t g_next = 0x100;
uint64_t g_frames = 0;
bool g_eventSent[3] = {};
LARGE_INTEGER g_start;

std::string Env(const char *name, const char *fallback) {
  char value[1024];
  DWORD n = GetEnvironmentVariableA(name, value, sizeof value);
  return n > 0 && n < sizeof value ? std::string(value, n) : std::string(fallback);
}

XrTime Now() {
  LARGE_INTEGER now, freq;
  QueryPerformanceCounter(&now);
  QueryPerformanceFrequency(&freq);
  return static_cast<XrTime>((now.QuadPart - g_start.QuadPart) * 1'000'000'000LL / freq.QuadPart) +
         1'000'000'000LL;
}

void WriteBmp(const std::string &path, ID3D11Texture2D *texture) {
  D3D11_TEXTURE2D_DESC desc;
  texture->GetDesc(&desc);
  desc.Usage = D3D11_USAGE_STAGING;
  desc.BindFlags = 0;
  desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  desc.MiscFlags = 0;
  ID3D11Texture2D *staging = nullptr;
  if (FAILED(g_device->CreateTexture2D(&desc, nullptr, &staging))) return;
  ID3D11DeviceContext *context = nullptr;
  g_device->GetImmediateContext(&context);
  context->CopyResource(staging, texture);
  D3D11_MAPPED_SUBRESOURCE mapped;
  if (SUCCEEDED(context->Map(staging, 0, D3D11_MAP_READ, 0, &mapped))) {
    FILE *f = fopen(path.c_str(), "wb");
    if (f != nullptr) {
      uint32_t w = desc.Width, h = desc.Height, row = w * 4, size = 54 + row * h;
      uint8_t header[54] = {'B', 'M'};
      memcpy(header + 2, &size, 4);
      uint32_t offset = 54, infoSize = 40;
      int32_t height = -static_cast<int32_t>(h);  // top-down
      uint16_t planes = 1, bits = 32;
      memcpy(header + 10, &offset, 4);
      memcpy(header + 14, &infoSize, 4);
      memcpy(header + 18, &w, 4);
      memcpy(header + 22, &height, 4);
      memcpy(header + 26, &planes, 2);
      memcpy(header + 28, &bits, 2);
      fwrite(header, 1, 54, f);
      bool rgba = desc.Format == DXGI_FORMAT_R8G8B8A8_UNORM || desc.Format == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB;
      std::vector<uint8_t> line(row);
      for (uint32_t y = 0; y < h; y++) {
        memcpy(line.data(), static_cast<uint8_t *>(mapped.pData) + y * mapped.RowPitch, row);
        if (rgba) {
          for (uint32_t x = 0; x < w; x++) std::swap(line[x * 4], line[x * 4 + 2]);
        }
        fwrite(line.data(), 1, row, f);
      }
      fclose(f);
    }
    context->Unmap(staging, 0);
  }
  staging->Release();
  context->Release();
}

const char *SpaceName(XrSpace space) {
  auto found = g_spaces.find(reinterpret_cast<uintptr_t>(space));
  if (found == g_spaces.end()) return "?";
  switch (found->second) {
    case XR_REFERENCE_SPACE_TYPE_VIEW: return "VIEW";
    case XR_REFERENCE_SPACE_TYPE_LOCAL: return "LOCAL";
    case XR_REFERENCE_SPACE_TYPE_STAGE: return "STAGE";
    default: return "other";
  }
}

#define FAKE(name) XRAPI_ATTR XrResult XRAPI_CALL name

FAKE(EnumerateInstanceExtensionProperties)(const char *, uint32_t capacity, uint32_t *count,
                                           XrExtensionProperties *properties) {
  const char *names[] = {XR_KHR_D3D11_ENABLE_EXTENSION_NAME,
                         XR_KHR_COMPOSITION_LAYER_CYLINDER_EXTENSION_NAME,
                         XR_KHR_COMPOSITION_LAYER_COLOR_SCALE_BIAS_EXTENSION_NAME};
  *count = 3;
  if (capacity == 0) return XR_SUCCESS;
  if (capacity < 3) return XR_ERROR_SIZE_INSUFFICIENT;
  for (int i = 0; i < 3; i++) {
    strcpy_s(properties[i].extensionName, names[i]);
    properties[i].extensionVersion = 1;
  }
  return XR_SUCCESS;
}
FAKE(CreateInstance)(const XrInstanceCreateInfo *, XrInstance *instance) {
  QueryPerformanceCounter(&g_start);
  *instance = reinterpret_cast<XrInstance>(static_cast<uintptr_t>(0x42));
  return XR_SUCCESS;
}
FAKE(DestroyInstance)(XrInstance) { return XR_SUCCESS; }
FAKE(GetInstanceProperties)(XrInstance, XrInstanceProperties *p) {
  strcpy_s(p->runtimeName, "EDSSI fake runtime");
  p->runtimeVersion = XR_MAKE_VERSION(0, 1, 0);
  return XR_SUCCESS;
}
FAKE(GetSystem)(XrInstance, const XrSystemGetInfo *, XrSystemId *id) {
  *id = 1;
  return XR_SUCCESS;
}
FAKE(GetSystemProperties)(XrInstance, XrSystemId, XrSystemProperties *p) {
  strcpy_s(p->systemName, "no headset");
  p->graphicsProperties.maxLayerCount = 16;
  p->graphicsProperties.maxSwapchainImageWidth = 4096;
  p->graphicsProperties.maxSwapchainImageHeight = 4096;
  return XR_SUCCESS;
}
FAKE(GetD3D11GraphicsRequirementsKHR)(XrInstance, XrSystemId, XrGraphicsRequirementsD3D11KHR *r) {
  r->adapterLuid = {};
  r->minFeatureLevel = D3D_FEATURE_LEVEL_11_0;
  return XR_SUCCESS;
}
FAKE(CreateSession)(XrInstance, const XrSessionCreateInfo *info, XrSession *session) {
  auto *binding = static_cast<const XrGraphicsBindingD3D11KHR *>(info->next);
  if (binding == nullptr || binding->type != XR_TYPE_GRAPHICS_BINDING_D3D11_KHR) {
    return XR_ERROR_GRAPHICS_DEVICE_INVALID;
  }
  g_device = binding->device;
  *session = reinterpret_cast<XrSession>(g_next++);
  return XR_SUCCESS;
}
FAKE(DestroySession)(XrSession) { return XR_SUCCESS; }
FAKE(PollEvent)(XrInstance, XrEventDataBuffer *event) {
  // READY, then nothing: the session runs until the app ends it.
  if (g_device != nullptr && !g_eventSent[0]) {
    g_eventSent[0] = true;
    auto *changed = reinterpret_cast<XrEventDataSessionStateChanged *>(event);
    changed->type = XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED;
    changed->state = XR_SESSION_STATE_READY;
    changed->time = Now();
    return XR_SUCCESS;
  }
  return XR_EVENT_UNAVAILABLE;
}
FAKE(BeginSession)(XrSession, const XrSessionBeginInfo *) { return XR_SUCCESS; }
FAKE(EndSession)(XrSession) { return XR_SUCCESS; }
FAKE(WaitFrame)(XrSession, const XrFrameWaitInfo *, XrFrameState *state) {
  Sleep(11);
  state->predictedDisplayTime = Now() + 20'000'000;
  state->predictedDisplayPeriod = 11'111'111;
  state->shouldRender = XR_TRUE;
  return XR_SUCCESS;
}
FAKE(BeginFrame)(XrSession, const XrFrameBeginInfo *) { return XR_SUCCESS; }
FAKE(EndFrame)(XrSession, const XrFrameEndInfo *info) {
  std::lock_guard<std::mutex> lock(g_lock);
  g_frames++;
  static const uint64_t every = std::stoull(Env("FAKE_XR_DUMP_EVERY", "300"));
  static const std::string dir = Env("FAKE_XR_DUMP_DIR", "");
  if (dir.empty() || g_frames % every != 0) return XR_SUCCESS;
  FILE *log = fopen((dir + "\\layers.txt").c_str(), "a");
  for (uint32_t i = 0; i < info->layerCount; i++) {
    const XrCompositionLayerBaseHeader *layer = info->layers[i];
    float alpha = 1;
    for (auto *next = static_cast<const XrBaseInStructure *>(layer->next); next != nullptr; next = next->next) {
      if (next->type == XR_TYPE_COMPOSITION_LAYER_COLOR_SCALE_BIAS_KHR) {
        alpha = reinterpret_cast<const XrCompositionLayerColorScaleBiasKHR *>(next)->colorScale.a;
      }
    }
    if (layer->type == XR_TYPE_COMPOSITION_LAYER_CYLINDER_KHR) {
      auto *cyl = reinterpret_cast<const XrCompositionLayerCylinderKHR *>(layer);
      auto found = g_swapchains.find(reinterpret_cast<uintptr_t>(cyl->subImage.swapchain));
      if (log) {
        fprintf(log,
                "frame %llu layer %u: cylinder in %s axis at (%.3f %.3f %.3f) q(%.3f %.3f %.3f %.3f) radius %.3f "
                "angle %.3f aspect %.3f alpha %.2f image %dx%d released %d\n",
                static_cast<unsigned long long>(g_frames), i, SpaceName(cyl->space), cyl->pose.position.x,
                cyl->pose.position.y, cyl->pose.position.z, cyl->pose.orientation.x, cyl->pose.orientation.y,
                cyl->pose.orientation.z, cyl->pose.orientation.w, cyl->radius, cyl->centralAngle,
                cyl->aspectRatio, alpha, cyl->subImage.imageRect.extent.width,
                cyl->subImage.imageRect.extent.height, found == g_swapchains.end() ? -2 : found->second.released);
      }
      if (found != g_swapchains.end() && found->second.released >= 0) {
        char name[64];
        snprintf(name, sizeof name, "\\quad%u.bmp", i);
        WriteBmp(dir + name, found->second.images[found->second.released]);
      }
      continue;
    }
    if (layer->type != XR_TYPE_COMPOSITION_LAYER_QUAD) {
      if (log) fprintf(log, "frame %llu layer %u: type %d\n", static_cast<unsigned long long>(g_frames), i, layer->type);
      continue;
    }
    auto *quad = reinterpret_cast<const XrCompositionLayerQuad *>(layer);
    auto found = g_swapchains.find(reinterpret_cast<uintptr_t>(quad->subImage.swapchain));
    if (log) {
      fprintf(log,
              "frame %llu layer %u: quad in %s at (%.3f %.3f %.3f) q(%.3f %.3f %.3f %.3f) size %.3fx%.3f "
              "alpha %.2f image %dx%d released %d\n",
              static_cast<unsigned long long>(g_frames), i, SpaceName(quad->space), quad->pose.position.x,
              quad->pose.position.y, quad->pose.position.z, quad->pose.orientation.x,
              quad->pose.orientation.y, quad->pose.orientation.z, quad->pose.orientation.w,
              quad->size.width, quad->size.height, alpha, quad->subImage.imageRect.extent.width,
              quad->subImage.imageRect.extent.height,
              found == g_swapchains.end() ? -2 : found->second.released);
    }
    if (found != g_swapchains.end() && found->second.released >= 0) {
      char name[64];
      snprintf(name, sizeof name, "\\quad%u.bmp", i);
      WriteBmp(dir + name, found->second.images[found->second.released]);
    }
  }
  if (log) fclose(log);
  return XR_SUCCESS;
}
FAKE(CreateReferenceSpace)(XrSession, const XrReferenceSpaceCreateInfo *info, XrSpace *space) {
  uintptr_t h = g_next++;
  g_spaces[h] = info->referenceSpaceType;
  *space = reinterpret_cast<XrSpace>(h);
  return XR_SUCCESS;
}
FAKE(DestroySpace)(XrSpace) { return XR_SUCCESS; }
FAKE(LocateSpace)(XrSpace, XrSpace, XrTime, XrSpaceLocation *location) {
  location->locationFlags = XR_SPACE_LOCATION_ORIENTATION_VALID_BIT | XR_SPACE_LOCATION_POSITION_VALID_BIT;
  location->pose = {{0, 0, 0, 1}, {0, 0, 0}};
  return XR_SUCCESS;
}
FAKE(EnumerateSwapchainFormats)(XrSession, uint32_t capacity, uint32_t *count, int64_t *formats) {
  const int64_t mine[] = {DXGI_FORMAT_R8G8B8A8_UNORM_SRGB, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB};
  *count = 2;
  if (capacity >= 2) memcpy(formats, mine, sizeof mine);
  return XR_SUCCESS;
}
FAKE(CreateSwapchain)(XrSession, const XrSwapchainCreateInfo *info, XrSwapchain *swapchain) {
  std::lock_guard<std::mutex> lock(g_lock);
  Swapchain s;
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
    ID3D11Texture2D *t = nullptr;
    if (FAILED(g_device->CreateTexture2D(&desc, nullptr, &t))) return XR_ERROR_SWAPCHAIN_FORMAT_UNSUPPORTED;
    s.images.push_back(t);
  }
  uintptr_t h = g_next++;
  g_swapchains[h] = s;
  *swapchain = reinterpret_cast<XrSwapchain>(h);
  return XR_SUCCESS;
}
FAKE(DestroySwapchain)(XrSwapchain swapchain) {
  std::lock_guard<std::mutex> lock(g_lock);
  auto found = g_swapchains.find(reinterpret_cast<uintptr_t>(swapchain));
  if (found == g_swapchains.end()) return XR_ERROR_HANDLE_INVALID;
  for (auto *t : found->second.images) t->Release();
  g_swapchains.erase(found);
  return XR_SUCCESS;
}
FAKE(EnumerateSwapchainImages)(XrSwapchain swapchain, uint32_t capacity, uint32_t *count,
                               XrSwapchainImageBaseHeader *images) {
  std::lock_guard<std::mutex> lock(g_lock);
  Swapchain &s = g_swapchains[reinterpret_cast<uintptr_t>(swapchain)];
  *count = static_cast<uint32_t>(s.images.size());
  auto *d3d = reinterpret_cast<XrSwapchainImageD3D11KHR *>(images);
  for (uint32_t i = 0; i < capacity && i < s.images.size(); i++) d3d[i].texture = s.images[i];
  return XR_SUCCESS;
}
FAKE(AcquireSwapchainImage)(XrSwapchain swapchain, const XrSwapchainImageAcquireInfo *, uint32_t *index) {
  std::lock_guard<std::mutex> lock(g_lock);
  Swapchain &s = g_swapchains[reinterpret_cast<uintptr_t>(swapchain)];
  s.acquired = static_cast<int>(s.next);
  *index = s.next;
  s.next = (s.next + 1) % static_cast<uint32_t>(s.images.size());
  return XR_SUCCESS;
}
FAKE(WaitSwapchainImage)(XrSwapchain, const XrSwapchainImageWaitInfo *) { return XR_SUCCESS; }
FAKE(ReleaseSwapchainImage)(XrSwapchain swapchain, const XrSwapchainImageReleaseInfo *) {
  std::lock_guard<std::mutex> lock(g_lock);
  Swapchain &s = g_swapchains[reinterpret_cast<uintptr_t>(swapchain)];
  s.released = s.acquired;
  s.acquired = -1;
  return XR_SUCCESS;
}
FAKE(StringToPath)(XrInstance, const char *, XrPath *path) {
  *path = 1;
  return XR_SUCCESS;
}

FAKE(GetInstanceProcAddr)(XrInstance, const char *name, PFN_xrVoidFunction *function);

const std::map<std::string, PFN_xrVoidFunction> &Table() {
#define ENTRY(n) {"xr" #n, reinterpret_cast<PFN_xrVoidFunction>(n)}
  static const std::map<std::string, PFN_xrVoidFunction> table = {
      ENTRY(GetInstanceProcAddr), ENTRY(EnumerateInstanceExtensionProperties), ENTRY(CreateInstance),
      ENTRY(DestroyInstance), ENTRY(GetInstanceProperties), ENTRY(GetSystem),
      ENTRY(GetSystemProperties), ENTRY(GetD3D11GraphicsRequirementsKHR), ENTRY(CreateSession),
      ENTRY(DestroySession), ENTRY(PollEvent), ENTRY(BeginSession), ENTRY(EndSession),
      ENTRY(WaitFrame), ENTRY(BeginFrame), ENTRY(EndFrame), ENTRY(CreateReferenceSpace),
      ENTRY(DestroySpace), ENTRY(LocateSpace), ENTRY(EnumerateSwapchainFormats),
      ENTRY(CreateSwapchain), ENTRY(DestroySwapchain), ENTRY(EnumerateSwapchainImages),
      ENTRY(AcquireSwapchainImage), ENTRY(WaitSwapchainImage), ENTRY(ReleaseSwapchainImage),
      ENTRY(StringToPath),
  };
#undef ENTRY
  return table;
}

FAKE(GetInstanceProcAddr)(XrInstance, const char *name, PFN_xrVoidFunction *function) {
  auto found = Table().find(name);
  if (found == Table().end()) {
    *function = nullptr;
    return XR_ERROR_FUNCTION_UNSUPPORTED;
  }
  *function = found->second;
  return XR_SUCCESS;
}

}  // namespace

extern "C" __declspec(dllexport) XrResult XRAPI_CALL xrNegotiateLoaderRuntimeInterface(
    const XrNegotiateLoaderInfo *loaderInfo, XrNegotiateRuntimeRequest *request) {
  if (loaderInfo == nullptr || request == nullptr) return XR_ERROR_INITIALIZATION_FAILED;
  request->runtimeInterfaceVersion = XR_CURRENT_LOADER_RUNTIME_VERSION;
  request->runtimeApiVersion = XR_API_VERSION_1_0;
  request->getInstanceProcAddr = GetInstanceProcAddr;
  return XR_SUCCESS;
}
