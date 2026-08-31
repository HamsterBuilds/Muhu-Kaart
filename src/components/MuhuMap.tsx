import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup, Polyline as LeafletPolyline } from "leaflet";
import { Crosshair } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { MUHU_CENTER, MUHU_OUTLINE, distanceMeters } from "@/lib/muhu";
import {
  cellsForBounds,
  fetchRoadsForCells,
  isCellStale,
  roadBBox,
  segmentDistanceMeters,
  type Cell,
  type CellFetchState,
  type Road,
} from "@/lib/roads";

export type MapPoint = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  lat: number;
  lng: number;
  mine: boolean;
  visited: boolean;
  authorName: string;
};

const SHOPS: { name: string; lat: number; lng: number }[] = [
  { name: "Liiva pood (Coop Konsum)", lat: 58.6058919, lng: 23.2312519 },
  { name: "Hellamaa pood (Coop)", lat: 58.6068581, lng: 23.310735 },
];

const ROAD_COLOR = "#d9453c";
const TRAVELED_COLOR = "#2f9e7f";
const ROAD_HIT_METERS = 25;
const FETCH_MIN_ZOOM = 12;
const MAX_BATCH_CELLS = 30;
const MAX_ROADS = 20000;

type Props = {
  points: MapPoint[];
  tracks: [number, number][][];
  me: { lat: number; lng: number } | null;
  onSelect: (id: string) => void;
};

type GreenRun = {
  start: number;
  end: number;
  coords: [number, number][];
  poly: LeafletPolyline;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export default function MuhuMap({ points, tracks, me, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<{
    roads?: LayerGroup;
    traveled?: LayerGroup;
    points?: LayerGroup;
    tracks?: LayerGroup;
    me?: LayerGroup;
  }>({});
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const roadsRef = useRef(new Map<string, Road>());
  const roadBoxRef = useRef(new Map<string, [number, number, number, number]>());
  const cellStateRef = useRef(new Map<string, CellFetchState>());
  const greenRunsRef = useRef(new Map<string, GreenRun[]>());
  const traveledRef = useRef<[number, number][]>([]);
  const lastFixRef = useRef<[number, number] | null>(null);
  const firstFixDoneRef = useRef(false);
  const interactedRef = useRef(false);
  const fetchingRef = useRef(false);
  const rerunRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processPointRef = useRef<(pt: [number, number]) => void>(() => {});

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    const roadStore = roadsRef.current;
    const roadBoxStore = roadBoxRef.current;
    const greenRunStore = greenRunsRef.current;
    const cellStateStore = cellStateRef.current;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;

      const map = L.map(containerRef.current, {
        center: MUHU_CENTER,
        zoom: 13,
        minZoom: 4,
        maxZoom: 19,
        zoomControl: false,
        preferCanvas: true,
      });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      const roadsLayer = L.layerGroup().addTo(map);
      const traveledLayer = L.layerGroup().addTo(map);
      const tracksLayer = L.layerGroup().addTo(map);
      const pointsLayer = L.layerGroup().addTo(map);
      const meLayer = L.layerGroup().addTo(map);
      layersRef.current = {
        roads: roadsLayer,
        traveled: traveledLayer,
        tracks: tracksLayer,
        points: pointsLayer,
        me: meLayer,
      };
      mapRef.current = map;

      // Teede hankimine (punased) + läbitud lõikude roheliseks märkimine
      const markSegmentGreen = (road: Road, segIdx: number) => {
        const runs = greenRunsRef.current.get(road.id) ?? [];
        for (const run of runs) {
          if (segIdx >= run.start && segIdx <= run.end) return;
          if (segIdx === run.end + 1) {
            run.end = segIdx;
            run.coords.push(road.coords[segIdx + 1]!);
            run.poly.setLatLngs(run.coords);
            return;
          }
          if (segIdx === run.start - 1) {
            run.start = segIdx;
            run.coords.unshift(road.coords[segIdx]!);
            run.poly.setLatLngs(run.coords);
            return;
          }
        }
        const poly = L.polyline([road.coords[segIdx]!, road.coords[segIdx + 1]!], {
          color: TRAVELED_COLOR,
          weight: 6,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(traveledLayer);
        runs.push({
          start: segIdx,
          end: segIdx,
          coords: [road.coords[segIdx]!, road.coords[segIdx + 1]!],
          poly,
        });
        greenRunsRef.current.set(road.id, runs);
      };

      const processPoint = (pt: [number, number]) => {
        for (const [id, box] of roadBoxRef.current) {
          const [minLat, minLng, maxLat, maxLng] = box;
          if (pt[0] < minLat || pt[0] > maxLat || pt[1] < minLng || pt[1] > maxLng) continue;
          const road = roadsRef.current.get(id);
          if (!road) continue;
          for (let i = 0; i < road.coords.length - 1; i++) {
            if (segmentDistanceMeters(pt, road.coords[i]!, road.coords[i + 1]!) < ROAD_HIT_METERS) {
              markSegmentGreen(road, i);
            }
          }
        }
      };
      processPointRef.current = processPoint;

      const addRoads = (roads: Road[]) => {
        for (const road of roads) {
          if (roadsRef.current.has(road.id)) continue;
          roadsRef.current.set(road.id, road);
          roadBoxRef.current.set(road.id, roadBBox(road.coords));
          L.polyline(road.coords, {
            color: ROAD_COLOR,
            weight: 4,
            opacity: 0.85,
            lineCap: "round",
            lineJoin: "round",
          }).addTo(roadsLayer);
        }
        // Tee laaditi võib-olla pärast seda, kui kasutaja juba oli liikunud
        for (const pt of traveledRef.current.slice(-200)) processPoint(pt);
      };

      const runFetch = async () => {
        if (fetchingRef.current) {
          rerunRef.current = true;
          return;
        }
        fetchingRef.current = true;
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        let batch: Cell[] = [];
        try {
          const m = mapRef.current;
          if (m && m.getZoom() >= FETCH_MIN_ZOOM && roadsRef.current.size < MAX_ROADS) {
            const b = m.getBounds().pad(0.15);
            const cells = cellsForBounds({
              south: b.getSouth(),
              west: b.getWest(),
              north: b.getNorth(),
              east: b.getEast(),
            });
            const now = Date.now();
            const missing = cells.filter((c) => isCellStale(cellStateRef.current.get(c.key), now));
            const center = m.getCenter();
            const dist2 = (c: Cell) => {
              const cy = (c.bbox.south + c.bbox.north) / 2;
              const cx = (c.bbox.west + c.bbox.east) / 2;
              return (cy - center.lat) ** 2 + (cx - center.lng) ** 2;
            };
            missing.sort((a, z) => dist2(a) - dist2(z));
            batch = missing.slice(0, MAX_BATCH_CELLS);
            if (batch.length) {
              const roads = await fetchRoadsForCells(batch, ctrl.signal);
              for (const c of batch) cellStateRef.current.set(c.key, { ok: true, ts: Date.now() });
              addRoads(roads);
            }
          }
        } catch {
          if (!ctrl.signal.aborted) {
            for (const c of batch) cellStateRef.current.set(c.key, { ok: false, ts: Date.now() });
          }
        } finally {
          fetchingRef.current = false;
          abortRef.current = null;
          if (rerunRef.current && !ctrl.signal.aborted) {
            rerunRef.current = false;
            void runFetch();
          }
        }
      };

      let fetchTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleFetch = () => {
        if (fetchTimer) clearTimeout(fetchTimer);
        fetchTimer = setTimeout(() => void runFetch(), 600);
        fetchTimerRef.current = fetchTimer;
      };
      map.on("moveend", scheduleFetch);
      map.on("dragstart", () => {
        interactedRef.current = true;
      });
      scheduleFetch();

      // Sünkroniseeri juba saabunud asukohad pärast kaardi valmimist
      for (const pt of traveledRef.current) processPoint(pt);
      if (lastFixRef.current && !interactedRef.current) {
        map.setView(lastFixRef.current, Math.max(map.getZoom(), 15));
      }

      // Leaflet mõõdab konteineri kohe – hoia suurus paigas ka pärast layouti muutust
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(containerRef.current);
      roRef.current = ro;
      setTimeout(() => map.invalidateSize(), 300);
    })();
    return () => {
      cancelled = true;
      processPointRef.current = () => {};
      abortRef.current?.abort();
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
      roRef.current?.disconnect();
      roRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = {};
      roadStore.clear();
      roadBoxStore.clear();
      greenRunStore.clear();
      cellStateStore.clear();
      firstFixDoneRef.current = false;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = layersRef.current.points;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const p of points) {
      const green = p.mine || p.visited;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 9,
        color: green ? "#0f3d33" : "#7a1f1f",
        weight: 3,
        fillColor: green ? "#2f9e7f" : "#d9453c",
        fillOpacity: 0.95,
      });
      marker.bindTooltip(escapeHtml(p.title), { direction: "top" });
      marker.on("click", () => selectRef.current(p.id));
      marker.addTo(layer);
    }
  }, [points]);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = layersRef.current.tracks;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const t of tracks) {
      if (t.length < 2) continue;
      L.polyline(t, {
        color: "#4361ee",
        weight: 6,
        opacity: 0.22,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layer);
      L.polyline(t, {
        color: "#4361ee",
        weight: 2.5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layer);
    }
  }, [tracks]);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = layersRef.current.me;
    if (!L || !layer) return;
    layer.clearLayers();
    if (!me) return;
    L.circleMarker([me.lat, me.lng], {
      radius: 7,
      color: "#ffffff",
      weight: 3,
      fillColor: "#2f6fd0",
      fillOpacity: 1,
    }).addTo(layer);
  }, [me]);

  // Asukoha uuendused: tee lähedal liigumine värvib teelõigud roheliseks
  useEffect(() => {
    if (!me) return;
    const pt: [number, number] = [me.lat, me.lng];
    const map = mapRef.current;
    if (map && !firstFixDoneRef.current) {
      firstFixDoneRef.current = true;
      if (!interactedRef.current) {
        map.setView(pt, Math.max(map.getZoom(), 15));
      }
    }
    const traveled = traveledRef.current;
    if (traveled.length > 3000) traveled.splice(0, traveled.length - 3000);
    const last = lastFixRef.current;
    lastFixRef.current = pt;
    if (last) {
      const d = distanceMeters({ lat: last[0], lng: last[1] }, { lat: pt[0], lng: pt[1] });
      if (d < 3) return;
      if (d <= 60) {
        traveledRef.current.push(pt);
        processPointRef.current(pt);
        return;
      }
      // suur hüpe: interpoleeri sirgjoonel, et vahepealsed teed saaksid roheliseks
      const steps = Math.min(Math.ceil(d / 20), 40);
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        const s: [number, number] = [
          last[0]! + (pt[0]! - last[0]!) * f,
          last[1]! + (pt[1]! - last[1]!) * f,
        ];
        traveledRef.current.push(s);
        processPointRef.current(s);
      }
      return;
    }
    traveledRef.current.push(pt);
    processPointRef.current(pt);
  }, [me]);

  const locateMe = () => {
    const map = mapRef.current;
    const p = lastFixRef.current;
    if (map && p) map.setView(p, Math.max(map.getZoom(), 15));
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <button
        type="button"
        onClick={locateMe}
        aria-label="Kuva minu asukoht"
        className="absolute bottom-28 right-3 z-[600] flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-lg backdrop-blur"
      >
        <Crosshair className="h-5 w-5" />
      </button>
    </div>
  );
}
