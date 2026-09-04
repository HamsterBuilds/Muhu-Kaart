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
  let frame = 0;
  let destroyed = false;
  const render = () => {
    frame = 0;
    if (destroyed) return;
    const size = map.getSize();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.x * ratio;
    canvas.height = size.y * ratio;
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext("2d");
    if (!ctx || map.getZoom() < 15) return;
    ctx.scale(ratio, ratio);
    const depth = Math.min(20, 7 * 2 ** (map.getZoom() - 17));
    const dx = -depth * .65, dy = -depth;
    const rings = [...tiles.values()].flat().map(ring => ring.map(p => map.latLngToContainerPoint(p)))
      .filter(ring => ring.some(p => p.x > -50 && p.x < size.x + 50 && p.y > -50 && p.y < size.y + 50))
      .sort((a, b) => Math.max(...a.map(p => p.y)) - Math.max(...b.map(p => p.y)));
    for (const ring of rings) {
      if (ring.length < 4) continue;
      // Wall faces and a shallow roof lift provide depth without claiming
      // measured heights where the source only supplies footprints.
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!, b = ring[i]!;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x + dx, b.y + dy); ctx.lineTo(a.x + dx, a.y + dy); ctx.closePath();
        ctx.fillStyle = b.x > a.x ? "#172b3b" : "#223b4e"; ctx.fill();
      }
      ctx.beginPath();
      ring.forEach((p, i) => i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy));
      ctx.closePath();
      ctx.shadowColor = "#0008"; ctx.shadowBlur = depth; ctx.shadowOffsetX = depth * .5; ctx.shadowOffsetY = depth * .6;
      ctx.fillStyle = "#314558"; ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.strokeStyle = "#52687b88"; ctx.lineWidth = .7; ctx.stroke();
    }
    if (map.getZoom() >= 17) {
      ctx.font = "11px Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#bbcddd"; ctx.strokeStyle = "#233644"; ctx.lineWidth = 2;
      const seen = new Set<string>();
      for (const tile of addresses.values()) for (const address of tile) {
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
  const schedule = () => { if (!frame && !destroyed) frame = requestAnimationFrame(render); };
  map.on("move zoom resize", schedule);
  return {
    setTile(key: string, rings: Ring[], labels: Address[] = []) { if (!destroyed) { tiles.set(key, rings); addresses.set(key, labels); schedule(); } },
    removeTile(key: string) { tiles.delete(key); addresses.delete(key); schedule(); },
    destroy() { destroyed = true; cancelAnimationFrame(frame); map.off("move zoom resize", schedule); tiles.clear(); addresses.clear(); canvas.remove(); },
  };
}
