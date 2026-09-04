import { useEffect, useRef, useState } from "react";
import type {
  Map as LeafletMap,
  LayerGroup,
  Polyline as LeafletPolyline,
  Canvas as LeafletCanvas,
  Coords,
  DoneCallback,
} from "leaflet";
import { Map as MapIcon, Navigation } from "lucide-react";
import { createBuildingDepthLayer } from "@/lib/building-depth";
import { roadGapPath } from "@/lib/road-gap";
import type { CoverageSegment } from "@/hooks/useRoadCoverage";
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
  isMotorRoad,
  isTraversableRoad,
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
const TRAVELED_COLOR = "#16f6a0";
/** The displayed road match remains precise; GPS accuracy can widen candidate lookup. */
const ROAD_HIT_METERS = 3;
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
  me: { lat: number; lng: number; accuracy?: number } | null;
  onSelect: (id: string) => void;
  onCoverage: (pt: [number, number], segment: CoverageSegment) => void;
  savedSegments: CoverageSegment[];
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export default function MuhuMap({ points, tracks, savedSegments, me, onSelect, onCoverage }: Props) {
  const restoredSegmentsRef = useRef(new Map<string, LeafletPolyline>());
  const coverageCallback = useRef(onCoverage);
  coverageCallback.current = onCoverage;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const miniatureRef = useRef<HTMLDivElement | null>(null);
  const [showBuildingDepth, setShowBuildingDepth] = useState(false);
  const depthRef = useRef<ReturnType<typeof createBuildingDepthLayer> | null>(null);
  const [lightMap, setLightMap] = useState(false);
  const lastRoadFixTime = useRef(0);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<{
    roads?: LayerGroup;
    traveled?: LayerGroup;
    points?: LayerGroup;
    me?: LayerGroup;
  }>({});
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const lineRendererRef = useRef<LeafletCanvas | null>(null);
  const coverageRendererRef = useRef<LeafletCanvas | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [mapReady, setMapReady] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(13);

  const roadsRef = useRef(new Map<string, Road>());
  const roadBoxRef = useRef(new Map<string, [number, number, number, number]>());
  const roadSpatialRef = useRef(new Map<string, Set<string>>());
  const cellStateRef = useRef(new Map<string, CellFetchState>());
  const savedCoverageRef = useRef(new Map<string, [number, number]>());
  const restoredViewRef = useRef(false);
  const savedCoverageSpatialRef = useRef(new Map<string, [number, number][]>());
  const lastFixRef = useRef<[number, number] | null>(null);
  const firstFixDoneRef = useRef(false);
  const interactedRef = useRef(false);
  const workQueueRef = useRef<Cell[]>([]);
  const workersRef = useRef(0);
  const abortAllRef = useRef<AbortController>(new AbortController());
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roadChunkPolysRef = useRef<LeafletPolyline[]>([]);
  const roadWeightRef = useRef(6);
  const roadHitMetersRef = useRef(ROAD_HIT_METERS);
  const corridorRef = useRef<[number, number] | null>(null);
  const corridorFetchRef = useRef<(pt: [number, number]) => void>(() => {});
  const processPointRef = useRef<(pt: [number, number], allowConnector?: boolean) => void>(() => {});
  const gapPathRef = useRef<(from: [number, number], to: [number, number]) => [number, number][]>(() => []);
  const rawFixesRef = useRef<[number, number][]>([]);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const vectorRoadSinkRef = useRef<(roads: Road[]) => void>(() => {});
  const vectorRoadRenderRef = useRef<(key: string, lines: [number, number][][]) => void>(() => {});
  const vectorRoadRemoveRef = useRef<(key: string) => void>(() => {});
  const vectorRoadRefreshRef = useRef<() => void>(() => {});
  const lastVectorIndexFixRef = useRef<[number, number] | null>(null);

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    let buildingDepth: ReturnType<typeof createBuildingDepthLayer> | undefined;
    let miniature: LeafletMap | undefined;
    let sizeTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnect: (() => void) | undefined;
    const roadStore = roadsRef.current;
    const roadBoxStore = roadBoxRef.current;
    const roadSpatialStore = roadSpatialRef.current;
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
      buildingDepth = createBuildingDepthLayer(L, map);
      depthRef.current = buildingDepth;
      if (miniatureRef.current) {
        miniature = L.map(miniatureRef.current, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19}).addTo(miniature);
        const syncMiniature = () => miniature?.setView(map.getCenter(), Math.max(3,map.getZoom()-3), {animate:false});
        map.on("moveend", syncMiniature);
        syncMiniature();
      }
      const lineRenderer = L.canvas({ padding: 0.5 });
      lineRendererRef.current = lineRenderer;
      const coveragePane = map.createPane("saved-road-coverage");
      // Always keep visited geometry above every red road source.
      coveragePane.style.zIndex = "700";
      coveragePane.style.pointerEvents = "none";
      coverageRendererRef.current = L.canvas({ pane: "saved-road-coverage", padding: 0.5 });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      // Punased teed tulevad OSM-i vektorplaatidest, mitte ebakindlast suurest
      // Overpassi päringust. Plaadid laaditakse automaatselt igal liigutamisel.
      class RedRoadTiles extends L.GridLayer {
        override createTile(coords: Coords, done: DoneCallback) {
          const canvas = document.createElement("canvas");
          const size = 256;
          canvas.width = size;
          canvas.height = size;
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
              const land = tile.layers["land"];
              if (land) {
                const woods: [number, number][][] = [];
                for (let i = 0; i < land.length; i++) {
                  const feature = land.feature(i);
                  if (feature.type !== 3 || feature.properties["kind"] !== "forest") continue;
                  for (const ring of feature.loadGeometry()) woods.push(ring.map(point => {
                    const p = map.unproject(L.point(coords.x * size + point.x * size / land.extent, coords.y * size + point.y * size / land.extent), coords.z);
                    return [p.lat, p.lng];
                  }));
                }
                buildingDepth?.setWoodland(`${coords.z}:${coords.x}:${coords.y}`, woods);
              }
              const buildings = tile.layers["buildings"];
              if (buildings) {
                const rings: [number, number][][] = [];
                for (let i = 0; i < buildings.length; i++) {
                  const feature = buildings.feature(i);
                  if (feature.type !== 3) continue;
                  for (const ring of feature.loadGeometry()) {
                    rings.push(ring.map(point => {
                      const p = map.unproject(L.point(coords.x * size + point.x * size / buildings.extent, coords.y * size + point.y * size / buildings.extent), coords.z);
                      return [p.lat, p.lng];
                    }));
                  }
                }
                const labels: { point: [number, number]; text: string }[] = [];
                const addresses = tile.layers["addresses"];
                if (addresses) for (let i = 0; i < addresses.length; i++) {
                  const feature = addresses.feature(i);
                  const point = feature.loadGeometry()[0]?.[0];
                  if (!point || !feature.properties["housenumber"]) continue;
                  const p = map.unproject(L.point(coords.x * size + point.x * size / addresses.extent, coords.y * size + point.y * size / addresses.extent), coords.z);
                  labels.push({ point: [p.lat, p.lng], text: String(feature.properties["housenumber"]) });
                }
                buildingDepth?.setTile(`${coords.z}:${coords.x}:${coords.y}`, rings, labels);
              }
              const streets = tile.layers["streets"];
              if (streets) {
                const tileCenter = map.unproject(L.point((coords.x + 0.5) * size, (coords.y + 0.5) * size), coords.z);
                const currentFix = lastFixRef.current;
                const tileNorthWest = map.unproject(L.point(coords.x * size, coords.y * size), coords.z);
                const tileSouthEast = map.unproject(L.point((coords.x + 1) * size, (coords.y + 1) * size), coords.z);
                let hasSavedCoverage = false;
                for (let y = Math.floor(tileSouthEast.lat / ROAD_INDEX_DEG); y <= Math.floor(tileNorthWest.lat / ROAD_INDEX_DEG); y++) {
                  for (let x = Math.floor(tileNorthWest.lng / ROAD_INDEX_DEG); x <= Math.floor(tileSouthEast.lng / ROAD_INDEX_DEG); x++) {
                    if (savedCoverageSpatialRef.current.has(`${y}:${x}`)) hasSavedCoverage = true;
                  }
                }
                // Saved roads must also be indexed on devices without GPS.
                const indexForTracking = hasSavedCoverage || (!!currentFix && distanceMeters(
                  { lat: currentFix[0], lng: currentFix[1] },
                  { lat: tileCenter.lat, lng: tileCenter.lng },
                ) < 2_500);
                const nearbyRoads: Road[] = [];
                const visibleLines: [number, number][][] = [];
                for (let i = 0; i < streets.length; i++) {
                  const feature = streets.feature(i);
                  if (feature.type !== 2) continue;
                  if (!isTraversableRoad(feature.properties)) continue;
                  const motorRoad = isMotorRoad(feature.properties);
                  const scale = size / streets.extent;
                  const geometry = feature.loadGeometry();
                  for (let lineIndex = 0; lineIndex < geometry.length; lineIndex++) {
                    const line = geometry[lineIndex]!;
                    if (!line.length) continue;
                    const roadCoords = line.map((point) => {
                      const latLng = map.unproject(
                        L.point(coords.x * size + point.x * scale, coords.y * size + point.y * scale),
                        coords.z,
                      );
                      return [latLng.lat, latLng.lng] as [number, number];
                    });
                    if (roadCoords.length < 2) continue;
                    if (motorRoad) visibleLines.push(roadCoords);
                    if (
                      indexForTracking &&
                      (hasSavedCoverage || (currentFix && roadCoords.some((point) =>
                        distanceMeters(
                          { lat: currentFix[0], lng: currentFix[1] },
                          { lat: point[0], lng: point[1] },
                        ) < 750,
                      )))
                    ) {
                      // MVT feature IDs are optional (and need not be unique).
                      // The feature's tile-local index always identifies its geometry.
                      nearbyRoads.push({ id: `vt:${coords.z}:${coords.x}:${coords.y}:${i}:${lineIndex}`, coords: roadCoords, motorRoad });
                    }
                  }
                }
                vectorRoadRenderRef.current(`${coords.z}:${coords.x}:${coords.y}`, visibleLines);
                if (nearbyRoads.length) vectorRoadSinkRef.current(nearbyRoads);
              }
              done(undefined, canvas);
            })
            .catch((error: unknown) => {
              console.warn("Road geometry tile could not load", error);
              done(error instanceof Error ? error : new Error("Teede plaat ebaõnnestus"), canvas);
            });
          return canvas;
        }
      }
      const redRoadTiles = new RedRoadTiles({
        tileSize: 256,
        minZoom: 11,
        maxNativeZoom: 14,
        maxZoom: 19,
        opacity: 0,
        updateWhenIdle: false,
        keepBuffer: 0,
        updateWhenZooming: false,
      }).on("tileunload", (event: { coords: { x: number; y: number; z: number } }) => {
        vectorRoadRemoveRef.current(`${event.coords.z}:${event.coords.x}:${event.coords.y}`);
        buildingDepth?.removeTile(`${event.coords.z}:${event.coords.x}:${event.coords.y}`);
      }).addTo(map);
      vectorRoadRefreshRef.current = () => redRoadTiles.redraw();
      // GPS võib jõuda enne Leafleti kaardi initsialiseerimist. Sel juhul tuleb
      // juba nähtavad plaadid uuesti dekodeerida, et nende teed jõuaksid ka
      // rohelise 2 m lähedusindeksisse.
      if (lastFixRef.current) {
        lastVectorIndexFixRef.current = lastFixRef.current;
        redRoadTiles.redraw();
      }

      const roadsLayer = L.layerGroup().addTo(map);
      const traveledLayer = L.layerGroup().addTo(map);
      const pointsLayer = L.layerGroup().addTo(map);
      const meLayer = L.layerGroup().addTo(map);
      layersRef.current = {
        roads: roadsLayer,
        traveled: traveledLayer,
        points: pointsLayer,
        me: meLayer,
      };
      mapRef.current = map;
      const vectorLines = new Map<string, LeafletPolyline>();
      const vectorWeight = () => 6;
      vectorRoadRenderRef.current = (key, lines) => {
        vectorLines.get(key)?.remove();
        if (!lines.length) return;
        const poly = L.polyline(lines, {
          color: ROAD_COLOR,
          weight: vectorWeight(),
          opacity: 0.78,
          lineCap: "round",
          lineJoin: "round",
          renderer: lineRenderer,
          interactive: false,
        }).addTo(roadsLayer);
        vectorLines.set(key, poly);
      };
      vectorRoadRemoveRef.current = (key) => {
        vectorLines.get(key)?.remove();
        vectorLines.delete(key);
      };
      // Teede hankimine (punased) + läbitud lõikude roheliseks märkimine
      const processPoint = (pt: [number, number], allowConnector = false) => {
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
        let nearest: { a: [number, number]; b: [number, number]; motorRoad: boolean } | null = null;
        let nearestDistance = roadHitMetersRef.current;
        let secondDistance = Infinity;
        let nearestRoadId = "";
        const seenSegments = new Set<string>();
        for (const id of candidates) {
          const box = roadBoxRef.current.get(id);
          if (!box) continue;
          const [minLat, minLng, maxLat, maxLng] = box;
          // BBox on ainult kiire eelfilter. Laiendame seda 2 m võrra, sest
          // vastasel juhul jääks täpselt lubatud raadiuse serval olev tee
          // segmendikontrollini jõudmata.
          const hitMeters = roadHitMetersRef.current;
          const latPad = hitMeters / 111_320;
          const lngPad = hitMeters / (111_320 * Math.max(0.1, Math.cos((pt[0] * Math.PI) / 180)));
          if (pt[0] < minLat - latPad || pt[0] > maxLat + latPad || pt[1] < minLng - lngPad || pt[1] > maxLng + lngPad) continue;
          const road = roadsRef.current.get(id);
          if (!road) continue;
          for (let i = 0; i < road.coords.length - 1; i++) {
            const segmentKey = [road.coords[i]!.map(n => n.toFixed(6)).join(","), road.coords[i+1]!.map(n => n.toFixed(6)).join(",")].sort().join(";");
            if (seenSegments.has(segmentKey)) continue;
            seenSegments.add(segmentKey);
            const distance = segmentDistanceMeters(pt, road.coords[i]!, road.coords[i + 1]!);
            if (distance < nearestDistance) {
              if (nearest && id !== nearestRoadId) secondDistance = nearestDistance;
              const a = road.coords[i]!;
              const b = road.coords[i + 1]!;
              nearestDistance = distance;
              nearest = { a, b, motorRoad: road.motorRoad !== false };
              nearestRoadId = id;
            } else if (id !== nearestRoadId && distance < secondDistance) {
              secondDistance = distance;
            }
          }
        }
        // An uncertain fix between neighbouring roads is not proof of a visit.
        if (nearest && (nearest.motorRoad || allowConnector) && nearestDistance <= roadHitMetersRef.current && secondDistance - nearestDistance >= 1.5) {
          const { a, b, motorRoad } = nearest;
          coverageCallback.current(pt, { aLat: a[0], aLng: a[1], bLat: b[0], bLng: b[1], motorRoad, traversableRoad: true, coverageVersion: 2 });
        }
      };
      processPointRef.current = processPoint;
      const roadsNear = (from: [number, number], to: [number, number]) => {
        const ids = new Set<string>();
        for (const point of [from, to]) {
          const y = Math.floor(point[0] / ROAD_INDEX_DEG), x = Math.floor(point[1] / ROAD_INDEX_DEG);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            for (const id of roadSpatialRef.current.get(`${y+dy}:${x+dx}`) ?? []) ids.add(id);
          }
        }
        return [...ids].flatMap(id => roadsRef.current.get(id) ?? []);
      };
      gapPathRef.current = (from, to) => roadGapPath(roadsNear(from, to), from, to, roadHitMetersRef.current);

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

      const addRoads = (roads: Road[], renderRed = true) => {
        const replayCells = new Set<string>();
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
              // y/x are already integer cell indices. A float round-trip can
              // floor into the preceding cell and miss restored coverage.
              const key = `${y}:${x}`;
              // A point within the matching radius can be across a cell edge.
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) replayCells.add(`${y + dy}:${x + dx}`);
              }
              const ids = roadSpatialRef.current.get(key) ?? new Set<string>();
              ids.add(road.id);
              roadSpatialRef.current.set(key, ids);
            }
          }
          if (renderRed && road.motorRoad !== false) {
            pendingChunk.push(road.coords);
            if (pendingChunk.length >= ROADS_PER_CHUNK) flushChunk();
          }
        }
        flushChunk();
        // Tee laaditi võib-olla pärast seda, kui kasutaja juba oli liikunud.
        // Esimene GPS-fix ei pruugi veel rajapunktide massiivis olla, seega
        // kontrollime selle alati eraldi – see värvib kasutaja all oleva tee
        // roheliseks kohe pärast plaadi dekodeerimist.
        const fixes = rawFixesRef.current.slice(-300);
        for (let i = 1; i < fixes.length; i++) {
          for (const pt of gapPathRef.current(fixes[i - 1]!, fixes[i]!)) processPoint(pt, true);
        }
        // Uute teede puhul töötle ainult samas ruudus olevat salvestatud
        // katvust. Nii ei muutu aastatepikkuse ajaloo laadimine aeglaseks.
        for (const key of replayCells) {
          for (const pt of savedCoverageSpatialRef.current.get(key) ?? []) processPoint(pt);
        }
        // Rebuild timestamp-bounded historical trips when their road tiles
        // become available later (initial load, reconnect, or map pan).
        for (const track of tracksRef.current) {
          for (let i = 1; i < track.length; i++) {
            const from = track[i - 1]!, to = track[i]!;
            const fromKey = `${Math.floor(from[0] / ROAD_INDEX_DEG)}:${Math.floor(from[1] / ROAD_INDEX_DEG)}`;
            const toKey = `${Math.floor(to[0] / ROAD_INDEX_DEG)}:${Math.floor(to[1] / ROAD_INDEX_DEG)}`;
            if (!replayCells.has(fromKey) && !replayCells.has(toKey)) continue;
            for (const pt of gapPathRef.current(from, to)) processPoint(pt, true);
          }
        }
      };
      vectorRoadSinkRef.current = (roads) => addRoads(roads, false);
      // Alles nüüd on nii nähtava punase kihi renderdaja kui 2 m rohelise
      // lähedusindeksi vastuvõtja olemas. See on oluline esimesel GPS-fixil.
      redRoadTiles.redraw();

      // Keep all road sources as thick as saved green coverage at every zoom.
      const applyRoadWidth = () => {
        const w = 6;
        if (w === roadWeightRef.current) return;
        roadWeightRef.current = w;
        for (const poly of roadChunkPolysRef.current) poly.setStyle({ weight: w });
        for (const poly of vectorLines.values()) poly.setStyle({ weight: vectorWeight() });
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

      reconnect = () => {
        // Retry failed tiles and road queries without requiring a pan or GPS fix.
        for (const [key, state] of cellStateRef.current) {
          if (!state.ok) cellStateRef.current.delete(key);
        }
        redRoadTiles.redraw();
        refreshQueue();
        if (lastFixRef.current) corridorFetch(lastFixRef.current);
      };
      window.addEventListener("online", reconnect);

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

      if (lastFixRef.current && !interactedRef.current) {
        map.setView(lastFixRef.current, Math.max(map.getZoom(), 17));
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
      if (reconnect) window.removeEventListener("online", reconnect);
      processPointRef.current = () => {};
      gapPathRef.current = () => [];
      corridorFetchRef.current = () => {};
      vectorRoadSinkRef.current = () => {};
      vectorRoadRenderRef.current = () => {};
      vectorRoadRemoveRef.current = () => {};
      vectorRoadRefreshRef.current = () => {};
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
      buildingDepth?.destroy();
      depthRef.current = null;
      miniature?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      lineRendererRef.current = null;
      coverageRendererRef.current = null;
      layersRef.current = {};
      roadStore.clear();
      roadBoxStore.clear();
      roadSpatialStore.clear();
      restoredSegmentsRef.current.clear();
      savedCoverageRef.current.clear();
      savedCoverageSpatialRef.current.clear();
      rawFixesRef.current = [];
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

  // Persisted road geometry renders immediately without waiting for OSM or GPS.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = layersRef.current.traveled;
    const renderer = coverageRendererRef.current;
    if (!L || !layer || !renderer) return;
    for (const s of savedSegments) {
      const key = [`${s.aLat.toFixed(7)}_${s.aLng.toFixed(7)}`, `${s.bLat.toFixed(7)}_${s.bLng.toFixed(7)}`].sort().join("_");
      if (restoredSegmentsRef.current.has(key)) continue;
      const poly = L.polyline([[s.aLat, s.aLng], [s.bLat, s.bLng]], {
        color: lightMap ? "#22a447" : TRAVELED_COLOR, weight: 9, opacity: 1,
        lineCap: "round", lineJoin: "round", renderer,
      }).addTo(layer);
      restoredSegmentsRef.current.set(key, poly);
    }
    for (const poly of restoredSegmentsRef.current.values()) {
      poly.setStyle({ color: lightMap ? "#22a447" : TRAVELED_COLOR });
    }
  }, [savedSegments, mapReady, lightMap]);

  // GPS tracks are coverage input only, never a separate blue route overlay.
  // Both live and saved points color the existing road geometry below.
  // Taasta kogu kasutaja läbitud teede katvus Firestore'ist. Punktid
  // tihendatakse ~5 m ruudustikku, seega sama tee korduv läbimine ei kasvata
  // töömahtu ega tekita kattuvaid rohelisi kihte.
  useEffect(() => {
    const coverage = savedCoverageRef.current;
    const spatial = savedCoverageSpatialRef.current;
    const added: [number, number][] = [];
    let needsRoadIndex = false;
    const addCoveragePoint = (pt: [number, number]) => {
      const latCell = Math.round(pt[0] / 0.000045);
      const lngCell = Math.round(pt[1] / 0.00008);
      const id = `${latCell}:${lngCell}`;
      if (coverage.has(id)) return;
      coverage.set(id, pt);
      added.push(pt);
    };
    for (const track of tracks) {
      for (let index = 0; index < track.length; index++) {
        const current = track[index]!;
        addCoveragePoint(current);
      }
    }
    for (const pt of added) {
      const key = `${Math.floor(pt[0] / ROAD_INDEX_DEG)}:${Math.floor(pt[1] / ROAD_INDEX_DEG)}`;
      if (!spatial.has(key)) needsRoadIndex = true;
      const list = spatial.get(key) ?? [];
      list.push(pt);
      spatial.set(key, list);
    }
    // Rebuild only within timestamp-bounded trips. Never infer between visits.
    for (const track of tracks) {
      for (let i = 1; i < track.length; i++) {
        for (const pt of gapPathRef.current(track[i - 1]!, track[i]!)) processPointRef.current(pt, true);
      }
    }
    // Tiles may have loaded before history arrived and skipped their road index.
    // Re-decode them when new coverage arrives, even after the initial view restore.
    if (mapReady && needsRoadIndex) vectorRoadRefreshRef.current();
    // Without a GPS fix (for example on another desktop), show the restored
    // history instead of leaving the user on the default Muhu view.
    if (mapReady && mapRef.current && coverage.size && !restoredViewRef.current) {
      restoredViewRef.current = true;
      if (!lastFixRef.current && !interactedRef.current) {
        // Old trips can be on different continents. Start with the densest
        // local cluster rather than fitting the entire world into the screen.
        const clusters = new Map<string, [number, number][]>();
        for (const point of coverage.values()) {
          const key = `${Math.floor(point[0] * 10)}:${Math.floor(point[1] * 10)}`;
          const cluster = clusters.get(key) ?? [];
          cluster.push(point);
          clusters.set(key, cluster);
        }
        const largest = [...clusters.values()].sort((a, b) => b.length - a.length)[0]!;
        mapRef.current.fitBounds(largest, { padding: [40, 40], maxZoom: 18 });
        mapRef.current.setZoom(Math.max(17, mapRef.current.getZoom()));
      }
      vectorRoadRefreshRef.current();
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
    // A phone may report a 7–10 m uncertainty even on a road. Snap the
    // resulting green geometry to the exact road segment, but use the current
    // reported uncertainty (capped) to decide which segment it belongs to.
    if (!Number.isFinite(me.lat) || !Number.isFinite(me.lng) || (me.accuracy ?? 0) > 20) {
      lastFixRef.current = null;
      rawFixesRef.current = [];
      lastRoadFixTime.current = 0;
      return;
    }
    const fixTime = Date.now();
    if (fixTime - lastRoadFixTime.current > 180_000) {
      lastFixRef.current = null;
      rawFixesRef.current = [];
    }
    lastRoadFixTime.current = fixTime;
    roadHitMetersRef.current = Math.min(12, Math.max(ROAD_HIT_METERS, me.accuracy ?? ROAD_HIT_METERS));
    const pt: [number, number] = [me.lat, me.lng];
    rawFixesRef.current.push(pt);
    if (rawFixesRef.current.length > 600) rawFixesRef.current.splice(0, rawFixesRef.current.length - 600);
    const map = mapRef.current;
    if (map && !firstFixDoneRef.current) {
      firstFixDoneRef.current = true;
      if (!interactedRef.current) {
        map.setView(pt, Math.max(map.getZoom(), 17));
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
    const last = lastFixRef.current;
    lastFixRef.current = pt;
    const lastIndexed = lastVectorIndexFixRef.current;
    if (
      !lastIndexed ||
      distanceMeters({ lat: lastIndexed[0], lng: lastIndexed[1] }, { lat: pt[0], lng: pt[1] }) > 250
    ) {
      lastVectorIndexFixRef.current = pt;
      vectorRoadRefreshRef.current();
    }
    if (last) {
      const d = distanceMeters({ lat: last[0], lng: last[1] }, { lat: pt[0], lng: pt[1] });
      if (d < 3) {
        // Üksik GPS-fiks ei tõesta tee läbimist. Kinnita see ainult siis, kui
        // kaks järjestikust fikksi sobivad samale kaarditeele.
        for (const s of gapPathRef.current(last, pt)) processPointRef.current(s, true);
        return;
      }
      if (d > 250) {
        // A location jump is not evidence that the straight line was walked.
        return;
      }
      // Only bridge a short gap along one unambiguous mapped road. Never
      // interpolate a straight chord through side streets or parallel roads.
      for (const s of gapPathRef.current(last, pt)) {
        processPointRef.current(s, true);
      }
      return;
    }
  }, [me, mapReady]);

  useEffect(() => {
    depthRef.current?.setEnabled(showBuildingDepth && !lightMap);
  }, [showBuildingDepth, lightMap, mapReady]);

  const locateMe = () => {
    const map = mapRef.current;
    const p = lastFixRef.current;
    if (map && p) map.setView(p, Math.max(map.getZoom(), 17));
  };

  return (
    <div className={`relative h-full w-full ${lightMap ? "map-light" : ""}`}>
      <div ref={containerRef} className="h-full w-full" />
      {zoomLevel < 11 && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[600] -translate-x-1/2 rounded-full bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow backdrop-blur">
          Suumi lähemale, et teed ilmuksid
        </div>
      )}
      <div className="map-right-tools">
        <div className="map-view-controls">
          <button type="button" aria-label="Hoonete ruumiline vaade" aria-pressed={showBuildingDepth} onClick={() => {
            const next = !showBuildingDepth;
            setShowBuildingDepth(next);
          }}><MapIcon /></button>
          <button type="button" aria-label="Kuva minu asukoht" onClick={locateMe}><Navigation /></button>
        </div>
        <button type="button" className="map-mini-preview" aria-label={lightMap ? "Lülita tume kaart" : "Lülita hele kaart"} aria-pressed={lightMap} onClick={() => {
          setLightMap(!lightMap);
        }}><div ref={miniatureRef} /></button>
      </div>
    </div>
  );
}
