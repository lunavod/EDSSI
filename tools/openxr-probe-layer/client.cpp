// Creates and destroys one OpenXR instance through a given openxr_loader.dll, so the probe layer can
// be seen loading without starting a game. It makes no session, so it never takes the headset from
// whatever is using it.
//
//   probe-client.exe [path\to\openxr_loader.dll]

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <openxr/openxr.h>

#include <cstdio>
#include <cstring>

int wmain(int argc, wchar_t **argv) {
  const wchar_t *path = argc > 1 ? argv[1] : L"openxr_loader.dll";
  HMODULE loader = LoadLibraryW(path);
  if (loader == nullptr) {
    fwprintf(stderr, L"couldn't load %s (%lu)\n", path, GetLastError());
    return 1;
  }
  auto getProcAddr = reinterpret_cast<PFN_xrGetInstanceProcAddr>(
      GetProcAddress(loader, "xrGetInstanceProcAddr"));
  if (getProcAddr == nullptr) {
    fprintf(stderr, "no xrGetInstanceProcAddr in the loader\n");
    return 1;
  }

  PFN_xrEnumerateApiLayerProperties enumerateLayers = nullptr;
  getProcAddr(XR_NULL_HANDLE, "xrEnumerateApiLayerProperties",
              reinterpret_cast<PFN_xrVoidFunction *>(&enumerateLayers));
  XrApiLayerProperties layers[32];
  for (auto &layer : layers) layer = {XR_TYPE_API_LAYER_PROPERTIES};
  uint32_t layerCount = 0;
  if (enumerateLayers != nullptr && XR_SUCCEEDED(enumerateLayers(32, &layerCount, layers))) {
    for (uint32_t i = 0; i < layerCount; i++) printf("layer: %s\n", layers[i].layerName);
  }

  PFN_xrCreateInstance createInstance = nullptr;
  getProcAddr(XR_NULL_HANDLE, "xrCreateInstance",
              reinterpret_cast<PFN_xrVoidFunction *>(&createInstance));
  XrInstanceCreateInfo info{XR_TYPE_INSTANCE_CREATE_INFO};
  strcpy_s(info.applicationInfo.applicationName, "EDSSI probe client");
  info.applicationInfo.apiVersion = XR_API_VERSION_1_0;
  XrInstance instance = XR_NULL_HANDLE;
  XrResult result = createInstance(&info, &instance);
  printf("xrCreateInstance -> %d\n", static_cast<int>(result));
  if (XR_FAILED(result)) return 1;

  PFN_xrDestroyInstance destroyInstance = nullptr;
  getProcAddr(instance, "xrDestroyInstance",
              reinterpret_cast<PFN_xrVoidFunction *>(&destroyInstance));
  destroyInstance(instance);
  return 0;
}
