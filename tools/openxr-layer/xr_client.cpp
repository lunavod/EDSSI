// xr-client.exe: the smallest D3D11 OpenXR app that runs frames — a stand-in for the game, for
// testing the layer through the real loader without a headset (with fake_runtime.dll as the
// runtime, via XR_RUNTIME_JSON). It submits one projection layer header per frame, as a game would,
// and runs for the seconds given.
//
//   xr-client.exe <path\to\openxr_loader.dll> <seconds>

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <d3d11.h>

#define XR_USE_GRAPHICS_API_D3D11
#define XR_USE_PLATFORM_WIN32
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include <cstdio>
#include <cstring>

#define LOAD(name) \
  PFN_##name name = nullptr; \
  get(instance, #name, reinterpret_cast<PFN_xrVoidFunction *>(&name))

int wmain(int argc, wchar_t **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: xr-client <openxr_loader.dll> <seconds>\n");
    return 2;
  }
  HMODULE loader = LoadLibraryW(argv[1]);
  if (loader == nullptr) {
    fprintf(stderr, "could not load the loader (%lu)\n", GetLastError());
    return 1;
  }
  auto get = reinterpret_cast<PFN_xrGetInstanceProcAddr>(GetProcAddress(loader, "xrGetInstanceProcAddr"));
  XrInstance instance = XR_NULL_HANDLE;
  LOAD(xrCreateInstance);
  XrInstanceCreateInfo ci{XR_TYPE_INSTANCE_CREATE_INFO};
  strcpy_s(ci.applicationInfo.applicationName, "EDSSI xr-client");
  ci.applicationInfo.apiVersion = XR_MAKE_VERSION(1, 0, 0);
  const char *ext[] = {XR_KHR_D3D11_ENABLE_EXTENSION_NAME};
  ci.enabledExtensionCount = 1;
  ci.enabledExtensionNames = ext;
  XrResult r = xrCreateInstance(&ci, &instance);
  printf("xrCreateInstance -> %d\n", r);
  if (XR_FAILED(r)) return 1;

  LOAD(xrGetSystem);
  LOAD(xrGetD3D11GraphicsRequirementsKHR);
  LOAD(xrCreateSession);
  LOAD(xrPollEvent);
  LOAD(xrBeginSession);
  LOAD(xrWaitFrame);
  LOAD(xrBeginFrame);
  LOAD(xrEndFrame);
  LOAD(xrEndSession);
  LOAD(xrDestroySession);
  LOAD(xrDestroyInstance);

  XrSystemGetInfo si{XR_TYPE_SYSTEM_GET_INFO};
  si.formFactor = XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY;
  XrSystemId system = XR_NULL_SYSTEM_ID;
  r = xrGetSystem(instance, &si, &system);
  printf("xrGetSystem -> %d\n", r);
  if (XR_FAILED(r)) return 1;
  XrGraphicsRequirementsD3D11KHR req{XR_TYPE_GRAPHICS_REQUIREMENTS_D3D11_KHR};
  xrGetD3D11GraphicsRequirementsKHR(instance, system, &req);

  ID3D11Device *device = nullptr;
  ID3D11DeviceContext *context = nullptr;
  D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
                               D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, 2, D3D11_SDK_VERSION,
                               &device, nullptr, &context))) {
    fprintf(stderr, "no D3D11 device\n");
    return 1;
  }
  XrGraphicsBindingD3D11KHR binding{XR_TYPE_GRAPHICS_BINDING_D3D11_KHR};
  binding.device = device;
  XrSessionCreateInfo sci{XR_TYPE_SESSION_CREATE_INFO};
  sci.next = &binding;
  sci.systemId = system;
  XrSession session = XR_NULL_HANDLE;
  r = xrCreateSession(instance, &sci, &session);
  printf("xrCreateSession -> %d\n", r);
  if (XR_FAILED(r)) return 1;

  bool running = false;
  ULONGLONG end = GetTickCount64() + static_cast<ULONGLONG>(_wtoi(argv[2])) * 1000;
  XrCompositionLayerProjection projection{XR_TYPE_COMPOSITION_LAYER_PROJECTION};
  const XrCompositionLayerBaseHeader *layers[] = {
      reinterpret_cast<const XrCompositionLayerBaseHeader *>(&projection)};
  unsigned long long frames = 0;
  while (GetTickCount64() < end) {
    XrEventDataBuffer event{XR_TYPE_EVENT_DATA_BUFFER};
    while (xrPollEvent(instance, &event) == XR_SUCCESS) {
      if (event.type == XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED &&
          reinterpret_cast<XrEventDataSessionStateChanged *>(&event)->state == XR_SESSION_STATE_READY) {
        XrSessionBeginInfo bi{XR_TYPE_SESSION_BEGIN_INFO};
        bi.primaryViewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
        printf("xrBeginSession -> %d\n", xrBeginSession(session, &bi));
        running = true;
      }
      event = {XR_TYPE_EVENT_DATA_BUFFER};
    }
    if (!running) {
      Sleep(10);
      continue;
    }
    XrFrameState state{XR_TYPE_FRAME_STATE};
    XrFrameWaitInfo wi{XR_TYPE_FRAME_WAIT_INFO};
    xrWaitFrame(session, &wi, &state);
    XrFrameBeginInfo fbi{XR_TYPE_FRAME_BEGIN_INFO};
    xrBeginFrame(session, &fbi);
    XrFrameEndInfo fei{XR_TYPE_FRAME_END_INFO};
    fei.displayTime = state.predictedDisplayTime;
    fei.environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
    fei.layerCount = 1;
    fei.layers = layers;
    r = xrEndFrame(session, &fei);
    if (XR_FAILED(r)) printf("xrEndFrame -> %d at frame %llu\n", r, frames);
    frames++;
  }
  printf("%llu frames\n", frames);
  xrEndSession(session);
  xrDestroySession(session);
  xrDestroyInstance(instance);
  return 0;
}
