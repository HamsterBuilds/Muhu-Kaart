import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import MuhuMap from "./MuhuMap";
import { cellsForBounds, fetchRoadsForCells, type Road } from "@/lib/roads";
import { distanceMeters } from "@/lib/muhu";

type Segment = { aLat: number; aLng: number; bLat: number; bLng: number };
const key = (s: Segment) => [`${s.aLat.toFixed(7)},${s.aLng.toFixed(7)}`, `${s.bLat.toFixed(7)},${s.bLng.toFixed(7)}`].sort().join(";");
const diagnosticRoad: Road = {
  id: "phone-accuracy-replay",
  coords: [
    [58.55, 23.1],
    [58.55, 23.101],
    [58.55, 23.102],
    [58.55, 23.103],
  ],
};
const diagnosticPath = diagnosticRoad.coords.slice(1).map((point, index) => [
  point[0] + 0.000072,
  (diagnosticRoad.coords[index]![1] + point[1]) / 2,
] as [number, number]);

/** CI-only isolated native replay: never signs in or writes to Firebase. */
export default function CoverageReplay() {
  const native = Capacitor.isNativePlatform();
  const [me, setMe] = useState<{lat:number;lng:number;accuracy:number} | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [status, setStatus] = useState("LOADING_NATIVE_ROADS");
  const saved = useRef(new Map<string, Segment>());
  const remember = useCallback((_point: [number, number], segment: Segment) => {
    const id = key(segment);
    if (saved.current.has(id)) return;
    saved.current.set(id, segment);
    setSegments([...saved.current.values()]);
    console.info(`COVERAGE_REPLAY GREEN ${saved.current.size}`);
  }, []);
  useEffect(() => {
    let stopped = false;
    const abort = new AbortController();
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    void (async () => {
      try {
        let road = diagnosticRoad;
        let path = diagnosticPath;
        if (native) {
          const roads = await fetchRoadsForCells(cellsForBounds({south:59.395,west:24.66,north:59.405,east:24.68}, .02), abort.signal);
          console.info(`COVERAGE_REPLAY NATIVE_ROADS ${roads.length}`);
          const fetchedRoad = roads.find(r => {
            const lengths = r.coords.slice(1).map((p, i) => distanceMeters({lat:p[0],lng:p[1]}, {lat:r.coords[i]![0],lng:r.coords[i]![1]}));
            return r.coords.length >= 4 && r.coords.length <= 15 && lengths.every(n => n < 50) && lengths.reduce((a,b) => a+b,0) > 80;
          });
          if (!fetchedRoad) throw new Error("No replay road found");
          road = fetchedRoad;
          path = road.coords.slice(0, 15);
        }
        const first = path[0]!;
        setMe({lat:first[0],lng:first[1],accuracy:10});
        // Allow the real component's asynchronous map/index setup to finish.
        await sleep(3000);
        const before = saved.current.size;
        setStatus("REPLAYING");
        for (const [lat,lng] of path) {
          if (stopped) return;
          setMe({lat,lng,accuracy:10}); await sleep(1200);
        }
        await sleep(4000);
        const live = saved.current.size > before;
        const covered = saved.current.size - before;
        const expected = native ? 1 : path.length;
        const result = `${live && covered >= expected ? "PASS" : "FAIL"} live=${live} segments=${covered}/${expected} green=${saved.current.size}`;
        setStatus(result); console.info(`COVERAGE_REPLAY ${result}`);
      } catch (error) {
        if (!stopped) { setStatus(String(error)); console.error(`COVERAGE_REPLAY ERROR ${String(error)}`); }
      }
    })();
    return () => { stopped = true; abort.abort(); };
  }, [native]);
  return <div className="map-screen" style={{height:"100dvh"}}>
    <MuhuMap
      points={[]}
      tracks={[]}
      savedSegments={segments}
      me={me}
      tracking={true}
      onSelect={() => {}}
      onCoverage={remember}
      {...(native ? {} : { diagnosticRoads: [diagnosticRoad] })}
    />
    <div style={{position:"absolute",top:10,left:10,right:10,zIndex:2000,padding:12,background:"#102231",color:"white",fontSize:14}}>{status} · green {segments.length}</div>
  </div>;
}
