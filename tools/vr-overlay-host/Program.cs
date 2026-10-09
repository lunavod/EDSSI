// The overlay half of EDSSI's VR cockpit. See README.md for why it is a separate process.
//
// It reads framed messages from stdin — frames of pixels, each naming its panel, and JSON saying
// where the rig and every panel in it hangs — and writes one JSON object per line to stdout. It
// owns one SteamVR overlay per panel and has no other behaviour: no input, no windows, no game
// knowledge, and no geometry of its own beyond composing what it is given with the anchor it takes
// from the head (the maths is in src/main/vr/transform.ts, where it can be tested).

using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

using Vortice.Direct3D11;

using Valve.VR;

namespace Edssi.VrOverlayHost;

internal static class Program
{
    private const string OverlayKeyPrefix = "com.edssi.vr.";

    /// <summary>
    /// How long the main loop waits for work before looking at SteamVR's event queue again.
    ///
    /// Only an idle timeout: a frame or a state message wakes the loop at once, so nothing waits
    /// on this. It was briefly 16 ms, from handing the panels over again every turn to chase a
    /// frame of lag that turned out to be the submission type — see `Submit`.
    /// </summary>
    private const int IdleMilliseconds = 50;

    /// <summary>
    /// Seated space, not standing: recentring the view — which commanders do often — moves the
    /// seated origin with the cockpit, so panels pinned in it stay where they were put rather than
    /// being left behind in the room.
    /// </summary>
    private const ETrackingUniverseOrigin Universe = ETrackingUniverseOrigin.TrackingUniverseSeated;

    /// How far off the line of sight a panel may be and still count as the one being looked at.
    private const float GazeCosine = 0.80f;

    /// <summary>
    /// How often a panel with nothing to show asks EDSSI for a frame again. See `AskForFrames`.
    /// </summary>
    private const long AskEveryMilliseconds = 1000;

    /**
     * The EDSSI that started us, when it said who it was. Closing stdin is the wind-down this is
     * written around, but a process that is killed outright never closes anything — and an overlay
     * host left behind goes on holding its overlay keys, so the next EDSSI gets `KeyInUse` and the
     * commander sees a stale cockpit from a build that no longer exists. Watching the parent makes
     * that impossible however EDSSI dies.
     */
    private static Process? parent;

    private static int Main(string[] args)
    {
        // stdout carries the protocol's replies, so anything else must go to stderr.
        var replies = Console.Out;

        var told = Array.IndexOf(args, "--parent");
        if (told >= 0 && told + 1 < args.Length && int.TryParse(args[told + 1], out var parentId))
        {
            try
            {
                parent = Process.GetProcessById(parentId);
            }
            catch (ArgumentException)
            {
                // Already gone: there is nothing to serve, so don't take an overlay key for it.
                return 0;
            }
        }

        // Everything up to SteamVR can be checked without a headset: --selftest reads the same
        // messages and says what it made of them, so the framing and the swizzle can be tested
        // against the encoder in src/main/vr/protocol.ts.
        if (args.Contains("--selftest")) return SelfTest(replies);

        string runtime;
        try
        {
            runtime = OpenVrRuntime.Bind();
        }
        catch (Exception error)
        {
            Reply(replies, new Reply("error", $"SteamVR's openvr_api.dll could not be loaded: {error.Message}"));
            return 1;
        }

        var initError = EVRInitError.None;
        OpenVR.Init(ref initError, EVRApplicationType.VRApplication_Overlay);
        if (initError != EVRInitError.None)
        {
            // Most often SteamVR running with no headset connected: not a fault, and EDSSI tries again.
            Reply(replies, new Reply("unavailable", $"SteamVR would not start the overlay: {initError}."));
            return 1;
        }

        // Opening EDSSI's own textures needs a device of our own and the right to take handles from
        // its process. Without both, EDSSI has to send pixels instead — so this is reported rather
        // than fatal, and `ready` says which of the two it is going to be.
        SharedTextures? textures = null;
        var textureProblem = "no parent process was named, so its frames cannot be shared";
        if (parent is not null)
        {
            // Which graphics adapter SteamVR is running on. A shared texture cannot cross from one
            // adapter to another, so on a machine with two this is the one that matters.
            int? adapter = null;
            if (OpenVR.System is not null)
            {
                var index = -1;
                OpenVR.System.GetDXGIOutputInfo(ref index);
                if (index >= 0) adapter = index;
            }

            textures = SharedTextures.TryCreate(parent.Id, adapter, out textureProblem);
        }

        if (textures is null)
        {
            Reply(replies, new Reply("error", $"sharing textures is off: {textureProblem}."));
        }
        else
        {
            Reply(replies, new Reply("textures", $"frames are opened on {textures.Adapter}."));
        }

        try
        {
            Reply(
                replies,
                new Reply("ready", "the overlay host is up.")
                {
                    Runtime = runtime,
                    Textures = textures is not null,
                });
            return Run(replies, OpenVR.Overlay, textures);
        }
        finally
        {
            textures?.Dispose();
            OpenVR.Shutdown();
        }
    }

    private static int Run(TextWriter replies, CVROverlay overlay, SharedTextures? textures)
    {
        using var mailbox = new Mailbox();
        var reader = new Thread(() => Read(Console.OpenStandardInput(), mailbox)) { IsBackground = true };
        reader.Start();

        var panels = new Dictionary<string, PanelOverlay>();
        var vrEvent = default(VREvent_t);
        var eventSize = (uint)Marshal.SizeOf<VREvent_t>();

        // A world-locked rig hangs where the commander was looking when it was pinned. The state
        // carries a counter rather than an order to pin: when it changes, the head's pose is taken
        // afresh. Taking it can fail — the headset may be asleep — so the want is remembered and
        // tried again every time round until it works.
        var anchor = default(HmdMatrix34_t);
        var haveAnchor = false;
        var wantAnchor = true;
        var pinnedFor = int.MinValue;
        var headRefused = false;
        RigState? rig = null;
        var gazing = "";

        while (true)
        {
            var (frame, texture, spent, state, closed) = mailbox.Take(IdleMilliseconds);

            // Frames a newer one arrived before we reached. Nothing was done with them, but EDSSI
            // is holding each one until it hears otherwise, so they go back now.
            foreach (var missed in spent)
            {
                Reply(replies, new Reply("took", $"{missed.Panel} {missed.Handle}"));
            }

            if (state is not null)
            {
                rig = state;
                if (state.Anchor != pinnedFor)
                {
                    pinnedFor = state.Anchor;
                    wantAnchor = true;
                }

                Reconcile(replies, overlay, panels, state);
            }

            if (rig is not null)
            {
                // Taking the head's pose may only start working a moment from now, so this is done
                // every time round rather than only when a state message arrives.
                if (wantAnchor)
                {
                    if (TryReadHead(out var head))
                    {
                        anchor = Upright(head);
                        haveAnchor = true;
                        wantAnchor = false;
                        headRefused = false;
                        Reply(replies, new Reply("anchor",
                            $"pinned at {anchor.m3:0.00},{anchor.m7:0.00},{anchor.m11:0.00}."));
                    }
                    else if (!headRefused)
                    {
                        headRefused = true;
                        Reply(replies, new Reply("error",
                            "SteamVR would not say where the headset is, so the cockpit cannot be"
                                + " pinned in the world; it is following the head instead."));
                    }
                }

                Place(replies, overlay, panels, rig, anchor, haveAnchor);
                Look(replies, panels, rig, anchor, haveAnchor, ref gazing);
            }

            if (frame is not null && panels.TryGetValue(frame.Panel, out var target))
            {
                Upload(replies, overlay, target, frame);
            }

            if (texture is not null)
            {
                // Copied by now, so the frame goes back to Chromium. See `Submit`.
                var finished = panels.TryGetValue(texture.Panel, out var textured)
                    ? Submit(replies, overlay, textures, textured, texture)
                    : texture.Handle;
                if (finished is not null)
                {
                    Reply(replies, new Reply("took", $"{texture.Panel} {finished}"));
                }
            }

            foreach (var panel in panels.Values) Show(replies, overlay, panel, rig?.Visible == true);
            AskForFrames(replies, panels);

            // A well behaved overlay app lets go when SteamVR is shutting down rather than being
            // killed; without this it would spin until EDSSI closed its stdin.
            while (OpenVR.System is not null && OpenVR.System.PollNextEvent(ref vrEvent, eventSize))
            {
                if (vrEvent.eventType != (uint)EVREventType.VREvent_Quit) continue;
                Reply(replies, new Reply("quit", "SteamVR is shutting down."));
                OpenVR.System.AcknowledgeQuit_Exiting();
                Destroy(overlay, panels);
                return 0;
            }

            if (closed || Orphaned())
            {
                Destroy(overlay, panels);
                return 0;
            }
        }
    }

    /// <summary>Creates an overlay for every panel EDSSI has, and lets go of any it no longer has.</summary>
    private static void Reconcile(
        TextWriter replies,
        CVROverlay overlay,
        Dictionary<string, PanelOverlay> panels,
        RigState state)
    {
        var wanted = state.Panels.Select(panel => panel.Id).ToHashSet();

        foreach (var id in panels.Keys.Where(id => !wanted.Contains(id)).ToList())
        {
            overlay.DestroyOverlay(panels[id].Handle);
            panels[id].Frames.Dispose();
            panels.Remove(id);
            Reply(replies, new Reply("panel", $"{id}: overlay destroyed."));
        }

        foreach (var panel in state.Panels)
        {
            if (panels.ContainsKey(panel.Id)) continue;
            ulong handle = 0;
            var error = overlay.CreateOverlay(OverlayKeyPrefix + panel.Id, $"EDSSI {panel.Id}", ref handle);
            if (error != EVROverlayError.None)
            {
                Reply(replies, new Reply("error", $"{panel.Id} could not be created: {error}."));
                continue;
            }

            // Chromium hands us premultiplied alpha; saying so is what keeps the edges of a
            // translucent panel from being ringed with black.
            overlay.SetOverlayFlag(handle, VROverlayFlags.IsPremultiplied, true);
            // Not asking for a frame straight away: EDSSI sends one for every panel it has as soon
            // as it hears `ready`, and those are on their way.
            panels[panel.Id] = new PanelOverlay
            {
                Id = panel.Id,
                Handle = handle,
                AskedAt = Environment.TickCount64,
            };
            Reply(replies, new Reply("panel", $"{panel.Id}: overlay created."));
        }
    }

    /// <summary>Hangs every panel where the state says, head-locked or in the world.</summary>
    private static void Place(
        TextWriter replies,
        CVROverlay overlay,
        Dictionary<string, PanelOverlay> panels,
        RigState rig,
        HmdMatrix34_t anchor,
        bool haveAnchor)
    {
        var world = rig.Lock == "world" && haveAnchor;
        foreach (var state in rig.Panels)
        {
            if (!panels.TryGetValue(state.Id, out var panel)) continue;

            // Only what has actually changed. This loop comes round every 50 ms when the cockpit
            // is idle and far faster while frames are arriving, and re-issuing a property SteamVR
            // already holds is not free: setting the width or the curvature rebuilds the overlay's
            // geometry, which is a rebuild in the middle of a frame that is being drawn.
            if (!Near(panel.LastWidth, state.WidthMeters))
            {
                panel.LastWidth = state.WidthMeters;
                overlay.SetOverlayWidthInMeters(panel.Handle, state.WidthMeters);
            }

            if (!Near(panel.LastAlpha, state.Alpha))
            {
                panel.LastAlpha = state.Alpha;
                overlay.SetOverlayAlpha(panel.Handle, state.Alpha);
            }

            if (!Near(panel.LastCurvature, state.Curvature))
            {
                panel.LastCurvature = state.Curvature;
                overlay.SetOverlayCurvature(panel.Handle, state.Curvature);
            }

            var local = state.ToMatrix();
            // Head-locked, the matrix is relative to the headset and SteamVR follows it for us; in
            // the world it is composed with the anchor, which only moves when the rig is re-pinned.
            var wanted = world ? Concat(anchor, local) : local;
            if (panel.Positioned && panel.LastWorld == world && Same(panel.LastMatrix, wanted))
            {
                continue;
            }

            panel.Positioned = true;
            panel.LastWorld = world;
            panel.LastMatrix = wanted;

            var placed = world
                ? overlay.SetOverlayTransformAbsolute(panel.Handle, Universe, ref wanted)
                : overlay.SetOverlayTransformTrackedDeviceRelative(
                    panel.Handle, OpenVR.k_unTrackedDeviceIndex_Hmd, ref wanted);

            if (placed != panel.LastPlaced)
            {
                panel.LastPlaced = placed;
                if (placed != EVROverlayError.None)
                {
                    Reply(replies, new Reply("error", $"{state.Id}'s transform was refused: {placed}."));
                }
            }
        }
    }

    /// <summary>
    /// Which panel the commander is looking at, so EDSSI knows what the tuning keys should act on.
    /// The nearest to the line of sight wins, and only within a cone: looking away from the whole
    /// cockpit should leave the last choice alone rather than picking something at random.
    /// </summary>
    private static void Look(
        TextWriter replies,
        Dictionary<string, PanelOverlay> panels,
        RigState rig,
        HmdMatrix34_t anchor,
        bool haveAnchor,
        ref string gazing)
    {
        if (!TryReadHead(out var head)) return;
        var world = rig.Lock == "world" && haveAnchor;
        var origin = world ? anchor : head;

        var (fx, fy, fz) = Normalize(-head.m2, -head.m6, -head.m10);
        var best = "";
        var bestCosine = GazeCosine;

        foreach (var state in rig.Panels)
        {
            if (!panels.ContainsKey(state.Id) || !state.Gaze) continue;
            var placed = Concat(origin, state.ToMatrix());
            var (dx, dy, dz) = Normalize(placed.m3 - head.m3, placed.m7 - head.m7, placed.m11 - head.m11);
            var cosine = (fx * dx) + (fy * dy) + (fz * dz);
            if (cosine <= bestCosine) continue;
            bestCosine = cosine;
            best = state.Id;
        }

        if (best == "" || best == gazing) return;
        gazing = best;
        Reply(replies, new Reply("gaze", best));
    }

    /// <summary>
    /// Hands SteamVR the texture Chromium drew into, rather than a copy of its pixels. Answers the
    /// handle EDSSI may now let go of, or null if it must go on holding them all.
    ///
    /// Nothing is let go of at the moment it is submitted, and that is the whole of what this has
    /// to get right. SetOverlayTexture does not copy: it takes note of the texture and the
    /// compositor reads it when it next draws, which is after this has returned. So the texture
    /// opened here is kept until the one after it has been submitted, and only then is EDSSI told
    /// it may have the frame back — releasing either of them early leaves SteamVR reading a
    /// texture that has been destroyed or drawn over, which shows as a panel that is simply not
    /// there. SetOverlayRaw, which the seam lines still use, copies as it is called and needs none
    /// of this.
    ///
    /// The bounds are the point of the coded size: Chromium draws into whatever texture in its pool
    /// is big enough, so the page is usually a corner of something larger, and an overlay told to
    /// show the whole texture shows the empty rest of it too.
    /// </summary>
    private static ulong? Submit(
        TextWriter replies,
        CVROverlay overlay,
        SharedTextures? textures,
        PanelOverlay panel,
        TextureFrame frame)
    {
        if (textures is null) return frame.Handle;
        var opened = textures.Import(frame.Handle, panel.Frames);
        if (opened is null)
        {
            if (!panel.TextureRefused)
            {
                panel.TextureRefused = true;
                Reply(replies, new Reply("error", $"{panel.Id}: its frame could not be opened."));
            }

            // Nothing was done with it, so it goes straight back.
            return frame.Handle;
        }

        panel.TextureRefused = false;
        if (textures.Moved is not null)
        {
            Reply(replies, new Reply("textures", $"{textures.Moved}."));
            textures.ClearMoved();
        }

        // v runs down the texture, the way Chromium's rows do, so the top of the page is vMin.
        var across = frame.CodedWidth == 0 ? 1f : frame.CodedWidth;
        var down = frame.CodedHeight == 0 ? 1f : frame.CodedHeight;
        var bounds = new VRTextureBounds_t
        {
            uMin = frame.X / across,
            vMin = frame.Y / down,
            uMax = (frame.X + frame.Width) / across,
            vMax = (frame.Y + frame.Height) / down,
        };
        if (!Same(panel.LastBounds, bounds))
        {
            panel.LastBounds = bounds;
            overlay.SetOverlayTextureBounds(panel.Handle, ref bounds);
        }

        // The handle, not the texture. A texture pointer belongs to this process's device, and the
        // compositor runs in its own, so it has to take a copy — on its schedule rather than ours,
        // which is a frame arriving late and every panel showing the one before it. Handed the
        // shared handle it opens the surface itself and reads what is in it.
        var submitted = new Texture_t
        {
            handle = opened.Handle,
            eType = ETextureType.DXGISharedHandle,
            eColorSpace = EColorSpace.Auto,
        };
        var sent = overlay.SetOverlayTexture(panel.Handle, ref submitted);
        panel.HasTexture = panel.HasTexture || sent == EVROverlayError.None;

        if (!panel.Described)
        {
            panel.Described = true;
            var shape = opened.Texture.Description;
            Reply(replies, new Reply("frame",
                $"{panel.Id}: {shape.Width}x{shape.Height} {shape.Format}"
                    + $" bind={shape.BindFlags} misc={shape.MiscFlags}"
                    + $" bounds {bounds.uMin:0.###},{bounds.vMin:0.###}"
                    + $"-{bounds.uMax:0.###},{bounds.vMax:0.###}"));
        }

        if (sent != panel.LastUpload)
        {
            panel.LastUpload = sent;
            Reply(
                replies,
                sent == EVROverlayError.None
                    ? new Reply("frame", $"{panel.Id}: textures are going through.")
                    : new Reply("error", $"SteamVR refused a {panel.Id} texture: {sent}."));
        }

        // Copied, so Chromium may have the frame straight back.
        return frame.Handle;
    }

    private static void Upload(TextWriter replies, CVROverlay overlay, PanelOverlay panel, Frame frame)
    {
        // A texture that changes shape may be refused while the old one is still held, and letting
        // go of it costs nothing when the shape has not changed anyway.
        if (frame.Width != panel.Width || frame.Height != panel.Height)
        {
            overlay.ClearOverlayTexture(panel.Handle);
            panel.Width = frame.Width;
            panel.Height = frame.Height;
            Reply(
                replies,
                new Reply("frame", $"{panel.Id}: texture cleared for a new {frame.Width}x{frame.Height}."));
        }

        var upload = Send(overlay, panel.Handle, frame);
        // Sticky, and deliberately so: SteamVR holds the last texture it took, so a frame it
        // refuses leaves a panel that is still perfectly readable on screen. Clearing this on a
        // failure hid that panel until the next frame landed and then showed it again — which is
        // a cockpit that blinks every time the app repaints under load.
        if (upload == EVROverlayError.None) panel.HasTexture = true;
        if (upload == panel.LastUpload) return;
        panel.LastUpload = upload;
        Reply(
            replies,
            upload == EVROverlayError.None
                ? new Reply("frame", $"{panel.Id} frames are going through.")
                : new Reply("error", $"SteamVR refused a {panel.Id} frame: {upload}."));
    }

    /// <summary>
    /// Puts a panel up or down. Nothing is shown until a texture has ever arrived for it — ever,
    /// not lately: a panel hidden while nothing was happening on it could otherwise never be
    /// allowed back, and one whose latest frame was refused would blink rather than simply keep
    /// showing what SteamVR is still holding.
    /// </summary>
    private static void Show(TextWriter replies, CVROverlay overlay, PanelOverlay panel, bool wanted)
    {
        var show = wanted && panel.HasTexture;
        if (show == panel.Shown) return;
        panel.Shown = show;
        if (show) overlay.ShowOverlay(panel.Handle);
        else overlay.HideOverlay(panel.Handle);
        Reply(replies, new Reply("shown", $"{panel.Id}: {(show ? "shown" : "hidden")}."));
    }

    /// <summary>
    /// Asks EDSSI to paint again every panel that has never had a frame reach SteamVR.
    ///
    /// A page paints only when something on it changes, so a panel whose frames all went astray
    /// has nothing to show and nothing coming. Frames go astray at startup: sent before this host
    /// was running or had made the overlay, or refused while SteamVR was still starting. EDSSI asks
    /// every panel for a frame when this host says `ready`, but that one can be lost the same way.
    /// Most panels soon change and paint again anyway. The Comms panel says the same thing until
    /// the commander next speaks, so it stayed missing from the cockpit until push-to-talk. Asking
    /// until a frame lands costs one repaint a second, and only while a panel is blank.
    /// </summary>
    private static void AskForFrames(TextWriter replies, Dictionary<string, PanelOverlay> panels)
    {
        var now = Environment.TickCount64;
        foreach (var panel in panels.Values)
        {
            if (panel.HasTexture || now - panel.AskedAt < AskEveryMilliseconds) continue;
            panel.AskedAt = now;
            Reply(replies, new Reply("want", panel.Id));
        }
    }

    private static void Destroy(CVROverlay overlay, Dictionary<string, PanelOverlay> panels)
    {
        foreach (var panel in panels.Values)
        {
            overlay.DestroyOverlay(panel.Handle);
            // Only once the overlay is gone: until it is, SteamVR may still read what it holds.
            panel.Frames.Dispose();
        }

        panels.Clear();
    }

    /// <summary>
    /// Reads the stream and reports what each message turned out to be, without touching SteamVR.
    /// A frame is reported by its panel and size and its first pixel as SteamVR would receive it —
    /// RGBA hex, so the byte order the swizzle produces is visible rather than assumed.
    /// </summary>
    private static int SelfTest(TextWriter replies)
    {
        // The riskiest part of the whole path is opening someone else's GPU texture: a handle
        // duplicated out of EDSSI's process and opened on a device of our own. None of that needs
        // SteamVR, so the self-test does it for real and says what it found — which is the only way
        // it gets checked without a headset.
        SharedTextures? textures = null;
        if (parent is not null)
        {
            textures = SharedTextures.TryCreate(parent.Id, null, out var problem);
            Reply(
                replies,
                textures is null
                    ? new Reply("error", $"textures cannot be shared: {problem}.")
                    : new Reply("textures",
                        $"ready to open EDSSI's textures (pid {parent.Id}) on {textures.Adapter}."));
        }

        using var into = new FrameTarget();
        using var mailbox = new Mailbox();
        var reader = new Thread(() => Read(Console.OpenStandardInput(), mailbox)) { IsBackground = true };
        reader.Start();

        while (true)
        {
            var (frame, texture, _, state, closed) = mailbox.Take(100);

            if (texture is not null)
            {
                var said =
                    $"{texture.Panel} {texture.Width}x{texture.Height}"
                    + $" at {texture.X},{texture.Y}"
                    + $" of {texture.CodedWidth}x{texture.CodedHeight}"
                    + $" handle=0x{texture.Handle:x}";
                if (textures is not null)
                {
                    // Import, not Open: the copy is the part worth checking, and the destination
                    // is kept between frames here exactly as a panel's is.
                    var opened = textures.Import(texture.Handle, into);
                    if (opened is null)
                    {
                        said += "  OPEN FAILED";
                    }
                    else
                    {
                        var d = opened.Texture.Description;
                        said += $"  copied {d.Width}x{d.Height} {d.Format}"
                            + $" bind={d.BindFlags} misc={d.MiscFlags}"
                            + $" middle bgra={textures.Sample(opened.Texture, (int)d.Width / 2, (int)d.Height / 2)}";
                    }
                }

                Reply(replies, new Reply("texture", said));
            }

            if (frame is not null)
            {
                Swizzle(frame.Pixels);
                var first = frame.Pixels.Length >= 4
                    ? Convert.ToHexString(frame.Pixels, 0, 4).ToLowerInvariant()
                    : "";
                Reply(replies, new Reply("frame", $"{frame.Panel} {frame.Width}x{frame.Height} rgba={first}"));
            }

            if (state is not null)
            {
                var described = string.Join(
                    "; ",
                    state.Panels.Select(panel =>
                        $"{panel.Id} at {panel.Matrix[3]:0.00},{panel.Matrix[7]:0.00},{panel.Matrix[11]:0.00}"
                            + $" w={panel.WidthMeters:0.00}"));
                Reply(replies, new Reply("state",
                    $"visible={state.Visible} lock={state.Lock} anchor={state.Anchor} :: {described}"));
            }

            if (closed || Orphaned())
            {
                textures?.Dispose();
                return 0;
            }
        }
    }

    /// <summary>Whether two values are the same as far as SteamVR is concerned. NaN is never.</summary>
    private static bool Near(float a, float b) => Math.Abs(a - b) < 1e-6f;

    private static bool Same(VRTextureBounds_t a, VRTextureBounds_t b) =>
        Near(a.uMin, b.uMin) && Near(a.vMin, b.vMin) && Near(a.uMax, b.uMax) && Near(a.vMax, b.vMax);

    /// <summary>Whether a pose is the one already applied, to within what a headset could show.</summary>
    private static bool Same(HmdMatrix34_t a, HmdMatrix34_t b) =>
        Near(a.m0, b.m0) && Near(a.m1, b.m1) && Near(a.m2, b.m2) && Near(a.m3, b.m3)
        && Near(a.m4, b.m4) && Near(a.m5, b.m5) && Near(a.m6, b.m6) && Near(a.m7, b.m7)
        && Near(a.m8, b.m8) && Near(a.m9, b.m9) && Near(a.m10, b.m10) && Near(a.m11, b.m11);

    /// <summary>Whether the EDSSI that started us has gone, and taken our reason to exist with it.</summary>
    private static bool Orphaned() => parent is { HasExited: true };

    /// <summary>Hands one frame of premultiplied BGRA to SteamVR as a panel's texture.</summary>
    private static unsafe EVROverlayError Send(CVROverlay overlay, ulong handle, Frame frame)
    {
        var pixels = frame.Pixels;
        Swizzle(pixels);
        fixed (byte* bytes = pixels)
        {
            return overlay.SetOverlayRaw(handle, (IntPtr)bytes, frame.Width, frame.Height, 4);
        }
    }

    /// <summary>
    /// Turns Chromium's BGRA into the RGBA SteamVR wants, by trading the red and blue byte of every
    /// pixel. In place: the buffer is ours, and is thrown away as soon as the frame has been taken.
    /// </summary>
    private static unsafe void Swizzle(byte[] pixels)
    {
        fixed (byte* bytes = pixels)
        {
            var words = (uint*)bytes;
            for (var i = 0; i < pixels.Length / 4; i++)
            {
                var word = words[i];
                words[i] = (word & 0xFF00FF00u)
                    | ((word & 0x000000FFu) << 16)
                    | ((word >> 16) & 0x000000FFu);
            }
        }
    }

    /// <summary>The headset's pose in tracking space, if it is currently known.</summary>
    private static bool TryReadHead(out HmdMatrix34_t head)
    {
        head = default;
        if (OpenVR.System is null) return false;

        var poses = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];
        OpenVR.System.GetDeviceToAbsoluteTrackingPose(Universe, 0f, poses);
        var hmd = poses[OpenVR.k_unTrackedDeviceIndex_Hmd];
        if (!hmd.bPoseIsValid) return false;

        head = hmd.mDeviceToAbsoluteTracking;
        return true;
    }

    /// <summary>
    /// The same pose with the head tilt taken out: the cockpit keeps the direction the commander
    /// was looking, up and down as well as round, but is never hung at a jaunty angle because they
    /// happened to have their head on one side.
    /// </summary>
    private static HmdMatrix34_t Upright(HmdMatrix34_t head)
    {
        // OpenVR looks down -Z, so forward is the negated third column.
        var (fx, fy, fz) = Normalize(-head.m2, -head.m6, -head.m10);
        // Looking straight up or down leaves no way to tell which way round is: keep what we have.
        var (rx, ry, rz) = Cross(fx, fy, fz, 0f, 1f, 0f);
        var length = MathF.Sqrt((rx * rx) + (ry * ry) + (rz * rz));
        if (length < 1e-4f) return head;

        (rx, ry, rz) = (rx / length, ry / length, rz / length);
        var (ux, uy, uz) = Cross(rx, ry, rz, fx, fy, fz);

        return new HmdMatrix34_t
        {
            m0 = rx, m1 = ux, m2 = -fx, m3 = head.m3,
            m4 = ry, m5 = uy, m6 = -fy, m7 = head.m7,
            m8 = rz, m9 = uz, m10 = -fz, m11 = head.m11,
        };
    }

    /// <summary>One 3x4 affine transform applied after another: `outer` then `inner`.</summary>
    private static HmdMatrix34_t Concat(HmdMatrix34_t outer, HmdMatrix34_t inner)
    {
        float[] a = [outer.m0, outer.m1, outer.m2, outer.m3, outer.m4, outer.m5, outer.m6, outer.m7, outer.m8, outer.m9, outer.m10, outer.m11];
        float[] b = [inner.m0, inner.m1, inner.m2, inner.m3, inner.m4, inner.m5, inner.m6, inner.m7, inner.m8, inner.m9, inner.m10, inner.m11];
        var product = new float[12];
        for (var row = 0; row < 3; row++)
        {
            for (var column = 0; column < 4; column++)
            {
                var sum = column == 3 ? a[(row * 4) + 3] : 0f;
                for (var k = 0; k < 3; k++) sum += a[(row * 4) + k] * b[(k * 4) + column];
                product[(row * 4) + column] = sum;
            }
        }

        return new HmdMatrix34_t
        {
            m0 = product[0], m1 = product[1], m2 = product[2], m3 = product[3],
            m4 = product[4], m5 = product[5], m6 = product[6], m7 = product[7],
            m8 = product[8], m9 = product[9], m10 = product[10], m11 = product[11],
        };
    }

    private static (float X, float Y, float Z) Cross(
        float ax, float ay, float az, float bx, float by, float bz) =>
        ((ay * bz) - (az * by), (az * bx) - (ax * bz), (ax * by) - (ay * bx));

    private static (float X, float Y, float Z) Normalize(float x, float y, float z)
    {
        var length = MathF.Sqrt((x * x) + (y * y) + (z * z));
        return length < 1e-6f ? (0f, 0f, -1f) : (x / length, y / length, z / length);
    }

    /// <summary>Reads framed messages until the pipe closes, handing the newest of each to the loop.</summary>
    private static void Read(Stream input, Mailbox mailbox)
    {
        var header = new byte[Protocol.HeaderBytes];
        try
        {
            while (true)
            {
                if (!ReadExactly(input, header, header.Length)) break;
                if (header[0] != Protocol.Magic) throw new InvalidDataException("the stream lost its place");

                var kind = header[1];
                var length = (long)BitConverter.ToUInt32(header, 2);
                if (length > Protocol.MaxPayloadBytes)
                    throw new InvalidDataException($"a {length}-byte message is out of range");

                var payload = new byte[length];
                if (!ReadExactly(input, payload, payload.Length)) break;

                switch (kind)
                {
                    case Protocol.Frame:
                        mailbox.Post(Frame.Parse(payload));
                        break;
                    case Protocol.Texture:
                        mailbox.Post(TextureFrame.Parse(payload));
                        break;
                    case Protocol.State:
                        var state = JsonSerializer.Deserialize<RigState>(payload, Protocol.Json);
                        if (state is not null) mailbox.Post(state);
                        break;
                    default:
                        // A newer EDSSI talking to an older host: skipping it beats dying.
                        Console.Error.WriteLine($"[vr-overlay-host] ignoring message kind {kind}");
                        break;
                }
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"[vr-overlay-host] the pipe failed: {error.Message}");
        }
        finally
        {
            mailbox.Close();
        }
    }

    private static bool ReadExactly(Stream input, byte[] into, int count)
    {
        var read = 0;
        while (read < count)
        {
            var got = input.Read(into, read, count - read);
            if (got <= 0) return false;
            read += got;
        }

        return true;
    }

    private static void Reply(TextWriter replies, Reply reply)
    {
        replies.WriteLine(JsonSerializer.Serialize(reply, Protocol.Json));
        replies.Flush();
    }
}

/// <summary>One panel's overlay, and what SteamVR currently holds for it.</summary>
internal sealed class PanelOverlay
{
    public required string Id { get; init; }
    public required ulong Handle { get; init; }
    public uint Width { get; set; }
    public uint Height { get; set; }
    public bool HasTexture { get; set; }

    /// When EDSSI was last asked for a frame for this panel, while it had none. See `AskForFrames`.
    public long AskedAt { get; set; }

    public bool Shown { get; set; }
    public EVROverlayError LastUpload { get; set; } = EVROverlayError.None;
    public EVROverlayError LastPlaced { get; set; } = EVROverlayError.None;

    /// Whether the last attempt to open a frame of this panel's failed, so it is said once.
    public bool TextureRefused { get; set; }

    public VRTextureBounds_t LastBounds;

    /// <summary>
    /// The textures SteamVR is given: ours, two of them used in turn, each holding a copy of what
    /// Chromium drew. Kept for the life of the overlay, since SteamVR reads one after being handed
    /// it — which is why there are two.
    /// </summary>
    public FrameTarget Frames { get; } = new();

    /// <summary>Whether what SteamVR was given has been described in the log once.</summary>
    public bool Described { get; set; }

    /// What SteamVR was last told, so it is not told again. NaN is "never".
    public float LastWidth { get; set; } = float.NaN;
    public float LastAlpha { get; set; } = float.NaN;
    public float LastCurvature { get; set; } = float.NaN;
    public bool Positioned { get; set; }
    public bool LastWorld { get; set; }
    public HmdMatrix34_t LastMatrix;
}

/// <summary>What the host tells EDSSI, one JSON object per line on stdout.</summary>
internal sealed record Reply(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("message")] string Message)
{
    [JsonPropertyName("runtime")]
    public string? Runtime { get; init; }

    /// <summary>
    /// On `ready`: whether this host can open EDSSI's textures. False means EDSSI has to send the
    /// pixels themselves, which works but rebuilds the overlay's texture on every frame.
    /// </summary>
    [JsonPropertyName("textures")]
    public bool? Textures { get; init; }
}

/// <summary>Protocol constants, mirrored by src/main/vr/protocol.ts.</summary>
internal static class Protocol
{
    public const byte Magic = 0xED;
    public const byte Frame = 1;
    public const byte State = 2;
    public const byte Texture = 3;
    public const int HeaderBytes = 6;

    /// A frame of 4096x4096: anything larger means the stream has lost its place.
    public const long MaxPayloadBytes = 4096L * 4096L * 4L;

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

/// <summary>
/// One panel's frame as a handle to the texture Chromium drew it into, rather than as pixels.
/// Mirrored by `textureMessage` in src/main/vr/protocol.ts.
/// </summary>
internal sealed class TextureFrame
{
    public required string Panel { get; init; }
    public required uint X { get; init; }
    public required uint Y { get; init; }
    public required uint Width { get; init; }
    public required uint Height { get; init; }
    public required uint CodedWidth { get; init; }
    public required uint CodedHeight { get; init; }
    public required ulong Handle { get; init; }

    public static TextureFrame Parse(byte[] payload)
    {
        if (payload.Length < 1) throw new InvalidDataException("an empty texture");
        int idLength = payload[0];
        if (payload.Length < 1 + idLength + 32) throw new InvalidDataException("a short texture");

        var at = 1 + idLength;
        return new TextureFrame
        {
            Panel = System.Text.Encoding.UTF8.GetString(payload, 1, idLength),
            X = BitConverter.ToUInt32(payload, at),
            Y = BitConverter.ToUInt32(payload, at + 4),
            Width = BitConverter.ToUInt32(payload, at + 8),
            Height = BitConverter.ToUInt32(payload, at + 12),
            CodedWidth = BitConverter.ToUInt32(payload, at + 16),
            CodedHeight = BitConverter.ToUInt32(payload, at + 20),
            Handle = BitConverter.ToUInt64(payload, at + 24),
        };
    }
}

/// <summary>One frame of premultiplied BGRA, for one panel.</summary>
internal sealed class Frame
{
    public required string Panel { get; init; }
    public required uint Width { get; init; }
    public required uint Height { get; init; }
    public required byte[] Pixels { get; init; }

    public static Frame Parse(byte[] payload)
    {
        if (payload.Length < 1) throw new InvalidDataException("an empty frame");
        int idLength = payload[0];
        var header = 1 + idLength + 8;
        if (payload.Length < header) throw new InvalidDataException("a frame without a size");

        var panel = System.Text.Encoding.UTF8.GetString(payload, 1, idLength);
        var width = BitConverter.ToUInt32(payload, 1 + idLength);
        var height = BitConverter.ToUInt32(payload, 1 + idLength + 4);
        var pixels = payload.Length - header;
        if ((long)width * height * 4 != pixels)
            throw new InvalidDataException($"a {width}x{height} frame carrying {pixels} bytes");

        return new Frame
        {
            Panel = panel,
            Width = width,
            Height = height,
            Pixels = payload.AsSpan(header).ToArray(),
        };
    }
}

/// <summary>Where one panel hangs. Mirrored by `PanelState` in src/main/vr/protocol.ts.</summary>
internal sealed class PanelState
{
    public string Id { get; init; } = "";

    /// Row-major 3x4, worked out by EDSSI; this only composes it with the anchor.
    public float[] Matrix { get; init; } = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

    public float WidthMeters { get; init; } = 1.6f;
    public float Alpha { get; init; } = 1f;
    public float Curvature { get; init; }

    /// Whether looking at this may pick it as the panel the tuning keys act on. The seam lines say
    /// no: they hang in the gaps, which is exactly where the eye passes between two panels.
    public bool Gaze { get; init; } = true;

    public HmdMatrix34_t ToMatrix()
    {
        var m = Matrix.Length == 12 ? Matrix : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
        return new HmdMatrix34_t
        {
            m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3],
            m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7],
            m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11],
        };
    }
}

/// <summary>The whole cockpit, as EDSSI last described it.</summary>
internal sealed class RigState
{
    public bool Visible { get; init; } = true;

    /// "head" to follow the headset, "world" to hang where the commander was looking when pinned.
    public string Lock { get; init; } = "world";

    /// Bumped by EDSSI to ask for the rig to be pinned where the commander is looking now.
    public int Anchor { get; init; }

    public List<PanelState> Panels { get; init; } = [];
}

/// <summary>
/// The handover between the reading thread and the loop. Only the newest frame and the newest state
/// are kept: if the panels paint faster than SteamVR will take them, the stale frames are the ones
/// to drop, not the fresh one.
/// </summary>
internal sealed class Mailbox : IDisposable
{
    private readonly object _gate = new();
    private readonly AutoResetEvent _arrived = new(false);
    private readonly Queue<Frame> _frames = new();
    private Queue<TextureFrame> _textures = new();
    /// Frames overtaken by a newer one before the loop reached them; still owed an answer.
    private readonly Queue<TextureFrame> _spent = new();
    private RigState? _state;
    private bool _closed;

    /// <summary>
    /// At most this many frames wait at once. One per overlay and a little slack: there are five
    /// panels and one seam line per edge, and a limit below that number lets them evict each
    /// other — a seam sends one frame ever, so a seam frame dropped here is a line that never
    /// appears at all.
    /// </summary>
    private const int MaxFrames = 16;

    public void Post(Frame frame)
    {
        lock (_gate)
        {
            // A frame for a panel that already has one waiting replaces it; the newest is what
            // matters, and five panels must not be able to starve each other.
            var kept = _frames.Where(queued => queued.Panel != frame.Panel).ToList();
            _frames.Clear();
            foreach (var queued in kept.TakeLast(MaxFrames - 1)) _frames.Enqueue(queued);
            _frames.Enqueue(frame);
        }

        _arrived.Set();
    }

    /// <summary>
    /// A handle, not a picture — but queued the same way a frame is, newest per panel.
    ///
    /// It was not, at first, on the grounds that a handle is cheap and EDSSI is waiting to hear
    /// about each one. That let the queue grow without limit: five panels painting fifteen times a
    /// second put more in than the loop takes out, and what the commander sees falls further
    /// behind with every second — a panel stuck on something that has since stopped being true.
    /// The newest frame is the only one worth drawing.
    ///
    /// A superseded frame still has to be answered for, or Chromium never gets that texture back,
    /// so its handle is kept for the loop to hand over.
    /// </summary>
    public void Post(TextureFrame texture)
    {
        lock (_gate)
        {
            var kept = new Queue<TextureFrame>();
            foreach (var queued in _textures)
            {
                if (queued.Panel == texture.Panel) _spent.Enqueue(queued);
                else kept.Enqueue(queued);
            }

            _textures = kept;
            _textures.Enqueue(texture);
        }

        _arrived.Set();
    }

    public void Post(RigState state)
    {
        lock (_gate) _state = state;
        _arrived.Set();
    }

    public void Close()
    {
        lock (_gate) _closed = true;
        _arrived.Set();
    }

    public (Frame? Frame, TextureFrame? Texture, List<TextureFrame> Spent, RigState? State, bool Closed)
        Take(int timeoutMilliseconds)
    {
        _arrived.WaitOne(timeoutMilliseconds);
        lock (_gate)
        {
            var frame = _frames.Count > 0 ? _frames.Dequeue() : null;
            var texture = _textures.Count > 0 ? _textures.Dequeue() : null;
            var spent = new List<TextureFrame>(_spent);
            _spent.Clear();
            // More waiting, so come straight back round rather than idling on them.
            if (_frames.Count > 0 || _textures.Count > 0) _arrived.Set();
            var taken = (frame, texture, spent, _state, _closed);
            _state = null;
            return taken;
        }
    }

    public void Dispose() => _arrived.Dispose();
}

/// <summary>
/// Finds the openvr_api.dll belonging to the installed SteamVR runtime and points the binding's
/// DllImports at it, so EDSSI ships none of Valve's binaries and the interface versions always
/// match the runtime that is actually going to answer.
/// </summary>
internal static class OpenVrRuntime
{
    public static string Bind()
    {
        var path = Find()
            ?? throw new FileNotFoundException("no SteamVR runtime was found; is SteamVR installed?");

        NativeLibrary.SetDllImportResolver(
            typeof(OpenVR).Assembly,
            (library, _, _) => library == "openvr_api" ? NativeLibrary.Load(path) : IntPtr.Zero);
        return path;
    }

    private static string? Find()
    {
        foreach (var candidate in Candidates())
        {
            if (candidate is not null && File.Exists(candidate)) return candidate;
        }

        return null;
    }

    private static IEnumerable<string?> Candidates()
    {
        // A copy placed beside the exe wins, so a broken install can be worked around by hand.
        yield return Path.Combine(AppContext.BaseDirectory, "openvr_api.dll");

        foreach (var runtime in RegisteredRuntimes())
        {
            yield return Path.Combine(runtime, "bin", "win64", "openvr_api.dll");
        }
    }

    /// <summary>The runtimes openvrpaths.vrpath lists — the file SteamVR itself reads.</summary>
    private static IEnumerable<string> RegisteredRuntimes()
    {
        var paths = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "openvr",
            "openvrpaths.vrpath");
        if (!File.Exists(paths)) return [];

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(paths));
            if (!document.RootElement.TryGetProperty("runtime", out var listed)) return [];
            return listed.EnumerateArray().Select(entry => entry.GetString()).OfType<string>().ToList();
        }
        catch (Exception error)
        {
            Debug.WriteLine($"[vr-overlay-host] {paths} could not be read: {error.Message}");
            return [];
        }
    }
}
