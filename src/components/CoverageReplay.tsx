import { useCallback, useEffect, useRef, useState } from "react";
import MuhuMap from "./MuhuMap";
import { fetchRoadsForCells, cellsForBounds } from "@/lib/roads";
import { distanceMeters } from "@/lib/muhu";

type Segment = { aLat: number; aLng: number; bLat: number; bLng: number };
const key = (s: Segment) => [`${s.aLat.toFixed(7)},${s.aLng.toFixed(7)}`, `${s.bLat.toFixed(7)},${s.bLng.toFixed(7)}`].sort().join(";");

/** CI-only isolated native replay: never signs in or writes to Firebase. */
export default function CoverageReplay() {
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
        const roads = await fetchRoadsForCells(cellsForBounds({south:59.395,west:24.66,north:59.405,east:24.68}, .02), abort.signal);
        console.info(`COVERAGE_REPLAY NATIVE_ROADS ${roads.length}`);
        const road = roads.find(r => {
          const lengths = r.coords.slice(1).map((p, i) => distanceMeters({lat:p[0],lng:p[1]}, {lat:r.coords[i]![0],lng:r.coords[i]![1]}));
          return r.coords.length >= 4 && r.coords.length <= 15 && lengths.every(n => n < 50) && lengths.reduce((a,b) => a+b,0) > 80;
        });
        if (!road) throw new Error("No replay road found");
        const path = road.coords.slice(0, 15);
        const first = path[0]!;
        setMe({lat:first[0],lng:first[1],accuracy:3});
        // Allow the real component's asynchronous tile/index setup to finish.
        await sleep(12000);
        const before = saved.current.size;
        setStatus("REPLAYING");
        for (const [lat,lng] of path) {
          if (stopped) return;
          setMe({lat,lng,accuracy:3}); await sleep(1200);
        }
        await sleep(4000);
        const live = saved.current.size > before;
        const covered = path.slice(1).filter((point, i) => {
          const previous = path[i]!;
          const expected: Segment = {aLat:previous[0],aLng:previous[1],bLat:point[0],bLng:point[1]};
          return saved.current.has(key(expected));
        }).length;
        const result = `${live && covered === path.length - 1 ? "PASS" : "FAIL"} live=${live} segments=${covered}/${path.length - 1} green=${saved.current.size}`;
        setStatus(result); console.info(`COVERAGE_REPLAY ${result}`);
      } catch (error) {
        if (!stopped) { setStatus(String(error)); console.error(`COVERAGE_REPLAY ERROR ${String(error)}`); }
      }
    })();
    return () => { stopped = true; abort.abort(); };
  }, []);
  return <div className="map-screen" style={{height:"100dvh"}}>
    <MuhuMap points={[]} tracks={[]} savedSegments={segments} me={me} onSelect={() => {}} onCoverage={remember}/>
    <div style={{position:"absolute",top:10,left:10,right:10,zIndex:2000,padding:12,background:"#102231",color:"white",fontSize:14}}>{status} · green {segments.length}</div>
  </div>;
}
