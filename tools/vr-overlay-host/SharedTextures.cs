// Opening the textures EDSSI's offscreen windows paint into, so the pixels never leave the GPU.
//
// EDSSI used to send every frame down the pipe as bytes and the host handed them to SteamVR with
// SetOverlayRaw, which Valve documents as the slow path for pictures that do not change: it
// rebuilds the overlay's texture on each call, and rebuilding it while the compositor is drawing
// is what made the cockpit blink whenever a panel's content changed. Proved by freezing the
// frames — the blinking stopped with them. See docs/vr.md.
//
// Chromium already has each frame on the GPU. With `useSharedTexture` it gives EDSSI an NT handle
// to that D3D11 texture; EDSSI sends the handle instead of six megabytes, and this opens it and
// hands SteamVR the texture itself.
//
// The handle belongs to EDSSI's process, so it has to be duplicated into this one first — which is
// what the `--parent` pid is for, twice over: it already says when to exit, and now also whose
// handles these are.

using System.Runtime.InteropServices;

using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace Edssi.VrOverlayHost;

/// <summary>The D3D11 device this process opens EDSSI's frames on.</summary>
internal sealed class SharedTextures : IDisposable
{
    private const int ProcessDuplicateHandle = 0x0040;
    private const uint DuplicateSameAccess = 0x00000002;

    /// How long to wait for a copy before giving up and submitting anyway; a blit is microseconds.
    private const int CopySpinLimit = 100_000;

    private ID3D11Device _device;
    private readonly IntPtr _owner;
    private bool _fellBack;
    private ID3D11Query? _finished;

    private SharedTextures(ID3D11Device device, IntPtr owner, string adapter)
    {
        _device = device;
        _owner = owner;
        Adapter = adapter;
    }

    /// <summary>Which graphics adapter these textures are opened on, for saying so in the log.</summary>
    public string Adapter { get; private set; }

    /// <summary>Set when the adapter had to be changed, so the change can be reported once.</summary>
    public string? Moved { get; private set; }

    /// <summary>
    /// A device, and the right to take handles from EDSSI. Answers null with a reason rather than
    /// throwing: a machine that cannot do this is not broken, it just has to be sent bytes instead,
    /// and saying so is what lets EDSSI fall back.
    /// </summary>
    /// <summary>
    /// A device, and the right to take handles from EDSSI.
    ///
    /// `adapterIndex` is the one SteamVR asks to be drawn on. It matters on a machine with two
    /// graphics adapters — a laptop with an Intel chip beside its real card, say. A shared texture
    /// cannot cross from one adapter to the other, so if EDSSI's windows are drawn on one and
    /// SteamVR is running on the other, opening the handle here is what fails, and it fails
    /// whichever of the two this device is made on. Asking for SteamVR's own adapter at least puts
    /// the failure where it can be recognised rather than somewhere further along.
    /// </summary>
    public static SharedTextures? TryCreate(int parentPid, int? adapterIndex, out string problem)
    {
        var owner = OpenProcess(ProcessDuplicateHandle, false, parentPid);
        if (owner == IntPtr.Zero)
        {
            problem = $"EDSSI's process ({parentPid}) would not let its frames be shared"
                + $" (error {Marshal.GetLastWin32Error()})";
            return null;
        }

        try
        {
            using var chosen = Adapters(adapterIndex, out var named);

            // No swap chain and no rendering of our own: this device exists only to open someone
            // else's textures and name them to SteamVR.
            var result = D3D11.D3D11CreateDevice(
                chosen,
                chosen is null ? DriverType.Hardware : DriverType.Unknown,
                DeviceCreationFlags.BgraSupport,
                [FeatureLevel.Level_11_1, FeatureLevel.Level_11_0],
                out var device);
            if (result.Failure || device is null)
            {
                problem = $"no Direct3D 11 device ({result.Description.Trim()})";
                CloseHandle(owner);
                return null;
            }

            problem = "";
            return new SharedTextures(device, owner, named);
        }
        catch (Exception error)
        {
            problem = $"Direct3D 11 would not start: {error.Message}";
            CloseHandle(owner);
            return null;
        }
    }

    /// <summary>
    /// Copies one of EDSSI's frames into a texture of our own and answers it.
    ///
    /// The copy is the point. Chromium renders the frame on its device, this opens it on another,
    /// and SteamVR reads it on a third; a `bgra` shared texture carries no keyed mutex, so there is
    /// nothing keeping those three in step and nothing that says the drawing is finished. Handing
    /// SteamVR a pointer into another process's live render target is how a panel comes out empty
    /// even though every call along the way succeeded.
    ///
    /// Copying it here settles all of that at once: the copy is ordered against Chromium's writes
    /// by the driver, what SteamVR gets is a texture of ours that nothing else will touch, and the
    /// frame can go straight back to Chromium instead of being held until the next one arrives.
    /// The destination is kept and reused between frames, so this is one GPU-to-GPU blit and no
    /// allocation.
    /// </summary>
    public Shared? Import(ulong handle, FrameTarget target)
    {
        using var source = Open(handle);
        if (source is null) return null;

        var into = target.Take(_device, source.Description);
        var context = _device.ImmediateContext;
        context.CopyResource(into.Texture, source);

        // Flush only starts the copy; it does not wait for it. Handing SteamVR the texture while
        // the copy is still running is a panel showing whatever was there before — which reads as
        // a panel that updates late or not at all, with every call along the way succeeding.
        _finished ??= _device.CreateQuery(new QueryDescription(QueryType.Event));
        context.End(_finished);
        context.Flush();
        for (var spins = 0; spins < CopySpinLimit; spins++)
        {
            if (context.IsDataAvailable(_finished, AsyncGetDataFlags.DoNotFlush)) break;
            Thread.Yield();
        }

        return into;
    }

    /// <summary>
    /// The texture behind one of EDSSI's handles, or null if it cannot be opened.
    ///
    /// Opened afresh every frame rather than kept. Chromium draws into a pool of textures and hands
    /// their handles round in turn, so the same value comes back again and again — but only while
    /// that handle is open. Once EDSSI lets one go, Windows is free to give the number to something
    /// else entirely, and a cache kept by handle would then be showing the wrong picture with
    /// nothing to say it had happened. Opening each time costs a driver call and cannot be wrong.
    /// </summary>
    public ID3D11Texture2D? Open(ulong handle)
    {
        if (!DuplicateHandle(
                _owner,
                (IntPtr)handle,
                GetCurrentProcess(),
                out var ours,
                0,
                false,
                DuplicateSameAccess))
        {
            return null;
        }

        try
        {
            var opened = OpenOn(_device, ours);
            if (opened is not null) return opened;

            // A shared texture cannot cross from one graphics adapter to another, and this machine
            // may well have several. SteamVR's is the right one to submit from, so it is tried
            // first — but if EDSSI's windows turn out to be drawn somewhere else, a device on the
            // adapter Windows hands out by default is the better guess, and being able to open the
            // frame at all matters more than which adapter it came from.
            if (_fellBack) return null;
            _fellBack = true;
            var replacement = Rebuild(out var named);
            if (replacement is null) return null;
            _device.Dispose();
            _device = replacement;
            Moved = $"moved to {named} after the first frame would not open on {Adapter}";
            Adapter = named;
            return OpenOn(_device, ours);
        }
        finally
        {
            // Ours to close either way: OpenSharedResource1 takes its own reference on the texture.
            CloseHandle(ours);
        }
    }

    /// <summary>
    /// Chromium's are NT handles, which is the `1` in OpenSharedResource1; the older call only
    /// takes the handles IDXGIResource::GetSharedHandle used to make.
    /// </summary>
    private static ID3D11Texture2D? OpenOn(ID3D11Device device, IntPtr handle)
    {
        try
        {
            using var device1 = device.QueryInterfaceOrNull<ID3D11Device1>();
            return device1?.OpenSharedResource1<ID3D11Texture2D>(handle);
        }
        catch (SharpGen.Runtime.SharpGenException)
        {
            return null;
        }
    }

    /// <summary>A device on whatever adapter Windows hands out by default.</summary>
    private static ID3D11Device? Rebuild(out string named)
    {
        named = "the default adapter";
        var result = D3D11.D3D11CreateDevice(
            null,
            DriverType.Hardware,
            DeviceCreationFlags.BgraSupport,
            [FeatureLevel.Level_11_1, FeatureLevel.Level_11_0],
            out var device);
        return result.Failure ? null : device;
    }

    /// <summary>The adapter SteamVR asked for, and what it is called. Null is "whichever".</summary>
    private static IDXGIAdapter1? Adapters(int? index, out string named)
    {
        named = "the default adapter";
        try
        {
            using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
            var all = new List<string>();
            IDXGIAdapter1? chosen = null;
            for (var at = 0u; factory.EnumAdapters1(at, out var adapter).Success; at++)
            {
                all.Add($"{at}: {adapter.Description1.Description.Trim()}");
                if (index is not null && at == (uint)index.Value) chosen = adapter;
                else adapter.Dispose();
            }

            var known = all.Count == 0 ? "none" : string.Join(", ", all);
            named = chosen is null
                ? $"the default adapter (SteamVR asked for {index?.ToString() ?? "nothing"}; {known})"
                : $"{chosen.Description1.Description.Trim()} (adapter {index}; {known})";
            return chosen;
        }
        catch (Exception error)
        {
            named = $"the default adapter (the adapters could not be listed: {error.Message})";
            return null;
        }
    }

    /// <summary>Said once, then forgotten.</summary>
    public void ClearMoved() => Moved = null;

    /// <summary>
    /// One pixel of a texture, as BGRA hex, by copying it down to where the processor can read it.
    ///
    /// Only for `--selftest`: it is the difference between "every call succeeded" and "the frame
    /// actually arrived", which is a distinction this path has already hidden once.
    /// </summary>
    public string Sample(ID3D11Texture2D texture, int x, int y)
    {
        var shape = texture.Description;
        try
        {
            using var staging = _device.CreateTexture2D(new Texture2DDescription
            {
                Width = shape.Width,
                Height = shape.Height,
                Format = shape.Format,
                MipLevels = 1,
                ArraySize = 1,
                SampleDescription = new Vortice.DXGI.SampleDescription(1, 0),
                Usage = ResourceUsage.Staging,
                BindFlags = BindFlags.None,
                CPUAccessFlags = CpuAccessFlags.Read,
            });
            var context = _device.ImmediateContext;
            context.CopyResource(staging, texture);
            var mapped = context.Map(staging, 0, Vortice.Direct3D11.MapMode.Read);
            try
            {
                unsafe
                {
                    var row = (byte*)mapped.DataPointer + ((long)y * mapped.RowPitch);
                    var at = row + ((long)x * 4);
                    return $"{at[0]:x2}{at[1]:x2}{at[2]:x2}{at[3]:x2}";
                }
            }
            finally
            {
                context.Unmap(staging, 0);
            }
        }
        catch (Exception error)
        {
            return $"unreadable ({error.Message})";
        }
    }

    public void Dispose()
    {
        _finished?.Dispose();
        _device.Dispose();
        if (_owner != IntPtr.Zero) CloseHandle(_owner);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(int access, bool inherit, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateHandle(
        IntPtr sourceProcess,
        IntPtr source,
        IntPtr targetProcess,
        out IntPtr target,
        uint access,
        [MarshalAs(UnmanagedType.Bool)] bool inherit,
        uint options);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}

/// <summary>
/// One of the host's own textures, with the handle SteamVR opens it by.
///
/// The handle is what is submitted, not the texture. Passing the texture means passing a pointer
/// that belongs to this process's device, and the compositor — which is a process of its own — has
/// to take its own copy of it; the copy is taken on its schedule rather than ours, which is a frame
/// arriving late. Given the handle instead it opens the surface itself and reads what is in it.
/// This is what the texture is created `Shared` for.
/// </summary>
internal sealed record Shared(ID3D11Texture2D Texture, IntPtr Handle);

/// <summary>
/// The textures one panel's frames are copied into, used in turn.
///
/// There are four because each frame is handed over twice, under two different textures. SteamVR
/// shows the texture submitted *before* the one it is being given — a frame handed over once stays
/// invisible until the next one displaces it, which is a panel permanently one frame behind and,
/// when nothing more is painted, stuck. Offering the same texture again does not shift it; a
/// different one does. So each frame goes into two of these and is submitted twice, and the second
/// submission is what puts the first on the commander's face.
///
/// Four rather than two so that a texture being displayed is not the one written next: the pair
/// used for a frame is not the pair used for the frame after it.
/// </summary>
internal sealed class FrameTarget : IDisposable
{
    private readonly Shared?[] _textures = new Shared?[4];
    private int _at;

    /// <summary>The next one, made afresh if the frames have changed shape.</summary>
    public Shared Take(ID3D11Device device, Texture2DDescription shape)
    {
        _at = (_at + 1) % _textures.Length;
        var held = _textures[_at];
        if (held is not null
            && held.Texture.Description.Width == shape.Width
            && held.Texture.Description.Height == shape.Height
            && held.Texture.Description.Format == shape.Format)
        {
            return held;
        }

        held?.Texture.Dispose();
        var made = device.CreateTexture2D(new Texture2DDescription
        {
            Width = shape.Width,
            Height = shape.Height,
            Format = shape.Format,
            MipLevels = 1,
            ArraySize = 1,
            SampleDescription = new Vortice.DXGI.SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = BindFlags.ShaderResource,
            CPUAccessFlags = CpuAccessFlags.None,
            // Shared, because SteamVR's compositor is another process and has to open it.
            MiscFlags = ResourceOptionFlags.Shared,
        });
        // The legacy shared handle, which is what `MiscFlags.Shared` is for and what SteamVR takes
        // as a `DXGISharedHandle`. It belongs to the texture and is closed with it.
        using var resource = made.QueryInterface<Vortice.DXGI.IDXGIResource>();
        var shared = new Shared(made, resource.SharedHandle);
        _textures[_at] = shared;
        return shared;
    }

    public void Dispose()
    {
        for (var at = 0; at < _textures.Length; at++)
        {
            _textures[at]?.Texture.Dispose();
            _textures[at] = null;
        }
    }
}
