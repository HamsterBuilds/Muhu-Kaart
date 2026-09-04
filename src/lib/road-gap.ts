import { segmentDistanceMeters, type Road } from "./roads";
type Point = [number, number];

/** Infer only a short, unambiguous path on one mapped way, never a straight
 * chord through neighbouring roads. Missing/ambiguous topology means no guess. */
export function roadGapPath(roads: Iterable<Road>, from: Point, to: Point): Point[] {
  const matches: { road: Road; start: number; end: number }[] = [];
  for (const road of roads) {
    let start = -1, end = -1, da = 3, db = 3;
    for (let i = 0; i < road.coords.length - 1; i++) {
      const a = road.coords[i]!, b = road.coords[i + 1]!;
      const x = segmentDistanceMeters(from, a, b), y = segmentDistanceMeters(to, a, b);
      if (x < da) { da = x; start = i; }
      if (y < db) { db = y; end = i; }
    }
    if (start >= 0 && end >= 0) matches.push({ road, start, end });
  }
  // Identical geometry from separate tiles/sources is one route, not ambiguity.
  const routeKey = ({ road, start, end }: typeof matches[number]) => {
    const vertices = road.coords.slice(Math.min(start, end), Math.max(start, end) + 2);
    const forward = vertices.map(p => p.map(n => n.toFixed(6)).join(",")).join(";");
    const reverse = [...vertices].reverse().map(p => p.map(n => n.toFixed(6)).join(",")).join(";");
    return [forward, reverse].sort()[0];
  };
  if (!matches.length || new Set(matches.map(routeKey)).size !== 1) return [];
  const {road, start, end} = matches[0]!;
  const vertices = start <= end
    ? road.coords.slice(start + 1, end + 1)
    : road.coords.slice(end + 1, start + 1).reverse();
  const path = [from, ...vertices, to];
  const result: Point[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const length = Math.hypot((b[0]-a[0])*111320, (b[1]-a[1])*111320*Math.cos(a[0]*Math.PI/180));
    total += length;
    if (total > 250) return [];
    const steps = Math.max(1, Math.ceil(length/2));
    for (let n = 1; n <= steps; n++) result.push([a[0]+(b[0]-a[0])*n/steps,a[1]+(b[1]-a[1])*n/steps]);
  }
  return result;
}

/** Restore short holes between recorded anchors on the same mapped way.
 * Order by road position, not upload order; never join arbitrary GPS samples. */
export function savedRoadGapPaths(road: Road, points: Iterable<Point>): Point[][] {
  const anchors: { point: Point; position: number }[] = [];
  for (const point of points) {
    let distance = 3, position = -1;
    for (let i = 0; i < road.coords.length - 1; i++) {
      const a = road.coords[i]!, b = road.coords[i + 1]!;
      const d = segmentDistanceMeters(point, a, b);
      if (d >= distance) continue;
      distance = d;
      const dx = b[1] - a[1], dy = b[0] - a[0];
      const t = (dx * dx + dy * dy) ? ((point[1] - a[1]) * dx + (point[0] - a[0]) * dy) / (dx * dx + dy * dy) : 0;
      position = i + Math.max(0, Math.min(1, t));
    }
    if (position >= 0) anchors.push({ point, position });
  }
  anchors.sort((a, b) => a.position - b.position);
  return anchors.slice(1).map((anchor, i) => roadGapPath([road], anchors[i]!.point, anchor.point)).filter(path => path.length);
}
