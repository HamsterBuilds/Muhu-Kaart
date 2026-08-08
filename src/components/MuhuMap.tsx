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
  authorName: string;
};

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
        bounds: MUHU_BOUNDS,
      }).addTo(map);

      L.polygon(MUHU_OUTLINE, {
        color: "#1f5f4f",
        weight: 2,
        fill: false,
        dashArray: "4 6",
      }).addTo(map);

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
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 9,
        color: p.mine ? "#0f3d33" : "#b4531f",
        weight: 3,
        fillColor: p.mine ? "#2f9e7f" : "#e8863f",
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
