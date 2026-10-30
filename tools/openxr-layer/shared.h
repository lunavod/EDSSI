// What the bridge (edssi-openxr-bridge.exe, run by EDSSI) and the layer (in the game) share: one
// named block of memory describing the rig, and one named D3D11 texture per panel.
//
// The bridge writes the rig under a sequence lock: `sequence` is odd while it writes, and a reader
// that sees it change, or odd, reads again. The panels' pixels never go through here: each panel is
// a texture the bridge owns, shared by name with a keyed mutex, which the layer opens on the game's
// device and copies out of whenever `frame` moves on. The handful of fields at the end are the
// layer's, written only by it, so the bridge can tell EDSSI what the commander is looking at.
//
// Every field is fixed-size and naturally aligned, so the two sides agree without negotiating.
// Bump kVersion whenever the layout changes; a layer that finds another version leaves it alone.

#pragma once

#include <cstdint>

namespace edssi_xr {

constexpr wchar_t kMappingName[] = L"Local\\EDSSI-OpenXR-Cockpit";
constexpr uint32_t kMagic = 0x52584445;  // "EDXR"
constexpr uint32_t kVersion = 2;
constexpr uint32_t kMaxPanels = 16;
constexpr uint32_t kIdBytes = 48;
constexpr uint32_t kNameChars = 64;

enum Lock : uint32_t { kLockHead = 0, kLockWorld = 1 };

struct SharedPanel {
  char id[kIdBytes];  // utf-8, zero-terminated
  // Where it hangs, row-major 3x4, relative to the head or to the anchor (OpenVR's convention,
  // which is OpenXR's too: metres, +Y up, looking down -Z). From EDSSI's `transform.ts`.
  float matrix[12];
  float widthMeters;
  float alpha;
  uint32_t gaze;  // whether looking at it may pick it for the tuning keys
  // The panel's texture: its shared name (empty until the first frame), size, and a generation
  // that changes whenever the texture is replaced by another (a new size), so the layer reopens it.
  wchar_t texture[kNameChars];
  uint32_t width;
  uint32_t height;
  uint32_t generation;
  uint32_t frame;  // bumped after every copy into the texture
  float curvature;  // OpenVR's: the share of a full circle the width wraps (0 = flat)
};

struct Shared {
  uint32_t magic;
  uint32_t version;
  volatile long sequence;
  uint32_t bridgePid;
  uint32_t visible;
  uint32_t lock;
  int32_t anchor;  // changed to ask for the rig to be pinned where the head is now
  uint32_t panelCount;
  SharedPanel panels[kMaxPanels];

  // The layer's half.
  volatile long layerPid;
  volatile long layerSessions;  // sessions the layer has hung panels in
  volatile long layerFrames;    // frames it has added panels to
  volatile long gazeSerial;     // bumped when `gazeId` changes
  char gazeId[kIdBytes];
  volatile long layerProblem;   // bumped with each new message in `problem`
  char problem[200];
};

}  // namespace edssi_xr
