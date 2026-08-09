import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isOnMuhu, distanceMeters } from "@/lib/muhu";
import {
  addPoint,
  appendTrackPoints,
  deletePoint,
  enrichPoint,
  endTrack,
  listMyTracks,
  listPoints,
  startTrack,
  toggleVisit,
  updatePoint,
} from "@/lib/muhu-api.functions";

export type Position = { lat: number; lng: number };

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
          (p, err) => {
            if (cancelled) return;
            if (err || !p) {
              setError(err?.message ?? "Asukohta ei saa");
              return;
            }
            setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
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


export function useMuhuData(code: string | null, groupId: string | null) {
  const listPointsFn = useServerFn(listPoints);
  const listTracksFn = useServerFn(listMyTracks);

  const pointsQuery = useQuery({
    queryKey: ["points", groupId],
    enabled: !!code && !!groupId,
    queryFn: () => listPointsFn({ data: { code: code!, groupId: groupId! } }),
  });

  const tracksQuery = useQuery({
    queryKey: ["tracks", code],
    enabled: !!code,
    queryFn: () => listTracksFn({ data: { code: code! } }),
  });

  return { pointsQuery, tracksQuery };
}

export function useTracking(code: string | null, pos: Position | null) {
  const qc = useQueryClient();
  const startFn = useServerFn(startTrack);
  const appendFn = useServerFn(appendTrackPoints);
  const endFn = useServerFn(endTrack);

  const [trackId, setTrackId] = useState<string | null>(null);
  const [liveTrack, setLiveTrack] = useState<[number, number][]>([]);
  const bufferRef = useRef<{ lat: number; lng: number; t: string }[]>([]);
  const lastRef = useRef<Position | null>(null);

  useEffect(() => {
    if (!trackId || !pos || !code) return;
    const last = lastRef.current;
    if (last && distanceMeters(last, pos) < 8) return;
    lastRef.current = pos;
    bufferRef.current.push({ lat: pos.lat, lng: pos.lng, t: new Date().toISOString() });
    setLiveTrack((prev) => [...prev, [pos.lat, pos.lng]]);
  }, [pos, trackId, code]);

  useEffect(() => {
    if (!trackId || !code) return;
    const flush = async () => {
      const batch = bufferRef.current;
      if (batch.length === 0) return;
      bufferRef.current = [];
      try {
        await appendFn({ data: { code, trackId, points: batch } });
      } catch {
        bufferRef.current = [...batch, ...bufferRef.current];
      }
    };
    const timer = setInterval(flush, 15000);
    return () => {
      clearInterval(timer);
      void flush();
    };
  }, [trackId, code, appendFn]);

  const start = useCallback(async () => {
    if (!code) return;
    const res = await startFn({ data: { code } });
    lastRef.current = null;
    setLiveTrack([]);
    setTrackId(res.id);
    toast.success("Jälgimine käib");
  }, [code, startFn]);

  const stop = useCallback(async () => {
    if (!code || !trackId) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    if (batch.length) await appendFn({ data: { code, trackId, points: batch } });
    await endFn({ data: { code, trackId } });
    setTrackId(null);
    setLiveTrack([]);
    void qc.invalidateQueries({ queryKey: ["tracks", code] });
    toast.success("Jälgimine lõpetatud");
  }, [code, trackId, appendFn, endFn, qc]);

  return { tracking: !!trackId, liveTrack, start, stop };
}

export function usePointActions(code: string | null, groupId: string | null) {
  const qc = useQueryClient();
  const addFn = useServerFn(addPoint);
  const enrichFn = useServerFn(enrichPoint);
  const deleteFn = useServerFn(deletePoint);
  const visitFn = useServerFn(toggleVisit);
  const updateFn = useServerFn(updatePoint);

  const add = useMutation({
    mutationFn: async (input: { title: string; lat: number; lng: number }) => {
      const res = await addFn({
        data: { code: code!, groupId: groupId!, ...input },
      });
      return res.id;
    },
    onSuccess: async (id) => {
      void qc.invalidateQueries({ queryKey: ["points", groupId] });
      toast.success("Punkt lisatud, AI otsib infot...");
      try {
        await enrichFn({ data: { code: code!, pointId: id } });
      } catch {
        /* AI võib ebaõnnestuda – punkt jääb alles */
      }
      void qc.invalidateQueries({ queryKey: ["points", groupId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { code: code!, pointId: id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["points", groupId] });
      toast.success("Punkt kustutatud");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setVisited = useMutation({
    mutationFn: (input: { id: string; visited: boolean }) =>
      visitFn({ data: { code: code!, pointId: input.id, visited: input.visited } }),
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: ["points", groupId] });
      toast.success(input.visited ? "Märgitud käiduks" : "Käidud märge eemaldatud");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; title?: string; description?: string }) =>
      updateFn({
        data: {
          code: code!,
          pointId: input.id,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["points", groupId] });
      toast.success("Salvestatud");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { add, remove, setVisited, update };
}
