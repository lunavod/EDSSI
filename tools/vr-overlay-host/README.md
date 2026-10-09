# vr-overlay-host

The process that owns EDSSI's SteamVR overlay. `npm run vr:build` puts it in
`out/vr-overlay-host/`, where `src/main/vr/host.ts` looks for it.

It reads the framed messages described in `src/main/vr/protocol.ts` from stdin — a handle to each
frame's GPU texture, or the pixels themselves where a handle cannot be shared, and JSON saying
where to hang each quad — and writes one JSON object per line to stdout saying what it did. It
exits when stdin closes.

`--selftest` reads the same messages without touching SteamVR and reports what it made of each
one. Given `--parent <pid>` it also opens each texture handle for real, so the part that cannot be
reasoned about — duplicating a handle out of EDSSI's process and opening it on a device of our
own — is checked on a machine with no headset attached.

## Vortice.Direct3D11

The one NuGet dependency, and the reason there is one: EDSSI's panels are already on the GPU, so
the host is given an NT handle to each frame rather than its pixels, and opening that means
`ID3D11Device1::OpenSharedResource1`. Reaching it by hand would mean counting forty-seven entries
down a COM vtable to find it — a number nothing would check and a crash if it were wrong. The
binding is a few hundred kilobytes beside the exe and removes that whole class of mistake.

`SharedTextures.cs` is the only file that uses it, and nothing here renders. The device exists to
do three things: open the texture EDSSI painted into, copy it into one of its own — which is what
orders Chromium's drawing against SteamVR's reading, since these are three different devices and a
`bgra` shared texture carries no keyed mutex — and hand SteamVR the copy's **shared handle**, not
the texture. `docs/vr.md` says why that last distinction is the difference between a cockpit that
works and one that is quietly a frame behind.

## openvr_api.cs

Vendored verbatim from Valve's own generated C# binding, so the `IVROverlay` function table layout
is right by construction rather than by hand:

    https://raw.githubusercontent.com/ValveSoftware/openvr/v2.5.1/headers/openvr_api.cs

Pinned at tag `v2.5.1`. Don't edit it by hand; replace the whole file to update. The Unity bits in
it are behind `#if UNITY_*` and compile out.

`openvr_api.dll` is deliberately **not** vendored. `Program.cs` resolves it from the installed
SteamVR runtime (via `%LOCALAPPDATA%\openvr\openvrpaths.vrpath`), which means the binding always
talks to the runtime the commander is actually using, and EDSSI redistributes nothing of Valve's.
