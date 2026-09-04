import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { toast } from "sonner";
import { firebaseAuth, firestore } from "@/lib/firebase";
import { appendFirebaseTrackPoints } from "@/lib/firebase-data";

type Point = { id: string; lat: number; lng: number; t: string };
type Store = { points: Record<string, Point>; pending: Record<string, Point> };
const key = (uid: string) => `muhu-road-coverage-v1:${uid}`;

/** The local copy is retained after acknowledgement; only the upload queue clears. */
export function useRoadCoverage() {
  const [owner, setOwner] = useState<string | null>(null);
  const [tracks, setTracks] = useState<[number, number][][]>([]);
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
    setTracks(Object.values(data.points).map((p) => [[p.lat, p.lng]]));
  }), []);

  const remember = useCallback((pt: [number, number]) => {
    const state = current.current;
    if (!state || state.uid !== firebaseAuth.currentUser?.uid) return;
    const id = `${Math.round(pt[0] / 0.000045)}_${Math.round(pt[1] / 0.00008)}`;
    if (state.data.points[id]) return;
    const p = { id, lat: pt[0], lng: pt[1], t: new Date().toISOString() };
    state.data.points[id] = p;
    state.data.pending[id] = p;
    persist();
  }, [persist]);

  useEffect(() => {
    if (!owner) return;
    let busy = false;
    const flush = async () => {
      const state = current.current;
      if (busy || !state || state.uid !== owner || firebaseAuth.currentUser?.uid !== owner) return;
      const batch = Object.values(state.data.pending);
      if (!batch.length) return;
      busy = true;
      try {
        const trackId = `coverage-${owner}`;
        await setDoc(doc(firestore, "tracks", trackId), { userId: owner, startedAt: serverTimestamp(), coverage: true }, { merge: true });
        if (firebaseAuth.currentUser?.uid !== owner) return;
        await appendFirebaseTrackPoints(trackId, batch);
        for (const p of batch) delete state.data.pending[p.id];
        if (current.current === state) persist();
      } catch {
        // Keep the durable queue for reconnect, reload, or the next timer tick.
      } finally { busy = false; }
    };
    void flush();
    const timer = window.setInterval(() => void flush(), 5000);
    window.addEventListener("online", flush);
    return () => { clearInterval(timer); window.removeEventListener("online", flush); };
  }, [owner, persist]);

  return { localCoverage: tracks, rememberCoverage: remember, coverageOwner: owner };
}
