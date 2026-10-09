/**
 * Draws the VR cockpit as a picture, so the layout can be looked at without a headset.
 *
 * Every number comes from the same code the overlays use — `layout.ts` for where things are and
 * `transform.ts` for the matrices — so what this shows is what SteamVR would be told. It is a
 * check on the geometry and the arrangement, not on the panels' contents: each panel is drawn as
 * the rectangle it really is, at its real size and angle.
 *
 *   npm run vr:shots                        photograph the real panels first
 *   npm run vr:preview                      the saved layout, or the defaults
 *   npm run vr:preview -- --defaults        ignore the saved file
 *   npm run vr:preview -- --fov 90          a narrower headset
 *   npm run vr:preview -- --out <file.svg>
 *
 * Three views: what the commander sees, the same from above, and from the side. The first answers
 * "is it readable and is anything in the way", the other two "how far away is it really".
 *
 * `npm run vr:shots` photographs the real panels from a running EDSSI; when those are there they
 * are shown underneath at the size they are actually drawn, with how many pixels each one gets per
 * degree of view — which is what decides whether the words can be read.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_LAYOUT, loadLayout, type VrLayout } from '../src/main/vr/layout';
import { panelPixels } from '../src/main/vr/panel';
import { effectiveSize, VR_PANEL_IDS, type VrPanelId } from '../src/main/vr/panels';
import { type Seam, seamsFor } from '../src/main/vr/seams';
import { type Matrix34, panelMatrix, seamMatrix } from '../src/main/vr/transform';

/** Roughly what a modern headset shows at once; the eye view is drawn to this. */
const DEFAULT_FOV = 100;

/** How big the drawing is, in pixels. */
const EYE = { width: 1100, height: 760 };
const PLAN = { width: 1100, height: 430 };

/** A colour per panel, so the same panel is recognisable across all three views. */
const COLOURS: Record<VrPanelId, string> = {
  main: '#ff7100',
  sidebar: '#4ea8de',
  comms: '#7ce3c4',
  route: '#e2b13c',
  stats: '#c77dff',
};

/** The accent lines in the gaps, drawn in the accent they are actually sent in. */
const SEAM_COLOUR = '#ff7100';

type Point = readonly [number, number, number];

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Where a transform sends a point. */
function apply(matrix: Matrix34, [x, y, z]: Point): Point {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3],
    matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7],
    matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
  ];
}

/** The four corners of one panel, in the rig's space, clockwise from the top left. */
function corners(layout: VrLayout, id: VrPanelId): Point[] {
  const matrix = panelMatrix(layout.rig, layout.panels, id);
  const size = effectiveSize(layout.panels, id);
  const w = size.widthMeters / 2;
  const h = size.heightMeters / 2;
  return [
    apply(matrix, [-w, h, 0]),
    apply(matrix, [w, h, 0]),
    apply(matrix, [w, -h, 0]),
    apply(matrix, [-w, -h, 0]),
  ];
}

/** The four corners of one seam line, the same way as a panel's. */
function seamCorners(layout: VrLayout, seam: Seam): Point[] {
  const matrix = seamMatrix(layout.rig, layout.panels, seam);
  const w = seam.widthMeters / 2;
  const h = seam.heightMeters / 2;
  return [
    apply(matrix, [-w, h, 0]),
    apply(matrix, [w, h, 0]),
    apply(matrix, [w, -h, 0]),
    apply(matrix, [-w, -h, 0]),
  ];
}

function seamsOf(layout: VrLayout): Seam[] {
  return seamsFor(layout.panels, VR_PANEL_IDS, layout.seams);
}

/**
 * The commander's view: a pinhole at the origin looking down −z, which is where the anchor puts
 * their eye. A panel behind them has no place on the picture and is left out.
 */
function project(point: Point, fov: number): [number, number] | undefined {
  const [x, y, z] = point;
  if (z >= -0.05) return undefined;
  const focal = EYE.width / 2 / Math.tan((fov / 2) * (Math.PI / 180));
  // SVG's y runs down the page; the world's runs up it.
  return [EYE.width / 2 + (x / -z) * focal, EYE.height / 2 - (y / -z) * focal];
}

function eyeView(layout: VrLayout, fov: number): string {
  const parts: string[] = [];
  // Furthest first, so a nearer panel covers one behind it the way it really would.
  const order = VR_PANEL_IDS.filter((id) => layout.panels[id].enabled).toSorted(
    (a, b) => depth(layout, b) - depth(layout, a),
  );

  for (const id of order) {
    const points = corners(layout, id).map((corner) => project(corner, fov));
    if (points.some((point) => point === undefined)) continue;
    const path = points.map((point) => point!.join(',')).join(' ');
    const [cx, cy] = centreOf(points as [number, number][]);
    parts.push(
      `<polygon points="${path}" fill="${COLOURS[id]}" fill-opacity="0.18" ` +
        `stroke="${COLOURS[id]}" stroke-width="2" />`,
      `<text x="${cx}" y="${cy}" fill="${COLOURS[id]}" font-size="17" text-anchor="middle">${id}</text>`,
      `<text x="${cx}" y="${cy + 20}" fill="${COLOURS[id]}" font-size="12" text-anchor="middle" ` +
        `opacity="0.75">${effectiveSize(layout.panels, id).widthMeters.toFixed(2)} × ${effectiveSize(layout.panels, id).heightMeters.toFixed(2)} m</text>`,
    );
  }

  // The seam lines, drawn last: they sit in the gaps between the panels, in front of nothing.
  for (const seam of seamsOf(layout)) {
    const points = seamCorners(layout, seam).map((corner) => project(corner, fov));
    if (points.some((point) => point === undefined)) continue;
    const path = points.map((point) => point!.join(',')).join(' ');
    parts.push(`<polygon points="${path}" fill="${SEAM_COLOUR}" stroke="none" />`);
  }

  // The middle of the view, which is where the commander is actually looking.
  parts.push(
    `<line x1="${EYE.width / 2 - 12}" y1="${EYE.height / 2}" x2="${EYE.width / 2 + 12}" y2="${EYE.height / 2}" stroke="#fff" stroke-opacity="0.5" />`,
    `<line x1="${EYE.width / 2}" y1="${EYE.height / 2 - 12}" x2="${EYE.width / 2}" y2="${EYE.height / 2 + 12}" stroke="#fff" stroke-opacity="0.5" />`,
  );
  return parts.join('\n');
}

function depth(layout: VrLayout, id: VrPanelId): number {
  const [, , z] = centre3(layout, id);
  return -z;
}

function centre3(layout: VrLayout, id: VrPanelId): Point {
  const matrix = panelMatrix(layout.rig, layout.panels, id);
  return [matrix[3], matrix[7], matrix[11]];
}

function centreOf(points: [number, number][]): [number, number] {
  const x = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const y = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return [x, y];
}

/**
 * From above (`plan`) or from the side. Each panel becomes a line, because edge-on that is what it
 * is; this is where distance and angle can actually be read off.
 */
function flatView(layout: VrLayout, plan: boolean, fov: number): string {
  const scale = 150;
  const ox = PLAN.width / 2;
  const oy = PLAN.height - 60;
  const parts: string[] = [];

  // A metre grid, so distances can be counted rather than guessed.
  for (let ring = 1; ring <= 3; ring++) {
    parts.push(
      `<circle cx="${ox}" cy="${oy}" r="${ring * scale}" fill="none" stroke="#ffffff" ` +
        `stroke-opacity="0.12" stroke-dasharray="4 6" />`,
      `<text x="${ox + 4}" y="${oy - ring * scale + 14}" fill="#fff" fill-opacity="0.35" font-size="11">${ring} m</text>`,
    );
  }

  // What the headset can see at once, for the plan.
  if (plan) {
    const half = (fov / 2) * (Math.PI / 180);
    const reach = 3.2 * scale;
    for (const side of [-1, 1]) {
      parts.push(
        `<line x1="${ox}" y1="${oy}" x2="${ox + Math.sin(half) * reach * side}" ` +
          `y2="${oy - Math.cos(half) * reach}" stroke="#fff" stroke-opacity="0.2" />`,
      );
    }
  }

  for (const id of VR_PANEL_IDS) {
    const placement = layout.panels[id];
    if (!placement.enabled) continue;
    const points = corners(layout, id);
    // Looking down, a panel's width is its edge; from the side, its height is.
    const [a, b] = plan ? [points[0]!, points[1]!] : [points[0]!, points[3]!];
    const toXy = (point: Point): [number, number] =>
      plan
        ? [ox + point[0] * scale, oy + point[2] * scale]
        : [ox + point[2] * scale * -1, oy - point[1] * scale];
    const [ax, ay] = toXy(a);
    const [bx, by] = toXy(b);
    parts.push(
      `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${COLOURS[id]}" stroke-width="4" />`,
      `<text x="${(ax + bx) / 2}" y="${(ay + by) / 2 - 8}" fill="${COLOURS[id]}" font-size="12" ` +
        `text-anchor="middle">${id}</text>`,
    );
  }

  // A seam edge-on is a short stroke in the gap, which is where its angle can be read off.
  for (const seam of seamsOf(layout)) {
    const points = seamCorners(layout, seam);
    const [a, b] = plan ? [points[0]!, points[1]!] : [points[0]!, points[3]!];
    const toXy = (point: Point): [number, number] =>
      plan
        ? [ox + point[0] * scale, oy + point[2] * scale]
        : [ox + point[2] * scale * -1, oy - point[1] * scale];
    const [ax, ay] = toXy(a);
    const [bx, by] = toXy(b);
    parts.push(
      `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${SEAM_COLOUR}" stroke-width="3" />`,
    );
  }

  parts.push(
    `<circle cx="${ox}" cy="${oy}" r="5" fill="#fff" />`,
    `<text x="${ox}" y="${oy + 22}" fill="#fff" fill-opacity="0.6" font-size="12" text-anchor="middle">commander</text>`,
  );
  return parts.join('\n');
}

function svg(width: number, height: number, title: string, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif">` +
    `<rect width="${width}" height="${height}" fill="#2b2b30" />` +
    `<text x="16" y="26" fill="#fff" fill-opacity="0.75" font-size="14">${title}</text>` +
    body +
    '</svg>'
  );
}

/**
 * The real panels, if they have been photographed. Each is shown with how many pixels it gets per
 * degree across — under about 12 and text starts to break up in a headset.
 */
function gallery(layout: VrLayout, shots: string): string {
  const cards = VR_PANEL_IDS.filter((id) => layout.panels[id].enabled)
    .map((id) => {
      const file = join(shots, `${id}.png`);
      if (!existsSync(file)) return '';
      const placement = layout.panels[id];
      const [x, y, z] = centre3(layout, id);
      const distance = Math.hypot(x, y, z);
      const pixels = panelPixels(placement.widthMeters, placement);
      // How wide the panel looks, and so how much detail lands on each degree of it.
      const degrees = 2 * Math.atan(placement.widthMeters / 2 / distance) * (180 / Math.PI);
      const perDegree = pixels.width / degrees;
      const data = readFileSync(file).toString('base64');
      return (
        `<figure style="margin:0 0 20px">` +
        `<figcaption style="color:${COLOURS[id]};margin-bottom:6px">${id} — ` +
        `${placement.widthMeters.toFixed(2)} × ${placement.heightMeters.toFixed(2)} m, ` +
        `${degrees.toFixed(0)}° wide, ${pixels.width}×${pixels.height}px, ` +
        `<strong>${perDegree.toFixed(0)} px/°</strong></figcaption>` +
        `<img src="data:image/png;base64,${data}" style="max-width:100%;border:1px solid ${COLOURS[id]}55;background:#3a3a3f" />` +
        `</figure>`
      );
    })
    .join('');

  return cards === ''
    ? ''
    : `<h2 style="font-size:16px;font-weight:500;margin-top:28px">The panels themselves</h2>` +
        `<p style="opacity:0.6;max-width:70ch">Photographed from a running EDSSI by` +
        ` <code>npm run vr:shots</code>. Under about 12 px per degree, text starts to break up.</p>` +
        cards;
}

function main(): void {
  const fov = Number(argument('fov') ?? DEFAULT_FOV);
  const layout = process.argv.includes('--defaults') ? DEFAULT_LAYOUT : loadLayout();
  const out = argument('out') ?? 'vr-preview.html';

  const listed = VR_PANEL_IDS.filter((id) => layout.panels[id].enabled)
    .map((id) => {
      const [x, y, z] = centre3(layout, id);
      const placement = layout.panels[id];
      return (
        `<tr><td style="color:${COLOURS[id]}">${id}</td>` +
        `<td>${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}</td>` +
        `<td>${placement.widthMeters.toFixed(2)} × ${placement.heightMeters.toFixed(2)} m</td>` +
        `<td>${Math.hypot(x, y, z).toFixed(2)} m</td></tr>`
      );
    })
    .join('');

  const html =
    `<!doctype html><meta charset="utf-8"><title>EDSSI VR cockpit</title>` +
    `<body style="margin:0;background:#1d1d21;color:#ddd;font:14px system-ui,sans-serif;padding:20px">` +
    `<h1 style="font-size:18px;font-weight:500">EDSSI VR cockpit — ${fov}° field of view</h1>` +
    `<p style="opacity:0.6;max-width:70ch">Drawn from the same placements and matrices the overlays` +
    ` use. Panels are shown at their real size and angle; their contents are not.</p>` +
    svg(EYE.width, EYE.height, 'What the commander sees', eyeView(layout, fov)) +
    svg(PLAN.width, PLAN.height, 'From above', flatView(layout, true, fov)) +
    svg(
      PLAN.width,
      PLAN.height,
      'From the side (commander faces left)',
      flatView(layout, false, fov),
    ) +
    `<table style="margin-top:16px;border-collapse:collapse" cellpadding="6">` +
    `<tr style="opacity:0.55;text-align:left"><th>panel</th><th>centre (x, y, z)</th><th>size</th><th>distance</th></tr>` +
    listed +
    `</table>` +
    gallery(layout, argument('shots') ?? 'vr-shots') +
    `</body>`;

  writeFileSync(out, html, 'utf8');
  console.log(`Wrote ${out}`);
}

main();
