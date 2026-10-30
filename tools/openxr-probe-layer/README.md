# openxr-probe-layer

A no-op OpenXR API layer that only writes down what it sees. It answers one question before
anything is built on it: can EDSSI hang its VR cockpit inside a game that runs on an OpenXR runtime
(Virtual Desktop's VDXR, say) rather than SteamVR, by being an implicit API layer, as OpenKneeboard
does? Every call is passed on unchanged.

It logs to `out/openxr-probe-layer/probe.log`, beside the DLL:

- which program loaded it, and the loader's interface and API versions;
- each `xrCreateInstance`: the application, its extensions, the layer chain, and the runtime;
- each `xrCreateSession`: the graphics binding (D3D11, D3D12, Vulkan, OpenGL), and for D3D11 the
  adapter and whether the device is an `ID3D11Device1` (which opening EDSSI's NT texture handles
  needs), the system's layer limit, and the swapchain formats;
- the first and 3000th `xrEndFrame`: how many layers the game submits, and of what kind;
- each `xrDestroySession`, with the frame count.

## Build, register, remove

Needs Visual Studio 2022 (its bundled CMake will do):

    cmake -S tools/openxr-probe-layer -B out/openxr-probe-layer-build -G "Visual Studio 17 2022" -A x64
    cmake --build out/openxr-probe-layer-build --config Release
    powershell -File tools/openxr-probe-layer/register.ps1

That registers it for the current Windows user only (`HKCU\SOFTWARE\Khronos\OpenXR\1\ApiLayers\Implicit`),
so every OpenXR program started afterwards loads it; one already running isn't affected.
`register.ps1 -Remove` takes it out. Setting `EDSSI_OPENXR_PROBE_DISABLE=1` skips it for one
program. A game running with it loaded holds the DLL, so close the game before rebuilding.

`probe-client.exe [openxr_loader.dll]` creates and destroys one instance through the given loader
(the game's own, for instance), so the layer can be seen loading without starting a game. It makes
no session, so it never takes the headset from anything.

## Headers

The vendored OpenXR headers live in `tools/openxr-layer/include`, shared with the real layer.

## What it found

It loaded in the probe client but never in the game, which turned out to have nothing to do with
the layer: it had been registered from a shell inside a packaged (MSIX) app, whose HKCU writes are
private to the package. Registered from outside it, it loaded in the game at once. `docs/vr.md`
("The OpenXR route") has the story; `tools/openxr-layer` is what was built on it. Leave this one
unregistered: the real layer logs the same things.
