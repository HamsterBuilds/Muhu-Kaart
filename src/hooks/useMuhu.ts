import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";
import { isOnMuhu, distanceMeters } from "@/lib/muhu";
import * as api from "@/lib/firebase-data";
import { firebaseAuth } from "@/lib/firebase";

/** Tausta-asukohajälgimine (Android foreground service); veebil pole implementatsiooni. */
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");
export type Position = { lat: number; lng: number; accuracy?: number };

function usableFix(lat: number, lng: number, accuracy?: number): Position | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Esimene GPS-fiks võib olla ajutiselt ebatäpne. Seda ei tohi ära visata,
  // sest siis kaob kasutaja asukohamärk täielikult; kaardil näidatav ring
  // annab selle tegelikust täpsusest kohe märku.
  return { lat, lng, ...(typeof accuracy === "number" && Number.isFinite(accuracy) ? { accuracy } : {}) };
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
    queryKey: ["tracks", _code],
    enabled: !!_code,
    queryFn: api.listFirebaseTracks,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  return { pointsQuery, tracksQuery };
}

/**
 * Jälgimine oma asukohavaatlejaga: Androidil töötab taustal (foreground service),
 * veebis tavalise Geolocation watchPosition'iga. Tagastab ka trackingPos,
 * et kaart ja rohelised teed uuenevad ka siis, kui äpp pole aktiivselt ees.
 */
export function useTracking(code: string | null, rememberCoverage: (point: [number, number]) => void) {
  const activeTrackingKey = firebaseAuth.currentUser?.uid
    ? `muhu-tracking-active-v1:${firebaseAuth.currentUser.uid}`
    : null;
  const [trackId, setTrackId] = useState<string | null>(() => {
    if (!activeTrackingKey || typeof window === "undefined") return null;
    return localStorage.getItem(activeTrackingKey) === "1" ? code : null;
  });
  const [liveTrack, setLiveTrack] = useState<[number, number][]>([]);
  const [trackingPos, setTrackingPos] = useState<Position | null>(null);
  const last = useRef<Position | null>(null);

  // Auth and the app shell can initialize in either order; resume a session
  // once the signed-in code becomes available after a cold app launch.
  useEffect(() => {
    if (code && activeTrackingKey && localStorage.getItem(activeTrackingKey) === "1") {
      setTrackId((current) => current ?? code);
    }
  }, [activeTrackingKey, code]);

  const handleFix = useCallback((lat: number, lng: number, accuracy?: number) => {
    const fix = usableFix(lat, lng, accuracy);
    if (!fix) return;
    setTrackingPos(fix);
    if (last.current && distanceMeters(last.current, fix) < 2) return;
    last.current = fix;
    // One durable sample per spatial cell, never a new timestamp/random document
    // for every lap. The map separately remembers canonical road geometry.
    rememberCoverage([lat, lng]);
    setLiveTrack((p) => [...p.slice(-1023), [lat, lng] as [number, number]]);
  }, [rememberCoverage]);

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

  const start = useCallback(async () => {
    if (!code) return;
    // Preserve old pending trip data by importing it into deduplicated coverage.
    try {
      const saved = JSON.parse(localStorage.getItem("muhu-track-pending-v1") ?? "null");
      if (saved?.userId === firebaseAuth.currentUser?.uid && Array.isArray(saved.points)) {
        for (const p of saved.points) {
          if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) rememberCoverage([p.lat, p.lng]);
        }
      }
    } catch { /* Keep the legacy recovery copy untouched. */ }
    setTrackId(code);
    setTrackingPos(null);
    if (activeTrackingKey) localStorage.setItem(activeTrackingKey, "1");
    last.current = null;
    setLiveTrack([]);
    toast.success(Capacitor.isNativePlatform() ? "Jälgimine käib – ka taustal" : "Jälgimine käib");
  }, [code, rememberCoverage, activeTrackingKey]);
  const stop = useCallback(async () => {
    setTrackId(null);
    setTrackingPos(null);
    if (activeTrackingKey) localStorage.removeItem(activeTrackingKey);
    setLiveTrack([]);
    // useRoadCoverage owns the durable retry queue even after tracking stops.
    toast.success("Jälgimine lõpetatud");
  }, [activeTrackingKey]);
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
    mutationFn: ({ id, ...changes }: { id: string; title?: string; description?: string }) =>
      api.updateFirebasePoint(id, changes),
    onSuccess: () => {
      invalidate();
      toast.success("Salvestatud");
    },
  });
  return { add, remove, setVisited, update };
}
