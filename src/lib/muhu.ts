import { MUHU_OUTLINE } from "./muhu-outline";

export { MUHU_OUTLINE };

/** Muhu saare kaardi piirid (lõuna-lääs, põhja-ida) koos väikese varuga. */
export const MUHU_BOUNDS: [[number, number], [number, number]] = [
  [58.46, 23.03],
  [58.71, 23.48],
];

export const MUHU_CENTER: [number, number] = [58.5875, 23.25];

/** Kas koordinaat on Muhu saare piirjoone sees (ray casting). */
export function isOnMuhu(lat: number, lng: number): boolean {
  let inside = false;
  const pts = MUHU_OUTLINE;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i]!;
    const [yj, xj] = pts[j]!;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
