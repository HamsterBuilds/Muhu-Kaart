import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import { MUHU_BOUNDS, MUHU_CENTER, MUHU_OUTLINE } from "@/lib/muhu";

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
  { name: "Liiva pood", lat: 58.5909, lng: 23.1526 },
  { name: "Hellamaa pood", lat: 58.6408, lng: 23.1874 },
];

type Props = {
  points: MapPoint[];
  tracks: [number, number][][];
  me: { lat: number; lng: number } | null;
  onSelect: (id: string) => void;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export default function MuhuMap({ points, tracks, me, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<{ points?: LayerGroup; tracks?: LayerGroup; me?: LayerGroup }>(
    {},
  );
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;

      const map = L.map(containerRef.current, {
        center: MUHU_CENTER,
        zoom: 11,
        minZoom: 10,
        maxZoom: 18,
        maxBounds: MUHU_BOUNDS,
        maxBoundsViscosity: 1,
        zoomControl: false,
      });


      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 18,
      }).addTo(map);


      L.polygon(MUHU_OUTLINE, {
        color: "#1f5f4f",
        weight: 2,
        fill: false,
        dashArray: "4 6",
      }).addTo(map);

      for (const shop of SHOPS) {
        L.marker([shop.lat, shop.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="display:flex;align-items:center;gap:4px;transform:translate(-10px,-10px)"><div style="width:20px;height:20px;border-radius:6px;background:#2f4d8f;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px">🛒</div></div>`,
            iconSize: [20, 20],
          }),
          interactive: true,
        })
          .bindTooltip(escapeHtml(shop.name), { direction: "top", permanent: false })
          .addTo(map);
      }

      layersRef.current.tracks = L.layerGroup().addTo(map);
      layersRef.current.points = L.layerGroup().addTo(map);
      layersRef.current.me = L.layerGroup().addTo(map);
      mapRef.current = map;
      map.fitBounds(MUHU_BOUNDS);

      // Leaflet mõõdab konteineri kohe – hoia suurus paigas ka pärast layouti muutust
      const fix = () => {
        map.invalidateSize();
        map.fitBounds(MUHU_BOUNDS);
      };
      requestAnimationFrame(fix);
      setTimeout(fix, 300);
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(containerRef.current);
      roRef.current = ro;
    })();
    return () => {
      cancelled = true;
      roRef.current?.disconnect();
      roRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
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
      L.polyline(t, { color: "#2f6fd0", weight: 4, opacity: 0.6 }).addTo(layer);
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

  return <div ref={containerRef} className="h-full w-full" />;
}
