import { Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, Color, type GridHelper, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js';

import type { CsvRoute, CsvRouteState } from '../../../shared/csv-route';
import { useEdssiInstance } from '../api/context';
import {
  bounds,
  type Bounds,
  gridStep,
  LANDMARKS,
  type MapStop,
  mapRoute,
  segments,
  toScene,
  type Vec3,
} from './route-map';

/** The colours the map draws with, read from the stylesheet so a HUD colour carries through. */
interface Palette {
  ahead: string;
  flown: string;
  here: string;
  compare: string;
  landmark: string;
  grid: string;
}

type View = 'fit' | 'above';

/** A name written beside a point of the scene. */
interface MapLabel {
  key: string;
  at: Vec3;
  text: string;
  hint?: string;
  kind?: 'strong' | 'faint';
  /** Under the point rather than beside it, for a label that would sit on another. */
  below?: boolean;
}

/** The landmarks as stops, to draw like the route's. */
const LANDMARK_STOPS: MapStop[] = LANDMARKS.map((mark, index) => ({
  index,
  name: mark.name,
  at: toScene(mark.coords),
  past: false,
}));

/**
 * The Route tab's Map page: every stop of the CSV route in 3D, the stretch already flown in
 * another colour, and another route beside it to compare, when an extension has one.
 * Drawn only while the page is on show, and only when something moves: the game is running too.
 */
export function RouteMap({
  csvRoute,
  compare,
  shown,
}: {
  csvRoute: CsvRouteState | undefined;
  /** A route to show beside the CSV route, and what its chip says. */
  compare: { route: CsvRoute; label: string } | undefined;
  shown: boolean;
}) {
  const route = csvRoute?.route;
  const [showRoute, setShowRoute] = useState(true);
  const [showCompared, setShowCompared] = useState(true);
  const [view, setView] = useState<{ kind: View; at: number }>({ kind: 'fit', at: 0 });
  const [hovered, setHovered] = useState<MapStop>();
  const palette = usePalette();
  const { api: edssi } = useEdssiInstance();
  // Through the main process: the sandboxed window has no `navigator.clipboard`. Made out here,
  // where the provider is, rather than inside the canvas.
  const copyName = useCallback(
    (stop: MapStop) => void edssi.clipboard.writeText(stop.name),
    [edssi],
  );
  /** The overlay's label elements by key, which the scene moves each frame it draws. */
  const labelElements = useRef(new Map<string, HTMLElement>());

  const main = useMemo(
    () => (route ? mapRoute(route, csvRoute?.position) : undefined),
    [route, csvRoute?.position],
  );
  const compared = compare?.route;
  const extra = useMemo(() => (compared ? mapRoute(compared, undefined) : undefined), [compared]);
  const drawn = [
    ...(showRoute && main ? main.stops : []),
    ...(showCompared && extra ? extra.stops : []),
  ];
  const box = bounds(drawn.map((stop) => stop.at));

  if (!route && !compare) {
    return (
      <p className="route-empty">Load a CSV route to see its stops here in three dimensions.</p>
    );
  }

  const here = csvRoute?.position;
  const labels = mapLabels(
    showRoute ? main?.stops : undefined,
    showCompared ? extra?.stops : undefined,
    showRoute ? here : undefined,
    hovered,
  );
  const count = (key: 'unplaced' | 'estimated') =>
    (showRoute ? (main?.[key] ?? 0) : 0) + (showCompared ? (extra?.[key] ?? 0) : 0);
  const unplaced = count('unplaced');
  const estimated = count('estimated');
  return (
    <>
      <div className="row" style={{ gap: 10, flex: 'none' }}>
        {route && (
          <button
            type="button"
            className="chip"
            aria-pressed={showRoute}
            onClick={() => setShowRoute(!showRoute)}
            title={route.fileName}
          >
            <span className="box" />
            CSV route
          </button>
        )}
        {compare && (
          <button
            type="button"
            className="chip"
            aria-pressed={showCompared}
            onClick={() => setShowCompared(!showCompared)}
            title={compare.route.fileName}
          >
            <span className="box" />
            {compare.label}
          </button>
        )}
        <span className="sp" />
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setView({ kind: 'fit', at: Date.now() })}
        >
          Fit
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setView({ kind: 'above', at: Date.now() })}
        >
          From above
        </button>
      </div>
      <section className="map panel" aria-label="Route map">
        {shown && box ? (
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            camera={{ fov: 50, near: 1, far: 1e6, position: [0, 1000, 1000] }}
          >
            <Scene
              main={showRoute ? main?.stops : undefined}
              extra={showCompared ? extra?.stops : undefined}
              here={showRoute ? here : undefined}
              box={box}
              view={view}
              palette={palette}
              onHover={setHovered}
              onPick={copyName}
            />
            <LabelMover labels={labels} elements={labelElements} />
          </Canvas>
        ) : (
          shown && (
            <p className="route-empty">
              None of these stops has a known place yet: EDSM doesn&apos;t know them.
            </p>
          )
        )}
        {shown && box && (
          <div className="map-labels" aria-hidden>
            {labels.map((label) => (
              <span
                key={label.key}
                className="map-label"
                data-kind={label.kind}
                data-below={label.below || undefined}
                ref={(element) => {
                  if (element) labelElements.current.set(label.key, element);
                  else labelElements.current.delete(label.key);
                }}
              >
                {label.text}
                {label.hint && <em> · {label.hint}</em>}
              </span>
            ))}
          </div>
        )}
        <ul className="map-legend">
          {showRoute && main && (
            <>
              <li>
                <i className="lg-flown" />
                Flown
              </li>
              <li>
                <i className="lg-ahead" />
                Ahead
              </li>
              {here !== undefined && (
                <li>
                  <i className="lg-here" />
                  Last reached
                </li>
              )}
            </>
          )}
          {showCompared && compare && extra && (
            <li>
              <i className="lg-plot" />
              {compare.label}
            </li>
          )}
          {estimated > 0 && (
            <li
              className="note-only"
              title="Nobody has logged where they are: drawn fainter, on the line between their neighbours"
            >
              {estimated} placed by estimate
            </li>
          )}
          {unplaced > 0 && (
            <li className="note-only" title="Neither the route nor EDSM says where they are">
              {unplaced} {unplaced === 1 ? 'stop' : 'stops'} with no known place
            </li>
          )}
        </ul>
      </section>
    </>
  );
}

function Scene({
  main,
  extra,
  here,
  box,
  view,
  palette,
  onHover,
  onPick,
}: {
  main: MapStop[] | undefined;
  extra: MapStop[] | undefined;
  here: number | undefined;
  box: Bounds;
  view: { kind: View; at: number };
  palette: Palette;
  onHover: (stop: MapStop | undefined) => void;
  onPick: (stop: MapStop) => void;
}) {
  const sprite = useMemo(() => dotTexture(), []);
  const all = useMemo(() => [...(main ?? []), ...(extra ?? [])], [main, extra]);
  const current = here === undefined ? undefined : main?.find((stop) => stop.index === here);

  return (
    <>
      <CameraRig box={box} view={view} />
      <Picker stops={all} onHover={onHover} onPick={onPick} />
      <PlaneGrid box={box} color={palette.grid} />
      {main && main.length > 0 && (
        <>
          {main.length > 1 && <RouteLine stops={main} palette={palette} />}
          <Dots
            stops={main}
            color={(stop) => (stop.past ? palette.flown : palette.ahead)}
            sprite={sprite}
            size={6}
          />
        </>
      )}
      {extra && extra.length > 0 && (
        <>
          {extra.length > 1 && (
            <Line
              points={extra.map((stop) => stop.at)}
              color={palette.compare}
              lineWidth={1.5}
              dashed
              dashSize={box.radius / 60}
              gapSize={box.radius / 90}
              transparent
              opacity={0.8}
            />
          )}
          <Dots stops={extra} color={() => palette.compare} sprite={sprite} size={4} />
        </>
      )}
      {current && (
        <>
          <Dots stops={[current]} color={() => palette.here} sprite={sprite} size={14} />
          <Line
            points={[current.at, [current.at[0], 0, current.at[2]]]}
            color={palette.here}
            lineWidth={1}
            transparent
            opacity={0.6}
          />
        </>
      )}
      <Dots stops={LANDMARK_STOPS} color={() => palette.landmark} sprite={sprite} size={5} />
    </>
  );
}

/** The CSV route as one line of segments, each flown or ahead. */
function RouteLine({ stops, palette }: { stops: MapStop[]; palette: Palette }) {
  const legs = useMemo(() => segments(stops), [stops]);
  const points = legs.flatMap((leg) => [leg.from, leg.to]);
  const colors = legs.flatMap((leg) => {
    const color = leg.past ? palette.flown : palette.ahead;
    return [color, color];
  });
  return <Line points={points} vertexColors={colors.map(rgb)} segments lineWidth={2} />;
}

/** Stops as round dots of a fixed size on screen, whatever their distance. */
function Dots({
  stops,
  color,
  sprite,
  size,
}: {
  stops: readonly MapStop[];
  color: (stop: MapStop) => string;
  sprite: CanvasTexture;
  size: number;
}) {
  const [positions, colors] = useMemo(() => {
    const at = new Float32Array(stops.length * 3);
    const tint = new Float32Array(stops.length * 3);
    stops.forEach((stop, index) => {
      at.set(stop.at, index * 3);
      // A place only estimated is drawn fainter.
      const shade = stop.estimated ? 0.45 : 1;
      tint.set(
        rgb(color(stop)).map((channel) => channel * shade),
        index * 3,
      );
    });
    return [at, tint];
  }, [stops, color]);
  return (
    // Keyed on the count: a buffer attribute can't change size once made.
    <points key={stops.length}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        sizeAttenuation={false}
        vertexColors
        map={sprite}
        alphaTest={0.5}
        transparent
      />
    </points>
  );
}

/**
 * The labels to write: the ends, the next stop, where the commander last was, the landmarks
 * (unless a stop of the route is one), and the stop under the pointer.
 */
function mapLabels(
  main: MapStop[] | undefined,
  extra: MapStop[] | undefined,
  here: number | undefined,
  hovered: MapStop | undefined,
): MapLabel[] {
  const labels: MapLabel[] = [];
  /** One label to a system: the first one given it, so the more telling ones go first. */
  const taken = new Set<string>();
  const add = (key: string, stop: MapStop | undefined, text: string, more?: Partial<MapLabel>) => {
    const at = stop?.at.join();
    if (!stop || at === undefined || taken.has(at)) return;
    taken.add(at);
    labels.push({ key, at: stop.at, text, ...more });
  };
  const current = here === undefined ? undefined : main?.find((stop) => stop.index === here);
  const next = here === undefined ? undefined : main?.find((stop) => stop.index > here);
  if (hovered) {
    add(
      'hovered',
      hovered,
      `#${hovered.index} · ${hovered.name}${hovered.estimated ? ' (place estimated)' : ''}`,
      { hint: 'click to copy', kind: 'strong' },
    );
  }
  add('here', current, current?.name ?? '', { kind: 'strong' });
  add('next', next, `Next · ${next?.name}`, { below: true });
  for (const [key, stops] of [
    ['', main],
    ['compare-', extra],
  ] as const) {
    add(`${key}start`, stops?.[0], `Start · ${stops?.[0]?.name}`);
    add(`${key}end`, stops?.at(-1), `End · ${stops?.at(-1)?.name}`);
  }
  const named = new Set([...(main ?? []), ...(extra ?? [])].map((stop) => stop.name));
  for (const mark of LANDMARK_STOPS) {
    if (!named.has(mark.name)) add(`landmark:${mark.name}`, mark, mark.name, { kind: 'faint' });
  }
  return labels;
}

/**
 * Moves the overlay's labels to where their points are drawn, on every frame the scene draws (only
 * when something moved), straight on the elements rather than through React.
 */
function LabelMover({
  labels,
  elements,
}: {
  labels: readonly MapLabel[];
  elements: RefObject<Map<string, HTMLElement>>;
}) {
  const invalidate = useThree((state) => state.invalidate);
  // New labels need placing though nothing moved.
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- run on each change, on purpose
  useEffect(() => invalidate(), [labels, invalidate]);
  const point = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const label of labels) {
      const element = elements.current.get(label.key);
      if (!element) continue;
      point.set(...label.at).project(camera);
      element.style.visibility = point.z > 1 || point.z < -1 ? 'hidden' : '';
      const x = ((point.x + 1) / 2) * size.width;
      const y = ((1 - point.y) / 2) * size.height;
      element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  });
  return null;
}

/** A grid on the galactic plane under the route, lines at round distances, for depth. */
function PlaneGrid({ box, color }: { box: Bounds; color: string }) {
  const step = gridStep(box.radius * 2);
  const cells = Math.ceil((box.radius * 3) / step);
  const size = cells * step;
  const x = Math.round(box.center[0] / step) * step;
  const z = Math.round(box.center[2] / step) * step;
  return (
    <gridHelper
      key={`${size}:${color}`}
      args={[size, cells, color, color]}
      position={[x, 0, z]}
      onUpdate={(grid: GridHelper) => {
        for (const material of [grid.material].flat()) {
          material.transparent = true;
          material.opacity = 0.35;
        }
      }}
    />
  );
}

/** Points the camera at the stops: slanted across them, or looking down on them from above. */
function CameraRig({ box, view }: { box: Bounds; view: { kind: View; at: number } }) {
  // Only to run again once OrbitControls below has made itself the default.
  const ready = useThree((state) => state.controls !== null);
  const get = useThree((state) => state.get);
  const { center, radius } = box;
  const [cx, cy, cz] = center;

  useEffect(() => {
    const { camera, invalidate } = get();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- OrbitControls below is makeDefault
    const controls = get().controls as OrbitControlsImpl | null;
    if (!ready || !controls) return;
    const distance = radius * 2.4;
    const direction =
      view.kind === 'above' ? new Vector3(0, 1, 0.0001) : new Vector3(0.35, 0.75, 0.9);
    direction.normalize().multiplyScalar(distance);
    camera.position.set(cx + direction.x, cy + direction.y, cz + direction.z);
    camera.near = Math.max(0.1, radius / 2000);
    // Far enough for the landmarks, wherever the route is.
    camera.far = Math.max(radius * 40, 200_000);
    camera.updateProjectionMatrix();
    controls.target.set(cx, cy, cz);
    controls.update();
    invalidate();
    // Refitted when asked, or when the route's extent changes, not on every new object.
  }, [ready, get, view, cx, cy, cz, radius]);

  return <OrbitControls makeDefault enableDamping dampingFactor={0.15} zoomSpeed={1.4} />;
}

/**
 * Finds the stop under the pointer on screen, as dots of a fixed size are easier to point at that
 * way than by casting a ray, and copies its name on a click that wasn't a drag.
 */
function Picker({
  stops,
  onHover,
  onPick,
}: {
  stops: readonly MapStop[];
  onHover: (stop: MapStop | undefined) => void;
  /** A stop clicked: its name goes on the clipboard. */
  onPick: (stop: MapStop) => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const element = gl.domElement;
    const point = new Vector3();
    let hovered: MapStop | undefined;
    let down: { x: number; y: number } | undefined;
    const nearest = (event: PointerEvent): MapStop | undefined => {
      const rect = element.getBoundingClientRect();
      let best: MapStop | undefined;
      let bestDistance = 12;
      for (const stop of stops) {
        point.set(...stop.at).project(camera);
        if (point.z > 1) continue;
        const x = ((point.x + 1) / 2) * rect.width;
        const y = ((1 - point.y) / 2) * rect.height;
        const distance = Math.hypot(
          x - (event.clientX - rect.left),
          y - (event.clientY - rect.top),
        );
        if (distance < bestDistance) {
          best = stop;
          bestDistance = distance;
        }
      }
      return best;
    };
    const move = (event: PointerEvent) => {
      // While dragging the view round, the dots are moving under a still pointer anyway.
      if (event.buttons !== 0) return;
      const stop = nearest(event);
      if (stop === hovered) return;
      hovered = stop;
      element.style.cursor = stop ? 'pointer' : '';
      onHover(stop);
      invalidate();
    };
    const press = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const release = (event: PointerEvent) => {
      const click = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4;
      down = undefined;
      const stop = click ? nearest(event) : undefined;
      if (stop) onPick(stop);
    };
    const leave = () => {
      hovered = undefined;
      onHover(undefined);
      invalidate();
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerdown', press);
    element.addEventListener('pointerup', release);
    element.addEventListener('pointerleave', leave);
    return () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerdown', press);
      element.removeEventListener('pointerup', release);
      element.removeEventListener('pointerleave', leave);
    };
  }, [camera, gl, invalidate, stops, onHover, onPick]);

  return null;
}

/** A white disc, so the dots are round rather than square. */
function dotTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(32, 32, 30, 0, Math.PI * 2);
    context.fill();
  }
  return new CanvasTexture(canvas);
}

/**
 * The palette, read again whenever the theme root's style changes (the HUD colour is set there).
 */
function usePalette(): Palette {
  const { themeRoot } = useEdssiInstance();
  const [palette, setPalette] = useState(() => readPalette(themeRoot()));
  useEffect(() => {
    const root = themeRoot();
    // Read again once mounted: an embedded EDSSI's root may not have been there at first.
    const frame = requestAnimationFrame(() => setPalette(readPalette(root)));
    const observer = new MutationObserver(() => setPalette(readPalette(root)));
    observer.observe(root, { attributes: true, attributeFilter: ['style'] });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [themeRoot]);
  return palette;
}

function readPalette(root: HTMLElement): Palette {
  const style = getComputedStyle(root);
  const read = (name: string) => resolveColor(style.getPropertyValue(name).trim());
  return {
    ahead: read('--accent'),
    flown: read('--muted'),
    here: read('--marker'),
    compare: read('--warn'),
    landmark: read('--dim'),
    grid: read('--rule'),
  };
}

/**
 * Any CSS colour (the stylesheet mixes its own with `color-mix`, which three.js can't read) as
 * `#rrggbb`, by painting it: a canvas reads back whatever the browser understands.
 */
function resolveColor(css: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || css === '') return '#ffffff';
  context.fillStyle = '#000';
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** `#rrggbb` as vertex colour channels, in the working colour space three.js draws in. */
function rgb(hex: string): [number, number, number] {
  const { r, g, b } = new Color(hex);
  return [r, g, b];
}
