// The little geometry the layer does on its own: turning EDSSI's 3x4 matrices into OpenXR poses,
// pinning a world-locked rig upright where the head is, and picking the panel being looked at.
// Pure, so the test exercises it without a runtime; the same rules as tools/vr-overlay-host.

#pragma once

#include <openxr/openxr.h>

#include <cmath>

namespace edssi_xr {

struct Mat34 {
  float m[12];  // row-major: m[0..3] is the first row, translation in m[3], m[7], m[11]
};

inline XrQuaternionf QuatFromRotation(const float r[9]) {
  // r is row-major 3x3.
  XrQuaternionf q{};
  float trace = r[0] + r[4] + r[8];
  if (trace > 0.0f) {
    float s = std::sqrt(trace + 1.0f) * 2.0f;
    q.w = 0.25f * s;
    q.x = (r[7] - r[5]) / s;
    q.y = (r[2] - r[6]) / s;
    q.z = (r[3] - r[1]) / s;
  } else if (r[0] > r[4] && r[0] > r[8]) {
    float s = std::sqrt(1.0f + r[0] - r[4] - r[8]) * 2.0f;
    q.w = (r[7] - r[5]) / s;
    q.x = 0.25f * s;
    q.y = (r[1] + r[3]) / s;
    q.z = (r[2] + r[6]) / s;
  } else if (r[4] > r[8]) {
    float s = std::sqrt(1.0f + r[4] - r[0] - r[8]) * 2.0f;
    q.w = (r[2] - r[6]) / s;
    q.x = (r[1] + r[3]) / s;
    q.y = 0.25f * s;
    q.z = (r[5] + r[7]) / s;
  } else {
    float s = std::sqrt(1.0f + r[8] - r[0] - r[4]) * 2.0f;
    q.w = (r[3] - r[1]) / s;
    q.x = (r[2] + r[6]) / s;
    q.y = (r[5] + r[7]) / s;
    q.z = 0.25f * s;
  }
  float n = std::sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (n > 0.0f) {
    q.x /= n;
    q.y /= n;
    q.z /= n;
    q.w /= n;
  } else {
    q = {0, 0, 0, 1};
  }
  return q;
}

/** A 3x4 matrix as a pose. Any scale in it is dropped: OpenXR poses have none. */
inline XrPosef PoseFromMatrix(const Mat34 &a) {
  // Normalise the columns first, so a scaled matrix still yields a proper rotation.
  float r[9];
  for (int c = 0; c < 3; c++) {
    float x = a.m[c], y = a.m[4 + c], z = a.m[8 + c];
    float n = std::sqrt(x * x + y * y + z * z);
    if (n < 1e-6f) n = 1.0f;
    r[c] = x / n;
    r[3 + c] = y / n;
    r[6 + c] = z / n;
  }
  XrPosef pose{};
  pose.orientation = QuatFromRotation(r);
  pose.position = {a.m[3], a.m[7], a.m[11]};
  return pose;
}

inline Mat34 MatrixFromPose(const XrPosef &p) {
  const XrQuaternionf &q = p.orientation;
  float xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
  float xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
  float wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
  return Mat34{{1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), p.position.x,  //
                2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), p.position.y,  //
                2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), p.position.z}};
}

/** a then b: b is expressed relative to a. */
inline Mat34 Concat(const Mat34 &a, const Mat34 &b) {
  Mat34 r{};
  for (int row = 0; row < 3; row++) {
    for (int col = 0; col < 4; col++) {
      float v = a.m[row * 4 + 0] * b.m[0 + col] + a.m[row * 4 + 1] * b.m[4 + col] +
                a.m[row * 4 + 2] * b.m[8 + col];
      if (col == 3) v += a.m[row * 4 + 3];
      r.m[row * 4 + col] = v;
    }
  }
  return r;
}

/**
 * The head's pose with its pitch and roll taken out: where a world-locked rig is pinned, so the
 * panels hang level however the head was tilted. Looking straight up or down leaves no way to tell
 * which way round is, so the head is used as it is.
 */
inline Mat34 Upright(const Mat34 &head) {
  float fx = -head.m[2], fy = -head.m[6], fz = -head.m[10];
  // forward x up(0,1,0) = right
  float rx = -fz, ry = 0.0f, rz = fx;
  float len = std::sqrt(rx * rx + rz * rz);
  if (len < 1e-4f) return head;
  rx /= len;
  rz /= len;
  // Level forward: up x right... built so the basis is right-handed: x = right, y = up, z = back.
  float bx = -rz, bz = rx;  // back = right x up
  (void)fy;
  (void)ry;
  return Mat34{{rx, 0.0f, bx, head.m[3],  //
                0.0f, 1.0f, 0.0f, head.m[7],  //
                rz, 0.0f, bz, head.m[11]}};
}

/** The cosine within which a panel can be picked by looking at it (about 37 degrees, as the OpenVR host). */
constexpr float kGazeCosine = 0.80f;

/**
 * How directly the head looks at a point: the cosine between its line of sight and the direction to
 * the point. Both in the same space.
 */
inline float GazeCosine(const Mat34 &head, float px, float py, float pz) {
  float fx = -head.m[2], fy = -head.m[6], fz = -head.m[10];
  float fl = std::sqrt(fx * fx + fy * fy + fz * fz);
  float dx = px - head.m[3], dy = py - head.m[7], dz = pz - head.m[11];
  float dl = std::sqrt(dx * dx + dy * dy + dz * dz);
  if (fl < 1e-6f || dl < 1e-6f) return -1.0f;
  return (fx * dx + fy * dy + fz * dz) / (fl * dl);
}

}  // namespace edssi_xr
