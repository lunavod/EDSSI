# openxr-layer

EDSSI's VR cockpit for games on an OpenXR runtime other than SteamVR — Virtual Desktop's VDXR with
the EDVR mod, for Elite Dangerous. `docs/vr.md` ("The OpenXR route") is the overview; this is the
build and the parts.

## Build and test

Needs Visual Studio 2022 (its bundled CMake will do) and a D3D11 GPU:

    npm run vr:openxr:build      # cmake -S tools/openxr-layer -B out/openxr-layer-build -A x64, then a Release build
    npm run vr:openxr:test       # out/openxr-layer/openxr-layer-test.exe; prints ALL PASSED, exit 0

Everything lands in `out/openxr-layer/`. A game in VR with the layer loaded holds the DLL, so close
it before rebuilding; the same goes for a running bridge.

## The parts

| File               | What it is                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layer.cpp`        | `edssi_openxr_layer.dll`, the implicit API layer `XR_APILAYER_EDSSI_cockpit` (manifest `edssi_openxr_layer.json`, disabled for one program by `EDSSI_OPENXR_LAYER_DISABLE=1`). Logs to `openxr-layer.log` beside itself.                                                              |
| `bridge.cpp`       | `edssi-openxr-bridge.exe --parent <pid>`: what EDSSI runs on the OpenXR route, in place of `tools/vr-overlay-host`, speaking the same protocol.                                                                                                                                       |
| `shared.h`         | What the two share: the rig in `Local\EDSSI-OpenXR-Cockpit` under a sequence lock, and per panel the name of a keyed-mutex texture. Bump `kVersion` with any change of layout.                                                                                                        |
| `pose.h`           | Matrices to poses, pinning upright, gaze — the same rules as the C# host.                                                                                                                                                                                                             |
| `json.h`           | Just enough JSON for the rig state.                                                                                                                                                                                                                                                   |
| `test.cpp`         | `openxr-layer-test.exe`: the real bridge and layer against a fake runtime in-process, with real D3D11 swapchains; checks pixels, sub-rects, poses, pinning, gaze, hiding, the layer limit and the bridge going away.                                                                  |
| `fake_runtime.cpp` | `fake_runtime.dll` + `fake_runtime.json`: a runtime with no headset, for `XR_RUNTIME_JSON`. Has the cylinder and colour scale extensions. Dumps submitted quads and cylinders (with their alpha) to `FAKE_XR_DUMP_DIR` (`quadN.bmp`, `layers.txt`) every `FAKE_XR_DUMP_EVERY` frames. |
| `xr_client.cpp`    | `xr-client.exe <loader.dll> <seconds>`: a minimal D3D11 OpenXR app to stand in for the game. Named `EliteDangerous64.exe`, EDSSI takes it for the game in VR.                                                                                                                         |

## How a frame gets there

1. Chromium paints a panel into a shared texture; EDSSI sends its NT handle down the bridge's stdin
   (`MESSAGE_TEXTURE`), or the pixels (`MESSAGE_FRAME`) where textures can't be shared.
2. The bridge duplicates the handle out of EDSSI, copies the page's rectangle into the panel's own
   texture under its keyed mutex, waits for the copy, bumps the panel's `frame` and replies `took`.
3. In the game's next `xrEndFrame`, the layer sees the new `frame`, takes the keyed mutex without
   waiting (a busy one is tried next frame), copies into the next image of its swapchain for that
   panel and appends its layer: a quad, or a cylinder (`XR_KHR_composition_layer_cylinder`) when
   the panel has a curvature, with a colour scale (`XR_KHR_composition_layer_color_scale_bias`,
   every channel times alpha: the page is premultiplied) when its alpha is below 1.

The two extensions are the layer's own business: at `xrCreateInstance` it asks the runtime which
extensions it has and adds those two to the game's list (the game never sees them; if the runtime
refuses the instance with them, it is made again without). Without them panels are flat and opaque.
Curvature is OpenVR's (the share of a full circle the panel's width wraps): central angle
`2π·curvature`, radius `width / angle`, the axis `radius` in front of the panel's centre, so the
centre stays where the matrix puts it and the sides bend towards the viewer.

The layer never blocks the game on EDSSI: no waits on the bridge, the shared memory is read with a
lock-free sequence check, and it looks for the bridge only once every 90 frames while there is
none.

## Registering

EDSSI does this itself (`src/main/vr/openxr-layer.ts`) while the cockpit is switched on. By hand:

    reg add HKCU\SOFTWARE\Khronos\OpenXR\1\ApiLayers\Implicit /v <repo>\out\openxr-layer\edssi_openxr_layer.json /t REG_DWORD /d 0 /f
    reg delete HKCU\SOFTWARE\Khronos\OpenXR\1\ApiLayers\Implicit /v <repo>\out\openxr-layer\edssi_openxr_layer.json /f

From a shell inside a packaged app (the Claude desktop app is one), HKCU writes are virtualised
into the package and the game never sees them — run `reg` through a process outside it, e.g.
`Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{CommandLine='reg add ...'}`.

## include/openxr

`openxr.h`, `openxr_platform.h`, `openxr_platform_defines.h` and `openxr_loader_negotiation.h`,
vendored verbatim from KhronosGroup/OpenXR-SDK at tag `release-1.1.46` (Apache-2.0 OR MIT), the
same version as the loader Elite Dangerous ships. Replace them whole to update.
