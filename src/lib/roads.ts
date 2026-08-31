export type Road = { id: string; coords: [number, number][] };
export type BBox = { south: number; west: number; north: number; east: number };
export type Cell = { key: string; bbox: BBox };

const CELL_DEG = 0.02;
const FAIL_RETRY_MS = 30_000;
const OVERPASS_TIMEOUT_MS = 25_000;

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export function bboxForCellKey(key: string): BBox {
  const [y, x] = key.split(":");
  const cy = Number(y);
  const cx = Number(x);
  return {
    south: cy * CELL_DEG,
    west: cx * CELL_DEG,
    north: (cy + 1) * CELL_DEG,
    east: (cx + 1) * CELL_DEG,
  };
}

export function cellsForBounds(view: BBox): Cell[] {
  const keys = new Set<string>();
  const y0 = Math.floor(view.south / CELL_DEG);
  const y1 = Math.floor(view.north / CELL_DEG);
  const x0 = Math.floor(view.west / CELL_DEG);
  const x1 = Math.floor(view.east / CELL_DEG);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) keys.add(`${y}:${x}`);
  }
  return [...keys].map((key) => ({ key, bbox: bboxForCellKey(key) }));
}

export type CellFetchState = { ok: boolean; ts: number };
export const isCellStale = (rec: CellFetchState | undefined, now: number): boolean =>
  !rec || (!rec.ok && now - rec.ts > FAIL_RETRY_MS);

export async function fetchRoadsForCells(cells: Cell[], signal?: AbortSignal): Promise<Road[]> {
  if (!cells.length) return [];
  const parts = cells
    .map(
      (c) =>
        `way["highway"](${c.bbox.south.toFixed(5)},${c.bbox.west.toFixed(5)},${c.bbox.north.toFixed(5)},${c.bbox.east.toFixed(5)});`,
    )
    .join("");
  const data = `[out:json][timeout:30];(${parts});out geom 6000;`;
  let lastError: unknown = null;
  for (const url of MIRRORS) {
    for (const method of ["post", "get"] as const) {
      try {
        const init: RequestInit =
          method === "post"
            ? {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ data }).toString(),
              }
            : { method: "GET" };
        if (signal) init.signal = signal;
        const res = await fetch(
          method === "post" ? url : `${url}?data=${encodeURIComponent(data)}`,
          init,
        );
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
        const json: unknown = await res.json();
        return parseOverpass(json);
      } catch (e) {
        if (signal?.aborted) throw e;
        lastError = e;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Overpass ei ole saadaval");
}

function parseOverpass(json: unknown): Road[] {
  const roads: Road[] = [];
  if (typeof json !== "object" || json === null) return roads;
  const elements = (json as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return roads;
  for (const el of elements) {
    if (typeof el !== "object" || el === null) continue;
    const e = el as { type?: unknown; id?: unknown; geometry?: unknown };
    if (e.type !== "way" || typeof e.id !== "number" || !Array.isArray(e.geometry)) continue;
    const coords: [number, number][] = [];
    for (const node of e.geometry) {
      if (typeof node !== "object" || node === null) continue;
      const p = node as { lat?: unknown; lon?: unknown };
      if (typeof p.lat === "number" && typeof p.lon === "number") coords.push([p.lat, p.lon]);
    }
    if (coords.length >= 2) roads.push({ id: String(e.id), coords });
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
