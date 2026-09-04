import { Capacitor, CapacitorHttp } from "@capacitor/core";

export type Road = { id: string; coords: [number, number][]; motorRoad?: boolean };
export type BBox = { south: number; west: number; north: number; east: number };
export type Cell = { key: string; bbox: BBox };
/** fine = kõik teed tihedal võrgul (zoom ≥ 13); coarse = suured teed hõredal võrgul (zoom 11–12). */
export type FetchMode = "fine" | "coarse";

export const FINE_DEG = 0.02;
export const COARSE_DEG = 0.08;
const FAIL_RETRY_MS = 5_000;
const OVERPASS_TIMEOUT_MS = 20_000;

const MAJOR_FILTER =
  '["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]';

const MOTOR_ROAD_KINDS = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary",
  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
  "residential", "unclassified", "living_street", "service", "road", "track",
]);
const CONNECTOR_ROAD_KINDS = new Set(["footway", "path", "cycleway", "pedestrian", "steps"]);
export function isMotorRoad(properties: Record<string, unknown>): boolean {
  return MOTOR_ROAD_KINDS.has(String(properties["highway"] ?? properties["kind"] ?? ""))
    && properties["rail"] !== true
    && properties["motorcar"] !== "no" && properties["motor_vehicle"] !== "no";
}
export function isTraversableRoad(properties: Record<string, unknown>): boolean {
  const kind = String(properties["highway"] ?? properties["kind"] ?? "");
  return isMotorRoad(properties) || CONNECTOR_ROAD_KINDS.has(kind);
}
const TRAVERSABLE_ROAD_FILTER = `["highway"~"^(${[...MOTOR_ROAD_KINDS, ...CONNECTOR_ROAD_KINDS].join("|")})$"]`;

export function gridDeg(mode: FetchMode): number {
  return mode === "fine" ? FINE_DEG : COARSE_DEG;
}

export function modeForZoom(zoom: number): FetchMode | null {
  if (zoom >= 13) return "fine";
  if (zoom >= 11) return "coarse";
  return null;
}

export function bboxForCellKey(key: string): BBox {
  const [degStr, y, x] = key.split(":");
  const deg = Number(degStr);
  const cy = Number(y);
  const cx = Number(x);
  return {
    south: cy * deg,
    west: cx * deg,
    north: (cy + 1) * deg,
    east: (cx + 1) * deg,
  };
}

export function cellsForBounds(view: BBox, deg: number): Cell[] {
  const keys = new Set<string>();
  const y0 = Math.floor(view.south / deg);
  const y1 = Math.floor(view.north / deg);
  const x0 = Math.floor(view.west / deg);
  const x1 = Math.floor(view.east / deg);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) keys.add(`${deg}:${y}:${x}`);
  }
  return [...keys].map((key) => ({ key, bbox: bboxForCellKey(key) }));
}

export type CellFetchState = { ok: boolean; ts: number };
export const isCellStale = (rec: CellFetchState | undefined, now: number): boolean =>
  !rec || (!rec.ok && now - rec.ts > FAIL_RETRY_MS);

async function fetchThroughRoadProxy(
  query: string,
  signal: AbortSignal | undefined,
): Promise<Road[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  // The packaged APK contains no web server implementing /api/roads.
  // Native HTTP reaches Overpass directly and does not depend on WebView CORS.
  if (Capacitor.isNativePlatform()) {
    let lastError: unknown;
    for (const url of [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ]) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const response = await CapacitorHttp.post({
          url,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          data: new URLSearchParams({ data: query }).toString(),
          responseType: "json",
          connectTimeout: 15000,
          readTimeout: 35000,
        });
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (response.status < 200 || response.status >= 300)
          throw new Error(`Overpass HTTP ${response.status}`);
        return parseOverpass(
          typeof response.data === "string" ? JSON.parse(response.data) : response.data,
        );
      } catch (error) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        lastError = error;
      }
    }
    throw lastError;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS);
  const abort = () => ctrl.abort();
  signal?.addEventListener("abort", abort);
  try {
    const res = await fetch("/api/roads", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }).toString(),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const json: unknown = await res.json();
    return parseOverpass(json);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** Pärib teed sama päritolu serveripuhvri kaudu, et CORS ei jätaks kaarti tühjaks. */
export async function fetchRoadsForCells(
  cells: Cell[],
  signal?: AbortSignal,
  mode: FetchMode = "fine",
): Promise<Road[]> {
  if (!cells.length) return [];
  const filter = mode === "coarse" ? MAJOR_FILTER : TRAVERSABLE_ROAD_FILTER;
  const parts = cells
    .map(
      (c) =>
        `way${filter}(${c.bbox.south.toFixed(5)},${c.bbox.west.toFixed(5)},${c.bbox.north.toFixed(5)},${c.bbox.east.toFixed(5)});`,
    )
    .join("");
  const limit = mode === "coarse" ? 4_000 : 6_000;
  const query = `[out:json][timeout:30];(${parts});out geom ${limit};`;
  return fetchThroughRoadProxy(query, signal);
}

function parseOverpass(json: unknown): Road[] {
  const roads: Road[] = [];
  if (typeof json !== "object" || json === null) return roads;
  const elements = (json as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return roads;
  for (const el of elements) {
    if (typeof el !== "object" || el === null) continue;
    const e = el as { type?: unknown; id?: unknown; geometry?: unknown; tags?: Record<string, unknown> };
    if (e.type !== "way" || typeof e.id !== "number" || !Array.isArray(e.geometry)) continue;
    if (!e.tags || !isTraversableRoad(e.tags)) continue;
    const coords: [number, number][] = [];
    for (const node of e.geometry) {
      if (typeof node !== "object" || node === null) continue;
      const p = node as { lat?: unknown; lon?: unknown };
      if (typeof p.lat === "number" && typeof p.lon === "number") coords.push([p.lat, p.lon]);
    }
    if (coords.length >= 2) roads.push({ id: String(e.id), coords, motorRoad: isMotorRoad(e.tags) });
  }
  return roads;
}

export function roadBBox(coords: [number, number][]): [number, number, number, number] {
  let minLat = 90;
  let minLng = 180;
  let maxLat = -90;
  let maxLng = -180;
  for (const [lat, lng] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const padLat = 0.0004;
  const padLng = 0.0006;
  return [minLat - padLat, minLng - padLng, maxLat + padLat, maxLng + padLng];
}

/** Lähedus meetrites punkti ja teelõigu (a→b) vahel, ekvirektanguline aproksimatsioon. */
export function segmentDistanceMeters(
  pt: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const latRef = ((a[0]! + b[0]!) / 2) * (Math.PI / 180);
  const kx = 111_320 * Math.cos(latRef);
  const ky = 110_540;
  const px = pt[1]! * kx;
  const py = pt[0]! * ky;
  const ax = a[1]! * kx;
  const ay = a[0]! * ky;
  const bx = b[1]! * kx;
  const by = b[0]! * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
