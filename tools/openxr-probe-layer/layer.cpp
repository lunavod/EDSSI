// A no-op OpenXR API layer that only writes down what it sees: which program loaded it, which
// runtime is under it, which graphics binding the session uses, and what the first submitted frame
// held. It answers whether EDSSI could hang its cockpit inside a game through an API layer at all,
// before anything real is built on that. Every call is passed on unchanged.
//
// One instance and one session at a time is assumed; a second simply overwrites the first's
// pointers, which is fine for a probe and would not be for the real thing.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <d3d11_1.h>
#include <dxgi.h>

#define XR_USE_GRAPHICS_API_D3D11
#define XR_USE_PLATFORM_WIN32
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>
#include <openxr/openxr_loader_negotiation.h>

#include <atomic>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>

namespace {

constexpr const char *kLayerName = "XR_APILAYER_EDSSI_probe";

HMODULE g_module = nullptr;
std::mutex g_logLock;

PFN_xrGetInstanceProcAddr g_nextGetInstanceProcAddr = nullptr;
PFN_xrDestroyInstance g_nextDestroyInstance = nullptr;
PFN_xrCreateSession g_nextCreateSession = nullptr;
PFN_xrDestroySession g_nextDestroySession = nullptr;
PFN_xrEndFrame g_nextEndFrame = nullptr;
PFN_xrGetInstanceProperties g_nextGetInstanceProperties = nullptr;
PFN_xrGetSystemProperties g_nextGetSystemProperties = nullptr;
PFN_xrEnumerateSwapchainFormats g_nextEnumerateSwapchainFormats = nullptr;

std::atomic<uint64_t> g_frames{0};

/** The log sits beside the DLL, so it is found wherever the layer was built to. */
std::wstring LogPath() {
  wchar_t path[MAX_PATH];
  DWORD length = GetModuleFileNameW(g_module, path, MAX_PATH);
  std::wstring result(path, length);
  size_t slash = result.find_last_of(L"\\/");
  return result.substr(0, slash + 1) + L"probe.log";
}

std::string ExeName() {
  char path[MAX_PATH];
  DWORD length = GetModuleFileNameA(nullptr, path, MAX_PATH);
  return std::string(path, length);
}

void Log(const char *format, ...) {
  char message[2048];
  va_list args;
  va_start(args, format);
  vsnprintf(message, sizeof message, format, args);
  va_end(args);

  SYSTEMTIME now;
  GetLocalTime(&now);
  std::lock_guard<std::mutex> lock(g_logLock);
  FILE *file = _wfopen(LogPath().c_str(), L"a");
  if (file == nullptr) return;
  fprintf(file, "%04u-%02u-%02u %02u:%02u:%02u.%03u [%lu] %s\n", now.wYear, now.wMonth, now.wDay,
          now.wHour, now.wMinute, now.wSecond, now.wMilliseconds, GetCurrentProcessId(), message);
  fclose(file);
}

std::string Version(XrVersion version) {
  char text[64];
  snprintf(text, sizeof text, "%u.%u.%u", XR_VERSION_MAJOR(version), XR_VERSION_MINOR(version),
           XR_VERSION_PATCH(version));
  return text;
}

const char *BindingName(XrStructureType type) {
  switch (type) {
    case XR_TYPE_GRAPHICS_BINDING_D3D11_KHR: return "D3D11";
    case XR_TYPE_GRAPHICS_BINDING_D3D12_KHR: return "D3D12";
    case XR_TYPE_GRAPHICS_BINDING_VULKAN_KHR: return "Vulkan";
    case XR_TYPE_GRAPHICS_BINDING_OPENGL_WIN32_KHR: return "OpenGL (Win32)";
    default: return nullptr;
  }
}

const char *LayerTypeName(XrStructureType type) {
  switch (type) {
    case XR_TYPE_COMPOSITION_LAYER_PROJECTION: return "projection";
    case XR_TYPE_COMPOSITION_LAYER_QUAD: return "quad";
    case XR_TYPE_COMPOSITION_LAYER_CYLINDER_KHR: return "cylinder";
    case XR_TYPE_COMPOSITION_LAYER_CUBE_KHR: return "cube";
    case XR_TYPE_COMPOSITION_LAYER_EQUIRECT_KHR: return "equirect";
    default: return "other";
  }
}

/** What the real layer would need of a D3D11 device: which GPU, and whether it can open an NT handle. */
void DescribeD3D11(const XrGraphicsBindingD3D11KHR *binding) {
  ID3D11Device *device = binding->device;
  if (device == nullptr) {
    Log("  D3D11 binding has no device");
    return;
  }
  Log("  feature level 0x%x", static_cast<unsigned>(device->GetFeatureLevel()));

  IDXGIDevice *dxgi = nullptr;
  if (SUCCEEDED(device->QueryInterface(__uuidof(IDXGIDevice), reinterpret_cast<void **>(&dxgi)))) {
    IDXGIAdapter *adapter = nullptr;
    if (SUCCEEDED(dxgi->GetAdapter(&adapter))) {
      DXGI_ADAPTER_DESC desc;
      if (SUCCEEDED(adapter->GetDesc(&desc))) {
        char name[256];
        WideCharToMultiByte(CP_UTF8, 0, desc.Description, -1, name, sizeof name, nullptr, nullptr);
        Log("  adapter %s (LUID %08lx:%08lx)", name, desc.AdapterLuid.HighPart,
            desc.AdapterLuid.LowPart);
      }
      adapter->Release();
    }
    dxgi->Release();
  }

  ID3D11Device1 *device1 = nullptr;
  bool opens = SUCCEEDED(
      device->QueryInterface(__uuidof(ID3D11Device1), reinterpret_cast<void **>(&device1)));
  Log("  ID3D11Device1 (OpenSharedResource1): %s", opens ? "yes" : "no");
  if (device1 != nullptr) device1->Release();
}

XRAPI_ATTR XrResult XRAPI_CALL ProbeDestroyInstance(XrInstance instance) {
  Log("xrDestroyInstance");
  return g_nextDestroyInstance(instance);
}

XRAPI_ATTR XrResult XRAPI_CALL ProbeCreateSession(XrInstance instance,
                                                  const XrSessionCreateInfo *createInfo,
                                                  XrSession *session) {
  Log("xrCreateSession");
  bool found = false;
  for (auto *next = static_cast<const XrBaseInStructure *>(createInfo->next); next != nullptr;
       next = next->next) {
    const char *name = BindingName(next->type);
    if (name == nullptr) {
      Log("  chained struct type %d", static_cast<int>(next->type));
      continue;
    }
    found = true;
    Log("  graphics binding: %s", name);
    if (next->type == XR_TYPE_GRAPHICS_BINDING_D3D11_KHR) {
      DescribeD3D11(reinterpret_cast<const XrGraphicsBindingD3D11KHR *>(next));
    }
  }
  if (!found) Log("  no graphics binding (headless?)");

  if (g_nextGetSystemProperties != nullptr) {
    XrSystemProperties properties{XR_TYPE_SYSTEM_PROPERTIES};
    if (XR_SUCCEEDED(g_nextGetSystemProperties(instance, createInfo->systemId, &properties))) {
      Log("  system \"%s\", max layers %u, max swapchain %ux%u", properties.systemName,
          properties.graphicsProperties.maxLayerCount,
          properties.graphicsProperties.maxSwapchainImageWidth,
          properties.graphicsProperties.maxSwapchainImageHeight);
    }
  }

  XrResult result = g_nextCreateSession(instance, createInfo, session);
  Log("  -> %d", static_cast<int>(result));
  if (XR_SUCCEEDED(result) && g_nextEnumerateSwapchainFormats != nullptr) {
    int64_t formats[64];
    uint32_t count = 0;
    if (XR_SUCCEEDED(g_nextEnumerateSwapchainFormats(*session, 64, &count, formats))) {
      std::string list;
      for (uint32_t i = 0; i < count; i++) list += (i ? ", " : "") + std::to_string(formats[i]);
      Log("  swapchain formats: %s", list.c_str());
    }
  }
  g_frames = 0;
  return result;
}

XRAPI_ATTR XrResult XRAPI_CALL ProbeDestroySession(XrSession session) {
  Log("xrDestroySession after %llu frames", static_cast<unsigned long long>(g_frames.load()));
  return g_nextDestroySession(session);
}

XRAPI_ATTR XrResult XRAPI_CALL ProbeEndFrame(XrSession session, const XrFrameEndInfo *frameEndInfo) {
  uint64_t frame = ++g_frames;
  // The first frame proves the hook a real overlay would use is reached; a later one shows the
  // game's layers once it is past its loading screen.
  if (frame == 1 || frame == 3000) {
    std::string layers;
    for (uint32_t i = 0; i < frameEndInfo->layerCount; i++) {
      const XrCompositionLayerBaseHeader *layer = frameEndInfo->layers[i];
      layers += (i ? ", " : "") + std::string(LayerTypeName(layer->type));
    }
    Log("xrEndFrame #%llu: %u layer(s) [%s], blend mode %d",
        static_cast<unsigned long long>(frame), frameEndInfo->layerCount, layers.c_str(),
        static_cast<int>(frameEndInfo->environmentBlendMode));
  }
  return g_nextEndFrame(session, frameEndInfo);
}

XRAPI_ATTR XrResult XRAPI_CALL ProbeGetInstanceProcAddr(XrInstance instance, const char *name,
                                                        PFN_xrVoidFunction *function) {
  XrResult result = g_nextGetInstanceProcAddr(instance, name, function);
  if (XR_FAILED(result)) return result;
  if (strcmp(name, "xrGetInstanceProcAddr") == 0) {
    *function = reinterpret_cast<PFN_xrVoidFunction>(ProbeGetInstanceProcAddr);
  } else if (strcmp(name, "xrDestroyInstance") == 0) {
    *function = reinterpret_cast<PFN_xrVoidFunction>(ProbeDestroyInstance);
  } else if (strcmp(name, "xrCreateSession") == 0) {
    *function = reinterpret_cast<PFN_xrVoidFunction>(ProbeCreateSession);
  } else if (strcmp(name, "xrDestroySession") == 0) {
    *function = reinterpret_cast<PFN_xrVoidFunction>(ProbeDestroySession);
  } else if (strcmp(name, "xrEndFrame") == 0) {
    *function = reinterpret_cast<PFN_xrVoidFunction>(ProbeEndFrame);
  }
  return result;
}

template <typename T>
void Resolve(XrInstance instance, const char *name, T &slot) {
  PFN_xrVoidFunction function = nullptr;
  g_nextGetInstanceProcAddr(instance, name, &function);
  slot = reinterpret_cast<T>(function);
}

XRAPI_ATTR XrResult XRAPI_CALL ProbeCreateApiLayerInstance(const XrInstanceCreateInfo *info,
                                                           const XrApiLayerCreateInfo *layerInfo,
                                                           XrInstance *instance) {
  Log("xrCreateInstance from \"%s\" %u, engine \"%s\" %u, API %s",
      info->applicationInfo.applicationName, info->applicationInfo.applicationVersion,
      info->applicationInfo.engineName, info->applicationInfo.engineVersion,
      Version(info->applicationInfo.apiVersion).c_str());
  for (uint32_t i = 0; i < info->enabledApiLayerCount; i++) {
    Log("  API layer asked for: %s", info->enabledApiLayerNames[i]);
  }
  for (uint32_t i = 0; i < info->enabledExtensionCount; i++) {
    Log("  extension: %s", info->enabledExtensionNames[i]);
  }
  for (XrApiLayerNextInfo *next = layerInfo->nextInfo; next != nullptr; next = next->next) {
    Log("  chain: %s", next->layerName);
  }

  XrApiLayerNextInfo *mine = layerInfo->nextInfo;
  if (mine == nullptr || strcmp(mine->layerName, kLayerName) != 0) {
    Log("  the chain doesn't start with this layer; giving up");
    return XR_ERROR_INITIALIZATION_FAILED;
  }
  g_nextGetInstanceProcAddr = mine->nextGetInstanceProcAddr;

  // The next layer down is handed the chain from itself on.
  XrApiLayerCreateInfo nextLayerInfo = *layerInfo;
  nextLayerInfo.nextInfo = mine->next;
  XrResult result = mine->nextCreateApiLayerInstance(info, &nextLayerInfo, instance);
  Log("  -> %d", static_cast<int>(result));
  if (XR_FAILED(result)) return result;

  Resolve(*instance, "xrDestroyInstance", g_nextDestroyInstance);
  Resolve(*instance, "xrCreateSession", g_nextCreateSession);
  Resolve(*instance, "xrDestroySession", g_nextDestroySession);
  Resolve(*instance, "xrEndFrame", g_nextEndFrame);
  Resolve(*instance, "xrGetInstanceProperties", g_nextGetInstanceProperties);
  Resolve(*instance, "xrGetSystemProperties", g_nextGetSystemProperties);
  Resolve(*instance, "xrEnumerateSwapchainFormats", g_nextEnumerateSwapchainFormats);

  if (g_nextGetInstanceProperties != nullptr) {
    XrInstanceProperties properties{XR_TYPE_INSTANCE_PROPERTIES};
    if (XR_SUCCEEDED(g_nextGetInstanceProperties(*instance, &properties))) {
      Log("  runtime \"%s\" %s", properties.runtimeName,
          Version(properties.runtimeVersion).c_str());
    }
  }
  return result;
}

}  // namespace

extern "C" __declspec(dllexport) XrResult XRAPI_CALL xrNegotiateLoaderApiLayerInterface(
    const XrNegotiateLoaderInfo *loaderInfo, const char *layerName,
    XrNegotiateApiLayerRequest *request) {
  Log("loaded as %s into %s; loader interface %u-%u, API %s-%s", layerName, ExeName().c_str(),
      loaderInfo->minInterfaceVersion, loaderInfo->maxInterfaceVersion,
      Version(loaderInfo->minApiVersion).c_str(), Version(loaderInfo->maxApiVersion).c_str());

  if (loaderInfo->structType != XR_LOADER_INTERFACE_STRUCT_LOADER_INFO ||
      request->structType != XR_LOADER_INTERFACE_STRUCT_API_LAYER_REQUEST ||
      loaderInfo->minInterfaceVersion > XR_CURRENT_LOADER_API_LAYER_VERSION ||
      loaderInfo->maxInterfaceVersion < XR_CURRENT_LOADER_API_LAYER_VERSION) {
    Log("  can't speak this loader's interface");
    return XR_ERROR_INITIALIZATION_FAILED;
  }
  request->layerInterfaceVersion = XR_CURRENT_LOADER_API_LAYER_VERSION;
  request->layerApiVersion = XR_API_VERSION_1_0;
  request->getInstanceProcAddr = ProbeGetInstanceProcAddr;
  request->createApiLayerInstance = ProbeCreateApiLayerInstance;
  return XR_SUCCESS;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_module = instance;
    DisableThreadLibraryCalls(instance);
  }
  return TRUE;
}
