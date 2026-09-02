import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";
import { isOnMuhu, distanceMeters } from "@/lib/muhu";
import * as api from "@/lib/firebase-data";

/** Tausta-asukohajälgimine (Android foreground service); veebil pole implementatsiooni. */
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");
export type Position = { lat: number; lng: number; accuracy?: number };

function usableFix(lat: number, lng: number, accuracy?: number): Position | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Esimene GPS-fiks võib olla ajutiselt ebatäpne. Seda ei tohi ära visata,
  // sest siis kaob kasutaja asukohamärk täielikult; kaardil näidatav ring
  // annab selle tegelikust täpsusest kohe märku.
  return { lat, lng, accuracy: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : undefined };
}
export function useGeolocation(active: boolean) {
  const [pos, setPos] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    let cancelled = false;
    let clear: (() => void) | null = null;
    (async () => {
      try {
        const { Geolocation } = await import("@capacitor/geolocation");
        await Geolocation.requestPermissions().catch(() => undefined);
        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
          (p, e) => {
            if (cancelled) return;
            if (e || !p) {
              setError(e?.message ?? "Asukohta ei saa");
              return;
            }
            const fix = usableFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
            if (!fix) return;
            setPos(fix);
            setError(null);
          },
        );
        if (cancelled) void Geolocation.clearWatch({ id });
        else clear = () => void Geolocation.clearWatch({ id });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Asukohta ei saa");
      }
    })();
    return () => {
      cancelled = true;
      clear?.();
    };
  }, [active]);
  return { pos, error, onMuhu: pos ? isOnMuhu(pos.lat, pos.lng) : false };
}
export function useMuhuData(_code: string | null, groupId: string | null) {
  const pointsQuery = useQuery({
    queryKey: ["points", groupId],
    enabled: !!groupId,
    queryFn: () => api.listFirebasePoints(groupId!),
  });
  const tracksQuery = useQuery({
    queryKey: ["tracks"],
    enabled: !!_code,
    queryFn: api.listFirebaseTracks,
  });
  return { pointsQuery, tracksQuery };
}

/**
 * Jälgimine oma asukohavaatlejaga: Androidil töötab taustal (foreground service),
 * veebis tavalise Geolocation watchPosition'iga. Tagastab ka trackingPos,
 * et kaart ja rohelised teed uuenevad ka siis, kui äpp pole aktiivselt ees.
 */
export function useTracking(code: string | null) {
  const qc = useQueryClient();
  const [trackId, setTrackId] = useState<string | null>(null);
  const [liveTrack, setLiveTrack] = useState<[number, number][]>([]);
  const [trackingPos, setTrackingPos] = useState<Position | null>(null);
  const buffer = useRef<{ lat: number; lng: number; t: string }[]>([]);
  const last = useRef<Position | null>(null);
  const trackIdRef = useRef<string | null>(null);
  const pendingKey = "muhu-track-pending-v1";
  const savePending = useCallback(() => {
    if (typeof window === "undefined" || !trackIdRef.current) return;
    localStorage.setItem(pendingKey, JSON.stringify({ trackId: trackIdRef.current, points: buffer.current }));
  }, []);

  const handleFix = useCallback((lat: number, lng: number, accuracy?: number) => {
    const fix = usableFix(lat, lng, accuracy);
    if (!fix) return;
    setTrackingPos(fix);
    if (last.current && distanceMeters(last.current, fix) < 2) return;
    last.current = fix;
    buffer.current.push({ ...fix, t: new Date().toISOString() });
    savePending();
    setLiveTrack((p) => [...p, [lat, lng] as [number, number]]);
  }, [savePending]);

  // Asukohavaatleja: Androidil BackgroundGeolocation (töötab taustal), mujal Geolocation
  useEffect(() => {
    if (!trackId || typeof window === "undefined") return;
    let cancelled = false;
    let clear: (() => void) | null = null;
    (async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          const id = await BackgroundGeolocation.addWatcher(
            {
              backgroundTitle: "Muhu kaart",
              backgroundMessage: "Asukoha jälgimine töötab taustal",
              requestPermissions: true,
              stale: false,
              distanceFilter: 2,
            },
            (location, error) => {
              if (cancelled) return;
              if (error) {
                if (error.code !== "REMOVE")
                  console.warn("Tausta-asukoht:", error.code, error.message);
                return;
              }
              if (location) handleFix(location.latitude, location.longitude, location.accuracy);
            },
          );
          if (cancelled) {
            void BackgroundGeolocation.removeWatcher({ id });
            return;
          }
          clear = () => void BackgroundGeolocation.removeWatcher({ id });
        } else {
          const { Geolocation } = await import("@capacitor/geolocation");
          const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
            (p, e) => {
              if (cancelled) return;
              if (e || !p) return;
              handleFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
            },
          );
          if (cancelled) {
            void Geolocation.clearWatch({ id });
            return;
          }
          clear = () => void Geolocation.clearWatch({ id });
        }
      } catch (e) {
        console.warn("Jälgimise vaatleja ei käivitunud:", e);
        if (!cancelled) toast.error("Asukoha jälgimine ei käivitunud");
      }
    })();
    return () => {
      cancelled = true;
      clear?.();
    };
  }, [trackId, handleFix]);

  // Puhvri loputus iga 15 s ja ka siis, kui äpp läheb taustale
  useEffect(() => {
    if (!trackId) return;
    const flush = async () => {
      const b = buffer.current;
      if (!b.length) return;
      buffer.current = [];
      try {
        await api.appendFirebaseTrackPoints(trackId, b);
        localStorage.removeItem(pendingKey);
      } catch {
        buffer.current = [...b, ...buffer.current];
        savePending();
      }
    };
    const timer = setInterval(flush, 15000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      void flush();
    };
  }, [trackId, savePending]);

  const start = useCallback(async () => {
    if (!code) return;
    const nextTrackId = await api.startFirebaseTrack();
    const saved = typeof window === "undefined" ? null : localStorage.getItem(pendingKey);
    if (saved) {
      try {
        const pending = JSON.parse(saved) as { points?: { lat: number; lng: number; t: string }[] };
        if (Array.isArray(pending.points)) buffer.current = pending.points;
      } catch {
        localStorage.removeItem(pendingKey);
      }
    }
    trackIdRef.current = nextTrackId;
    setTrackId(nextTrackId);
    last.current = null;
    setLiveTrack([]);
    toast.success(Capacitor.isNativePlatform() ? "Jälgimine käib – ka taustal" : "Jälgimine käib");
  }, [code]);
  const stop = useCallback(async () => {
    if (!trackId) return;
    const b = buffer.current;
    buffer.current = [];
    if (b.length) await api.appendFirebaseTrackPoints(trackId, b);
    await api.endFirebaseTrack(trackId);
    setTrackId(null);
    trackIdRef.current = null;
    if (typeof window !== "undefined") localStorage.removeItem(pendingKey);
    setLiveTrack([]);
    void qc.invalidateQueries({ queryKey: ["tracks"] });
    toast.success("Jälgimine lõpetatud");
  }, [trackId, qc]);
  return { tracking: !!trackId, liveTrack, trackingPos, start, stop };
}
export function usePointActions(_code: string | null, groupId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["points", groupId] });
  const add = useMutation({
    mutationFn: (i: { title: string; lat: number; lng: number }) =>
      api.addFirebasePoint(groupId!, i.title, i.lat, i.lng, "Kasutaja"),
    onSuccess: () => {
      invalidate();
      toast.success("Punkt lisatud");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: api.deleteFirebasePoint,
    onSuccess: () => {
      invalidate();
      toast.success("Punkt kustutatud");
    },
  });
  const setVisited = useMutation({
    mutationFn: (i: { id: string; visited: boolean }) => api.toggleFirebaseVisit(i.id, i.visited),
    onSuccess: (_, i) => {
      invalidate();
      toast.success(i.visited ? "Märgitud käiduks" : "Käidud märge eemaldatud");
    },
  });
  const update = useMutation({
    mutationFn: (i: { id: string; title?: string; description?: string }) =>
      api.updateFirebasePoint(i.id, { title: i.title, description: i.description }),
    onSuccess: () => {
      invalidate();
      toast.success("Salvestatud");
    },
  });
  return { add, remove, setVisited, update };
}
