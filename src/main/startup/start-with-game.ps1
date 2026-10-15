# EDSSI's "Start with the game" watcher (src/main/startup/start-with-game.ts writes it into the
# data folder and starts it with Windows). Every few seconds it looks for Elite Dangerous; when the
# game starts and EDSSI isn't running, it starts EDSSI. EDSSI, told it was started by the game,
# shows its window without taking focus; should a window of it take focus anyway (an update it
# installs on starting starts it afresh, without that flag), focus is handed back to the game.
# No key presses are sent: they would land in the game.
#
# It ends on its own once this file is gone (the setting turned off) or EDSSI is (uninstalled).
# Keep it ASCII: Windows PowerShell reads a script without a BOM in the ANSI code page.
param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Mutex,
  [string]$Game = 'EliteDangerous64',
  [string]$Flag = '--started-by-game',
  [int]$PollSeconds = 3,
  # How long after a start focus is looked after, at most...
  [int]$GuardSeconds = 120,
  # ...and how long after EDSSI's window first shows, so a click on it later is the commander's own.
  [int]$SettleSeconds = 10
)

# One watcher at a time: EDSSI starts one when the setting is turned on, and Windows at each logon.
$created = $false
$lock = New-Object System.Threading.Mutex($true, $Mutex, [ref]$created)
if (-not $created) { exit }

$log = Join-Path (Split-Path -Parent $PSCommandPath) 'start-with-game.log'
if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 256KB) {
  Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
}
function Write-Log([string]$text) {
  Add-Content -LiteralPath $log -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $text) -ErrorAction SilentlyContinue
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EdssiFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);

  public static uint Pid(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return pid; }

  // A background process may not set the foreground window; joining its input queue to the
  // current foreground's and the target's lets it, with no key press.
  public static bool Restore(IntPtr target) {
    IntPtr thief = GetForegroundWindow();
    uint ignored;
    uint me = GetCurrentThreadId();
    uint thiefThread = GetWindowThreadProcessId(thief, out ignored);
    uint targetThread = GetWindowThreadProcessId(target, out ignored);
    AttachThreadInput(me, thiefThread, true);
    AttachThreadInput(me, targetThread, true);
    BringWindowToTop(target);
    SetForegroundWindow(target);
    AttachThreadInput(me, targetThread, false);
    AttachThreadInput(me, thiefThread, false);
    if (GetForegroundWindow() == target) return true;
    // What the Alt+Tab switcher itself uses.
    SwitchToThisWindow(target, true);
    System.Threading.Thread.Sleep(30);
    return GetForegroundWindow() == target;
  }
}
"@

$appName = [IO.Path]::GetFileNameWithoutExtension($App)

# EDSSI's processes: those running this very exe (an EDSSI Dev, or one run from source, isn't it).
function Get-AppIds {
  $ids = @{}
  foreach ($p in @(Get-Process -Name $appName -ErrorAction SilentlyContinue)) {
    if ($p.Path -eq $App) { $ids[[uint32]$p.Id] = $p }
  }
  return $ids
}

function Get-GameWindow {
  foreach ($p in @(Get-Process -Name $Game -ErrorAction SilentlyContinue)) {
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) { return $p.MainWindowHandle }
  }
  return [IntPtr]::Zero
}

function Start-App {
  $before = [EdssiFocus]::GetForegroundWindow()
  Write-Log "the game has started; starting $App"
  Start-Process -FilePath $App -ArgumentList $Flag -WorkingDirectory (Split-Path -Parent $App)

  # Where focus goes back to: the game's window once it has one, else wherever it was, unless the
  # commander goes somewhere else themselves, which is then never fought over.
  $target = $before
  $chosen = $false
  $last = $before
  $ids = @{}
  $refreshed = [DateTime]::MinValue
  $seen = $false
  $settled = $null
  $deadline = (Get-Date).AddSeconds($GuardSeconds)
  while ((Get-Date) -lt $deadline -and ($null -eq $settled -or (Get-Date) -lt $settled)) {
    $now = Get-Date
    if (($now - $refreshed).TotalMilliseconds -ge 500) {
      $ids = Get-AppIds
      $refreshed = $now
      $shown = @($ids.Values | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }).Count -gt 0
      if ($shown -and $null -eq $settled) { $settled = $now.AddSeconds($SettleSeconds) }
      if ($ids.Count -gt 0) { $seen = $true }
      # Gone after being seen: an update being installed, which starts EDSSI again.
      elseif ($seen) { $settled = $null; $seen = $false }
      if (-not $chosen) {
        $game = Get-GameWindow
        if ($game -ne [IntPtr]::Zero) { $target = $game }
      }
    }

    $front = [EdssiFocus]::GetForegroundWindow()
    if ($front -ne [IntPtr]::Zero -and $front -ne $target) {
      if ($ids.ContainsKey([EdssiFocus]::Pid($front))) {
        if ([EdssiFocus]::IsWindow($target) -and [EdssiFocus]::Restore($target)) {
          Write-Log 'EDSSI took focus; given back'
        }
      } elseif ($front -ne $last) {
        $target = $front
        $chosen = $true
      }
    }
    $last = $front
    Start-Sleep -Milliseconds 25
  }
}

Write-Log "watching for $Game to start $App"
$wasRunning = $null -ne (Get-Process -Name $Game -ErrorAction SilentlyContinue)
while ((Test-Path -LiteralPath $PSCommandPath) -and (Test-Path -LiteralPath $App)) {
  $running = $null -ne (Get-Process -Name $Game -ErrorAction SilentlyContinue)
  # Only as the game starts: an EDSSI closed mid-game stays closed.
  if ($running -and -not $wasRunning -and (Get-AppIds).Count -eq 0) { Start-App }
  $wasRunning = $running
  Start-Sleep -Seconds $PollSeconds
}
Write-Log 'stopped: the setting is off or EDSSI is gone'
$lock.ReleaseMutex()
