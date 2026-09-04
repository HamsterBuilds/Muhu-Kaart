import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { toast } from "sonner";
import { firebaseAuth, firestore } from "@/lib/firebase";
import { appendFirebaseTrackPoints } from "@/lib/firebase-data";

export type CoverageSegment = { aLat: number; aLng: number; bLat: number; bLng: number; motorRoad?: boolean; traversableRoad?: boolean; coverageVersion?: number };
type Point = { id: string; lat: number; lng: number; t: string; segment?: CoverageSegment; verifiedTime?: boolean };
type Store = { points: Record<string, Point>; pending: Record<string, Point> };
const key = (uid: string) => `muhu-road-coverage-v1:${uid}`;
const pointId = (lat: number, lng: number) => `${Math.round(lat / 0.000045)}_${Math.round(lng / 0.00008)}`;
const segmentId = (s: CoverageSegment) => `segment_${[`${s.aLat.toFixed(7)}_${s.aLng.toFixed(7)}`, `${s.bLat.toFixed(7)}_${s.bLng.toFixed(7)}`].sort().join("_")}`;
const validSegment = (s: CoverageSegment | undefined): s is CoverageSegment => !!s && s.coverageVersion === 4 && s.traversableRoad === true && [s.aLat, s.aLng, s.bLat, s.bLng].every(Number.isFinite);
const rawTracks = (data: Store) => {
  const points = Object.values(data.points).filter((p) => !p.segment && p.verifiedTime).sort((a, b) => a.t.localeCompare(b.t));
  const tracks: [number, number][][] = [];
  let previous: Point | undefined;
  for (const point of points) {
    const dt = previous ? Date.parse(point.t) - Date.parse(previous.t) : Infinity;
    const metres = previous ? Math.hypot((point.lat - previous.lat) * 110_540, (point.lng - previous.lng) * 111_320 * Math.cos(point.lat * Math.PI / 180)) : Infinity;
    if (!previous || dt < 0 || dt > 180_000 || metres > 250) tracks.push([]);
    tracks.at(-1)!.push([point.lat, point.lng]);
    previous = point;
  }
  return tracks;
};
const status = (data: Store, prefix = "Kohalikult") => `${prefix} GPS-punkte ${Object.values(data.points).filter(p => !p.segment).length} · ootel ${Object.keys(data.pending).length}`;

/** The local copy is retained after acknowledgement; only the upload queue clears. */
export function useRoadCoverage(cloudTracks?: { points: [number, number][]; recordedPoints?: { lat: number; lng: number; t: string }[]; segments?: CoverageSegment[] }[]) {
  const [owner, setOwner] = useState<string | null>(null);
  const [tracks, setTracks] = useState<[number, number][][]>([]);
  const [syncStatus, setSyncStatus] = useState("Laen käidud teid…");
  const [segments, setSegments] = useState<CoverageSegment[]>([]);
  const current = useRef<{ uid: string; data: Store } | null>(null);
  const warned = useRef(false);
  const persist = useCallback(() => {
    const state = current.current;
    if (!state) return;
    try {
      localStorage.setItem(key(state.uid), JSON.stringify(state.data));
    } catch {
      if (!warned.current) toast.error("Kohalik salvestus ebaõnnestus. Ära sulge äppi enne pilve sünkroonimist.");
      warned.current = true;
    }
  }, []);

  useEffect(() => onAuthStateChanged(firebaseAuth, (user) => {
    let data: Store = { points: {}, pending: {} };
    if (user) {
      try {
        const saved = JSON.parse(localStorage.getItem(key(user.uid)) ?? "null");
        if (saved?.points && saved?.pending) {
          for (const field of ["points", "pending"] as const) {
            for (const [id, value] of Object.entries(saved[field])) {
              const p = value as Point;
              if (p && p.id === id && Number.isFinite(p.lat) && Number.isFinite(p.lng) && typeof p.t === "string") data[field][id] = p;
            }
          }
        }
      } catch { /* An invalid cache must not stop cloud recovery. */ }
    }
    current.current = user ? { uid: user.uid, data } : null;
    setOwner(user?.uid ?? null);
    // Separate samples must not be joined into artificial cross-island routes.
    setTracks(rawTracks(data));
    setSegments(Object.values(data.points).flatMap((p) => p.segment && validSegment(p.segment) ? [p.segment] : []));
    setSyncStatus(status(data));
  }), []);

  const remember = useCallback((pt: [number, number], segment?: CoverageSegment) => {
    const state = current.current;
    if (!state || state.uid !== firebaseAuth.currentUser?.uid) return;
    if (segment && !validSegment(segment)) return;
    const id = segment ? segmentId(segment) : pointId(pt[0], pt[1]);
    const existing = state.data.points[id];
    // Preserve legacy history, but revalidate its geometry against car roads.
    if (existing && (!segment || validSegment(existing.segment))) return;
    const p = { id, lat: pt[0], lng: pt[1], t: new Date().toISOString(), ...(segment ? { segment } : { verifiedTime: true }) };
    state.data.points[id] = p;
    state.data.pending[id] = p;
    persist();
    if (segment) setSegments((previous) => [...previous, segment]);
    else setTracks((previous) => [...previous, [pt]]);
  }, [persist]);

  // Cache downloaded history even when its roads are outside the viewport.
  // Cloud-confirmed points do not need to be enqueued for upload again.
  useEffect(() => {
    const state = current.current;
    if (!state || state.uid !== owner || !cloudTracks) return;
    let changed = false;
    for (const track of cloudTracks) {
      for (const segment of track.segments ?? []) {
        if (!validSegment(segment)) continue;
        const id = segmentId(segment);
        if (validSegment(state.data.points[id]?.segment)) continue;
        state.data.points[id] = { id, lat: (segment.aLat + segment.bLat) / 2, lng: (segment.aLng + segment.bLng) / 2, t: new Date().toISOString(), segment };
        changed = true;
      }
      const recorded = track.recordedPoints ?? track.points.map(([lat, lng]) => ({ lat, lng, t: "" }));
      for (const { lat, lng, t } of recorded) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const id = pointId(lat, lng);
        const verifiedTime = Boolean(t && Number.isFinite(Date.parse(t)));
        if (state.data.points[id]?.verifiedTime || !verifiedTime) continue;
        state.data.points[id] = { id, lat, lng, t, verifiedTime: true };
        changed = true;
      }
    }
    if (changed) {
      persist();
      setTracks(rawTracks(state.data));
      setSegments(Object.values(state.data.points).flatMap((p) => p.segment && validSegment(p.segment) ? [p.segment] : []));
      setSyncStatus(status(state.data));
    }
  }, [cloudTracks, owner, persist]);

  useEffect(() => {
    if (!owner) return;
    let busy = false;
    const flush = async () => {
      const state = current.current;
      if (busy || !state || state.uid !== owner || firebaseAuth.currentUser?.uid !== owner) return;
      const batch = Object.values(state.data.pending);
      if (!batch.length) return;
      busy = true;
      setSyncStatus(`Salvestan pilve ${batch.length} punkti…`);
      try {
        const trackId = `coverage-${owner}`;
        await setDoc(doc(firestore, "tracks", trackId), { userId: owner, startedAt: serverTimestamp(), coverage: true }, { merge: true });
        if (firebaseAuth.currentUser?.uid !== owner) return;
        await appendFirebaseTrackPoints(trackId, batch);
        for (const p of batch) {
          // A legacy segment can be upgraded while its old upload is in flight.
          if (state.data.pending[p.id] === p) delete state.data.pending[p.id];
        }
        if (current.current === state) persist();
        if (current.current === state) setSyncStatus(status(state.data, "Pilves kinnitatud · kohalikult"));
      } catch (error) {
        if (current.current === state) setSyncStatus(`Pilve salvestus ebaõnnestus: ${error instanceof Error ? error.message : String(error)}`);
        // Keep the durable queue for reconnect, reload, or the next timer tick.
      } finally { busy = false; }
    };
    void flush();
    const timer = window.setInterval(() => void flush(), 5000);
    window.addEventListener("online", flush);
    return () => { clearInterval(timer); window.removeEventListener("online", flush); };
  }, [owner, persist]);

  return { localCoverage: tracks, coverageSegments: segments, rememberCoverage: remember, coverageOwner: owner, syncStatus };
}
