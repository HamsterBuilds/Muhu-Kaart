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
  // Duplicate map sources are also ambiguous: don't manufacture coverage.
  if (matches.length !== 1) return [];
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
    if (total > 100) return [];
    const steps = Math.max(1, Math.ceil(length/2));
    for (let n = 1; n <= steps; n++) result.push([a[0]+(b[0]-a[0])*n/steps,a[1]+(b[1]-a[1])*n/steps]);
  }
  return result;
}
