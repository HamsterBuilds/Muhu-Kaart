import type * as Leaflet from "leaflet";

type Ring = [number, number][];
type Address = { point: [number, number]; text: string };

/** Screen-space building relief from real OSM footprints, below road coverage. */
export function createBuildingDepthLayer(L: typeof Leaflet, map: Leaflet.Map) {
  const pane = map.createPane("building-depth");
  pane.style.zIndex = "350";
  pane.style.pointerEvents = "none";
  const canvas = L.DomUtil.create("canvas", "", pane);
  canvas.style.pointerEvents = "none";
  const tiles = new Map<string, Ring[]>();
  const addresses = new Map<string, Address[]>();
  const woodland = new Map<string, Ring[]>();
  let frame = 0;
  let destroyed = false;
  let enabled = false;
  pane.style.display = "none";
  const render = () => {
    frame = 0;
    if (destroyed || !enabled) return;
    const size = map.getSize();
    const ratio = 1;
    canvas.width = size.x * ratio;
    canvas.height = size.y * ratio;
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext("2d");
    if (!ctx || map.getZoom() < 15) return;
    ctx.scale(ratio, ratio);
    const depth = Math.min(20, 7 * 2 ** (map.getZoom() - 17));
    const dx = -depth * 0.65,
      dy = -depth;
    // A canopy texture styles mapped woodland; it is not individual tree data.
    const texture = document.createElement("canvas");
    texture.width = texture.height = 64;
    const brush = texture.getContext("2d")!;
    brush.fillStyle = "#102c23";
    brush.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 22; i++) {
      const x = (i * 29 + 7) % 64, y = (i * 43 + 11) % 64;
      const radius = 5 + i % 4;
      const shade = brush.createRadialGradient(x - 2, y - 3, 1, x, y, radius);
      shade.addColorStop(0, "#2b5743"); shade.addColorStop(.65, "#1b3e31"); shade.addColorStop(1, "#0a211b");
      brush.fillStyle = shade; brush.beginPath(); brush.arc(x, y, radius, 0, Math.PI * 2); brush.fill();
    }
    const canopy = ctx.createPattern(texture, "repeat");
    if (canopy) {
      const origin = map.containerPointToLayerPoint([0, 0]).add(map.getPixelOrigin());
      canopy.setTransform(new DOMMatrix().translate(-origin.x % 64, -origin.y % 64));
      ctx.fillStyle = canopy;
      for (const tile of woodland.values()) {
        ctx.beginPath();
        for (const ring of tile) {
          ring.forEach((point, i) => { const p = map.latLngToContainerPoint(point); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
          ctx.closePath();
        }
        ctx.fill("evenodd");
      }
    }
    const rings = [...tiles.values()]
      .flat()
      .map((ring) => ring.map((p) => map.latLngToContainerPoint(p)))
      .filter((ring) =>
        ring.some((p) => p.x > -50 && p.x < size.x + 50 && p.y > -50 && p.y < size.y + 50),
      )
      .sort((a, b) => Math.max(...a.map((p) => p.y)) - Math.max(...b.map((p) => p.y)));
    for (const ring of rings) {
      if (ring.length < 4) continue;
      // Wall faces and a shallow roof lift provide depth without claiming
      // measured heights where the source only supplies footprints.
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!,
          b = ring[i]!;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x + dx, b.y + dy);
        ctx.lineTo(a.x + dx, a.y + dy);
        ctx.closePath();
        ctx.fillStyle = b.x > a.x ? "#172b3b" : "#223b4e";
        ctx.fill();
      }
      ctx.beginPath();
      ring.forEach((p, i) => (i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy)));
      ctx.closePath();
      ctx.shadowColor = "#0008";
      ctx.shadowBlur = depth;
      ctx.shadowOffsetX = depth * 0.5;
      ctx.shadowOffsetY = depth * 0.6;
      ctx.fillStyle = "#314558";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = "#52687b88";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    if (map.getZoom() >= 17) {
      ctx.font = "11px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#bbcddd";
      ctx.strokeStyle = "#233644";
      ctx.lineWidth = 2;
      const seen = new Set<string>();
      for (const tile of addresses.values())
        for (const address of tile) {
          const key = `${address.point}:${address.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const p = map.latLngToContainerPoint(address.point);
          if (p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y) continue;
          ctx.strokeText(address.text, p.x + dx, p.y + dy);
          ctx.fillText(address.text, p.x + dx, p.y + dy);
        }
    }
  };
  const schedule = () => {
    if (enabled && !frame && !destroyed) frame = requestAnimationFrame(render);
  };
  // Leaflet moves the existing pane while panning. Rebuild expensive geometry
  // only after the gesture, not on every animation frame.
  map.on("moveend zoomend resize", schedule);
  return {
    setEnabled(value: boolean) {
      enabled = value;
      pane.style.display = value ? "" : "none";
      if (!value) {
        cancelAnimationFrame(frame);
        frame = 0;
        canvas.width = canvas.height = 0;
      } else schedule();
    },
    setWoodland(key: string, rings: Ring[]) { if (!destroyed) { woodland.set(key, rings); schedule(); } },
    setTile(key: string, rings: Ring[], labels: Address[] = []) {
      if (!destroyed) {
        tiles.set(key, rings);
        addresses.set(key, labels);
        schedule();
      }
    },
    removeTile(key: string) {
      tiles.delete(key);
      addresses.delete(key);
      woodland.delete(key);
      schedule();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      map.off("moveend zoomend resize", schedule);
      tiles.clear();
      addresses.clear();
      woodland.clear();
      canvas.remove();
    },
  };
}
