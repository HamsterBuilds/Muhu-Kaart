import { useEffect, useRef, useState } from "react";
import type {
  Map as LeafletMap,
  LayerGroup,
  Polyline as LeafletPolyline,
  Canvas as LeafletCanvas,
} from "leaflet";
import { Crosshair } from "lucide-react";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import "leaflet/dist/leaflet.css";
import { MUHU_CENTER, MUHU_OUTLINE, distanceMeters } from "@/lib/muhu";
import {
  cellsForBounds,
  COARSE_DEG,
  fetchRoadsForCells,
  FINE_DEG,
  gridDeg,
  isCellStale,
  modeForZoom,
  roadBBox,
  segmentDistanceMeters,
  type Cell,
  type CellFetchState,
  type FetchMode,
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
/** Kui lähedal peab tee olema, et lõik läbituks märkida (meetrites). */
const ROAD_HIT_METERS = 2;
const MAX_BATCH_CELLS = 12;
const MAX_WORKERS = 1;
const VIEW_PAD = 0.5;
const ROADS_PER_CHUNK = 300;
const MAX_ROADS = 40000;
const CORRIDOR_TRIGGER_METERS = 120;
const ROAD_INDEX_DEG = 0.01;
const VECTOR_ROAD_TILES = "https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt";

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
  const lineRendererRef = useRef<LeafletCanvas | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [mapReady, setMapReady] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(13);

  const roadsRef = useRef(new Map<string, Road>());
  const roadBoxRef = useRef(new Map<string, [number, number, number, number]>());
  const roadSpatialRef = useRef(new Map<string, Set<string>>());
  const cellStateRef = useRef(new Map<string, CellFetchState>());
  const greenRunsRef = useRef(new Map<string, GreenRun[]>());
  const traveledRef = useRef<[number, number][]>([]);
  const lastFixRef = useRef<[number, number] | null>(null);
  const firstFixDoneRef = useRef(false);
  const interactedRef = useRef(false);
  const workQueueRef = useRef<Cell[]>([]);
  const workersRef = useRef(0);
  const abortAllRef = useRef<AbortController>(new AbortController());
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roadChunkPolysRef = useRef<LeafletPolyline[]>([]);
  const roadWeightRef = useRef(4);
  const corridorRef = useRef<[number, number] | null>(null);
  const corridorFetchRef = useRef<(pt: [number, number]) => void>(() => {});
  const processPointRef = useRef<(pt: [number, number]) => void>(() => {});

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    let sizeTimer: ReturnType<typeof setTimeout> | null = null;
    const roadStore = roadsRef.current;
    const roadBoxStore = roadBoxRef.current;
    const roadSpatialStore = roadSpatialRef.current;
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

      // Ühine canvas-renderdaja polstriga: jooned ei lõigataks vaate äärtel ära
      // ja suur maht renderdatakse sujuvalt ühel lõuendil
      const lineRenderer = L.canvas({ padding: 0.5 });
      lineRendererRef.current = lineRenderer;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      // Punased teed tulevad OSM-i vektorplaatidest, mitte ebakindlast suurest
      // Overpassi päringust. Plaadid laaditakse automaatselt igal liigutamisel.
      const RedRoadTiles = L.GridLayer.extend({
        createTile(coords: { x: number; y: number; z: number }, done: (error?: Error | null, tile?: HTMLCanvasElement) => void) {
          const canvas = document.createElement("canvas");
          const size = 256;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            done(new Error("Lõuendi loomine ebaõnnestus"), canvas);
            return canvas;
          }
          const url = VECTOR_ROAD_TILES
            .replace("{z}", String(coords.z))
            .replace("{x}", String(coords.x))
            .replace("{y}", String(coords.y));
          void fetch(url)
            .then((res) => {
              if (!res.ok) throw new Error(`Road tile HTTP ${res.status}`);
              return res.arrayBuffer();
            })
            .then((data) => {
              const tile = new VectorTile(new PbfReader(new Uint8Array(data)));
              const streets = tile.layers.streets;
              if (streets) {
                ctx.strokeStyle = ROAD_COLOR;
                ctx.globalAlpha = 0.88;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                for (let i = 0; i < streets.length; i++) {
                  const feature = streets.feature(i);
                  if (feature.type !== 2) continue;
                  const kind = String(feature.properties.kind ?? "");
                  ctx.lineWidth = /motorway|trunk|primary/.test(kind) ? 3.5 : /secondary|tertiary/.test(kind) ? 2.6 : 1.8;
                  const scale = size / streets.extent;
                  for (const line of feature.loadGeometry()) {
                    if (!line.length) continue;
                    ctx.beginPath();
                    ctx.moveTo(line[0]!.x * scale, line[0]!.y * scale);
                    for (let j = 1; j < line.length; j++) ctx.lineTo(line[j]!.x * scale, line[j]!.y * scale);
                    ctx.stroke();
                  }
                }
              }
              done(null, canvas);
            })
            .catch((error: unknown) => done(error instanceof Error ? error : new Error("Teede plaat ebaõnnestus"), canvas));
          return canvas;
        },
      });
      new RedRoadTiles({
        tileSize: 256,
        minZoom: 11,
        maxNativeZoom: 14,
        maxZoom: 19,
        opacity: 0.92,
        updateWhenIdle: false,
        keepBuffer: 2,
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
          renderer: lineRenderer,
        }).addTo(traveledLayer);
        runs.push({
          start: segIdx,
          end: segIdx,
          coords: [road.coords[segIdx]!, road.coords[segIdx + 1]!],
          poly,
        });
        greenRunsRef.current.set(road.id, runs);
      };

      const gridKey = (lat: number, lng: number) =>
        `${Math.floor(lat / ROAD_INDEX_DEG)}:${Math.floor(lng / ROAD_INDEX_DEG)}`;

      const processPoint = (pt: [number, number]) => {
        // Kontrolli ainult lähimate ~1 km ruutude teid, mitte kõiki kaardile
        // laaditud teid. See hoiab liikumise sujuvana ka kümnete tuhandete teede korral.
        const candidates = new Set<string>();
        const y = Math.floor(pt[0] / ROAD_INDEX_DEG);
        const x = Math.floor(pt[1] / ROAD_INDEX_DEG);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            for (const id of roadSpatialRef.current.get(`${y + dy}:${x + dx}`) ?? []) candidates.add(id);
          }
        }
        for (const id of candidates) {
          const box = roadBoxRef.current.get(id);
          if (!box) continue;
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

      // Punased teed renderdatakse mitmikpolüjoonide rüpkgudes – ~300 teed ühes
      // lõuendi-kihis, et tuhanded teed ei maksaks tuhandeid renderdusobjekte
      const pendingChunk: [number, number][][] = [];
      const flushChunk = () => {
        if (!pendingChunk.length) return;
        const poly = L.polyline(pendingChunk.slice(), {
          color: ROAD_COLOR,
          weight: roadWeightRef.current,
          opacity: 0.85,
          lineCap: "round",
          lineJoin: "round",
          renderer: lineRenderer,
          interactive: false,
        }).addTo(roadsLayer);
        roadChunkPolysRef.current.push(poly);
        pendingChunk.length = 0;
      };

      const addRoads = (roads: Road[]) => {
        for (const road of roads) {
          if (roadsRef.current.has(road.id)) continue;
          roadsRef.current.set(road.id, road);
          const box = roadBBox(road.coords);
          roadBoxRef.current.set(road.id, box);
          const y0 = Math.floor(box[0] / ROAD_INDEX_DEG);
          const y1 = Math.floor(box[2] / ROAD_INDEX_DEG);
          const x0 = Math.floor(box[1] / ROAD_INDEX_DEG);
          const x1 = Math.floor(box[3] / ROAD_INDEX_DEG);
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const key = gridKey(y * ROAD_INDEX_DEG, x * ROAD_INDEX_DEG);
              const ids = roadSpatialRef.current.get(key) ?? new Set<string>();
              ids.add(road.id);
              roadSpatialRef.current.set(key, ids);
            }
          }
          pendingChunk.push(road.coords);
          if (pendingChunk.length >= ROADS_PER_CHUNK) flushChunk();
        }
        flushChunk();
        // Tee laaditi võib-olla pärast seda, kui kasutaja juba oli liikunud
        for (const pt of traveledRef.current.slice(-200)) processPoint(pt);
      };

      // Joonetihedus sõltub suumist – lähemal on jooned paksemad ja detailsemad
      const applyRoadWidth = () => {
        const z = map.getZoom();
        const w = z >= 17 ? 6 : z >= 15 ? 5 : 4;
        if (w === roadWeightRef.current) return;
        roadWeightRef.current = w;
        for (const poly of roadChunkPolysRef.current) poly.setStyle({ weight: w });
      };
      map.on("zoomend", applyRoadWidth);
      map.on("zoomend", () => setZoomLevel(map.getZoom()));

      /** Tööline: laadib ühe partii lahtrit ja jätkab järgmisega. */
      const worker = async (batch: Cell[]) => {
        const fetchMode: FetchMode = batch[0]!.key.startsWith(`${FINE_DEG}:`) ? "fine" : "coarse";
        try {
          const roads = await fetchRoadsForCells(batch, abortAllRef.current.signal, fetchMode);
          for (const c of batch) cellStateRef.current.set(c.key, { ok: true, ts: Date.now() });
          addRoads(roads);
        } catch {
          if (!abortAllRef.current.signal.aborted) {
            for (const c of batch) cellStateRef.current.set(c.key, { ok: false, ts: Date.now() });
            // Peegel võib olla ajutiselt üle koormatud. Proovi ilma kasutaja
            // kaardiliigutust ootamata uuesti, et kaart ei jääks tühjaks.
            setTimeout(() => {
              if (!abortAllRef.current.signal.aborted) refreshQueue();
            }, 5_100);
          }
        } finally {
          workersRef.current -= 1;
          pump();
        }
      };

      /** Käivitab töölised, kuni järjekorras on partiisid (max 2 paralleelselt). */
      const pump = () => {
        while (workersRef.current < MAX_WORKERS && workQueueRef.current.length > 0) {
          const batch: Cell[] = [];
          const now = Date.now();
          while (batch.length < MAX_BATCH_CELLS && workQueueRef.current.length > 0) {
            const cell = workQueueRef.current.shift()!;
            if (isCellStale(cellStateRef.current.get(cell.key), now)) batch.push(cell);
          }
          if (!batch.length) continue;
          workersRef.current += 1;
          void worker(batch);
        }
      };

      /** Ajakohastab järjekorra: vaate puuduvad lahtrid keskmest välja. */
      const refreshQueue = () => {
        const m = mapRef.current;
        if (!m) return;
        const mode = modeForZoom(m.getZoom());
        if (!mode || roadsRef.current.size >= MAX_ROADS) return;
        const b = m.getBounds().pad(VIEW_PAD);
        const cells = cellsForBounds(
          {
            south: b.getSouth(),
            west: b.getWest(),
            north: b.getNorth(),
            east: b.getEast(),
          },
          gridDeg(mode),
        );
        const now = Date.now();
        const missing = cells.filter((c) => isCellStale(cellStateRef.current.get(c.key), now));
        const center = m.getCenter();
        const dist2 = (c: Cell) => {
          const cy = (c.bbox.south + c.bbox.north) / 2;
          const cx = (c.bbox.west + c.bbox.east) / 2;
          return (cy - center.lat) ** 2 + (cx - center.lng) ** 2;
        };
        missing.sort((a, z) => dist2(a) - dist2(z));
        const known = new Set(missing.map((c) => c.key));
        workQueueRef.current = [
          ...missing,
          ...workQueueRef.current.filter((c) => !known.has(c.key)),
        ];
        pump();
      };

      /** Laadib teed ümber kasutaja asukoha (ka kui vaade on kusagil mujal). */
      const corridorFetch = (pt: [number, number]) => {
        const m = mapRef.current;
        const mode = m ? modeForZoom(m.getZoom()) : "fine";
        if (!mode) return;
        const deg = gridDeg(mode);
        const cells = cellsForBounds(
          {
            south: pt[0] - deg * 1.5,
            west: pt[1] - deg * 3,
            north: pt[0] + deg * 1.5,
            east: pt[1] + deg * 3,
          },
          deg,
        );
        const now = Date.now();
        const missing = cells.filter((c) => isCellStale(cellStateRef.current.get(c.key), now));
        if (!missing.length) return;
        workQueueRef.current = [...missing, ...workQueueRef.current];
        pump();
      };
      corridorFetchRef.current = corridorFetch;

      let fetchTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleFetch = () => {
        if (fetchTimer) clearTimeout(fetchTimer);
        fetchTimer = setTimeout(refreshQueue, 150);
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
      const ro = new ResizeObserver(() => {
        if (mapRef.current === map) map.invalidateSize();
      });
      ro.observe(containerRef.current);
      roRef.current = ro;
      sizeTimer = setTimeout(() => {
        if (mapRef.current === map) map.invalidateSize();
      }, 300);

      // Kaart valmis – sunni punktide/jälgede kihid uuesti renderdama
      setMapReady((n) => n + 1);
    })();
    return () => {
      cancelled = true;
      processPointRef.current = () => {};
      corridorFetchRef.current = () => {};
      abortAllRef.current.abort();
      abortAllRef.current = new AbortController();
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
      workQueueRef.current = [];
      workersRef.current = 0;
      roadChunkPolysRef.current = [];
      roRef.current?.disconnect();
      roRef.current = null;
      if (sizeTimer) clearTimeout(sizeTimer);
      mapRef.current?.remove();
      mapRef.current = null;
      lineRendererRef.current = null;
      layersRef.current = {};
      roadStore.clear();
      roadBoxStore.clear();
      roadSpatialStore.clear();
      greenRunStore.clear();
      cellStateStore.clear();
      firstFixDoneRef.current = false;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = layersRef.current.points;
    const renderer = lineRendererRef.current;
    if (!L || !layer || !renderer) return;
    layer.clearLayers();
    for (const p of points) {
      const green = p.mine || p.visited;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 9,
        color: green ? "#0f3d33" : "#7a1f1f",
        weight: 3,
        fillColor: green ? "#2f9e7f" : "#d9453c",
        fillOpacity: 0.95,
        renderer,
      });
      marker.bindTooltip(escapeHtml(p.title), { direction: "top" });
      marker.on("click", () => selectRef.current(p.id));
      marker.addTo(layer);
    }
  }, [points, mapReady]);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = layersRef.current.tracks;
    const renderer = lineRendererRef.current;
    if (!L || !layer || !renderer) return;
    layer.clearLayers();
    for (const t of tracks) {
      if (t.length < 2) continue;
      L.polyline(t, {
        color: "#4361ee",
        weight: 6,
        opacity: 0.22,
        lineCap: "round",
        lineJoin: "round",
        renderer,
      }).addTo(layer);
      L.polyline(t, {
        color: "#4361ee",
        weight: 2.5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
        renderer,
      }).addTo(layer);
    }
  }, [tracks, mapReady]);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = layersRef.current.me;
    const renderer = lineRendererRef.current;
    if (!L || !layer || !renderer) return;
    layer.clearLayers();
    if (!me) return;
    if (me.accuracy && me.accuracy > 1) {
      L.circle([me.lat, me.lng], {
        radius: me.accuracy,
        color: "#2f6fd0",
        weight: 1,
        opacity: 0.35,
        fillColor: "#2f6fd0",
        fillOpacity: 0.08,
        interactive: false,
        renderer,
      }).addTo(layer);
    }
    L.circleMarker([me.lat, me.lng], {
      radius: 7,
      color: "#ffffff",
      weight: 3,
      fillColor: "#2f6fd0",
      fillOpacity: 1,
      renderer,
    }).addTo(layer);
  }, [me, mapReady]);

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
    // Laadi teed ümber kasutaja asukoha, isegi kui vaade on mujal või äpp taustal
    const lastCorr = corridorRef.current;
    if (
      !lastCorr ||
      distanceMeters({ lat: lastCorr[0], lng: lastCorr[1] }, me) > CORRIDOR_TRIGGER_METERS
    ) {
      corridorRef.current = pt;
      corridorFetchRef.current(pt);
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
      // suur hüpe: interpoleeri sirgjoonel tihedalt, et 2 m raadius tabaks kõik teed
      const steps = Math.min(Math.ceil(d / 8), 80);
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
      {zoomLevel < 11 && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[600] -translate-x-1/2 rounded-full bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow backdrop-blur">
          Suumi lähemale, et teed ilmuksid
        </div>
      )}
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
