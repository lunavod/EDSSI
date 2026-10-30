# Registers the built probe layer as an implicit OpenXR API layer for this Windows user only
# (HKCU), so every OpenXR program this user starts from now on loads it. -Remove takes it out.
#
#   powershell -File tools/openxr-probe-layer/register.ps1 [-Remove]

param([switch]$Remove)

$key = 'HKCU:\SOFTWARE\Khronos\OpenXR\1\ApiLayers\Implicit'
$manifest = Join-Path $PSScriptRoot '..\..\out\openxr-probe-layer\edssi_openxr_probe.json'
$manifest = [System.IO.Path]::GetFullPath($manifest)

if ($Remove) {
  if (Test-Path $key) { Remove-ItemProperty -Path $key -Name $manifest -ErrorAction SilentlyContinue }
  Write-Output "Unregistered $manifest"
  return
}

if (-not (Test-Path $manifest)) { throw "Not built yet: $manifest" }
if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
# The value's name is the manifest's path; 0 means enabled.
New-ItemProperty -Path $key -Name $manifest -PropertyType DWord -Value 0 -Force | Out-Null
Write-Output "Registered $manifest"
