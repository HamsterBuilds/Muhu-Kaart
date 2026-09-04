import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("APK obtains road geometry through native HTTP without a localhost server", async () => {
  const exports = {};
  const calls = [];
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/roads.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URLSearchParams, DOMException,
    require: () => ({ Capacitor: { isNativePlatform: () => true }, CapacitorHttp: { post: async (options) => {
      calls.push(options);
      return { status: 200, data: { elements: [{ type: "way", id: 42, tags: { highway: "residential" }, geometry: [{lat:59,lon:24},{lat:59.001,lon:24.001}] }] } };
    } } }),
    fetch: () => { throw new Error("APK must not depend on the web-only proxy"); },
  });
  const roads = await exports.fetchRoadsForCells([{ key: "test", bbox: {south:59,west:24,north:59.01,east:24.01} }]);
  assert.equal(roads.length, 1);
  assert.equal(roads[0].id, "42");
  assert.equal(calls[0].url, "https://overpass-api.de/api/interpreter");
  assert.match(calls[0].data, /data=/);
});

test("native roads fail over after connection and HTTP failures", async () => {
  const exports = {};
  const calls = [];
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/roads.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URLSearchParams, DOMException,
    require: () => ({ Capacitor: { isNativePlatform: () => true }, CapacitorHttp: { post: async ({url}) => {
      calls.push(url);
      if (calls.length === 1) throw new Error("Connection failed");
      if (calls.length === 2) return { status: 503 };
      return { status: 200, data: { elements: [{type:"way", id:42, tags:{highway:"residential"}, geometry:[{lat:59,lon:24},{lat:59.001,lon:24.001}]}] } };
    } } }),
  });
  const roads = await exports.fetchRoadsForCells([{key:"test",bbox:{south:59,west:24,north:59.01,east:24.01}}]);
  assert.equal(roads.length, 1);
  assert.equal(new Set(calls).size, 3);
});

test("live matching marks only the nearest road, not parallel neighbours", () => {
  const mapSource = readFileSync(new URL("../src/components/MuhuMap.tsx", import.meta.url), "utf8");
  const body = mapSource.slice(mapSource.indexOf("const processPoint ="), mapSource.indexOf("processPointRef.current = processPoint;"));
  const marked = [];
  const roads = new Map([
    ["near", {coords:[[0,0],[0,1]]}],
    ["same-road-other-source", {coords:[[0,1],[0,0]]}],
    ["parallel", {coords:[[0.00005,0],[0.00005,1]]}],
  ]);
  const context = {
    ROAD_INDEX_DEG: 1,
    roadSpatialRef:{current:new Map([["0:0",new Set(roads.keys())]])},
    roadBoxRef:{current:new Map([...roads.keys()].map(id=>[id,[-1,-1,1,1]]))},
    roadsRef:{current:roads}, roadHitMetersRef:{current:12},
    segmentDistanceMeters:(pt,a)=>Math.abs(pt[0]-a[0])*111320,
    coverageCallback:{current:(_pt,segment)=>marked.push(segment)},
  };
  vm.runInNewContext(ts.transpileModule(body + "processPoint([0,0.5]);", {
    compilerOptions:{target:ts.ScriptTarget.ES2022},
  }).outputText,context);
  assert.equal(marked.length,1);
  assert.equal(marked[0].aLat,0);
  // A single road 2 m away must also match with a 3 m search radius.
  roads.delete("parallel");
  context.roadHitMetersRef.current = 3;
  marked.length = 0;
  vm.runInNewContext(ts.transpileModule(body + "processPoint([0.000018,0.5]);", {
    compilerOptions:{target:ts.ScriptTarget.ES2022},
  }).outputText,{...context});
  assert.equal(marked.length,1);
});

const source = ts.transpileModule(readFileSync(new URL("../src/hooks/useRoadCoverage.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function mount(storage, uid) {
  const effects = [];
  const states = [];
  const auth = { currentUser: { uid } };
  const exports = {};
  vm.runInNewContext(source, {
    exports, console, Date, localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
    },
    require: (name) => {
      if (name === "react") return {
        useCallback: (fn) => fn,
        useEffect: (fn) => effects.push(fn),
        useRef: (value) => ({ current: value }),
        useState: (value) => {
          const index = states.push(value) - 1;
          return [value, (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
        },
      };
      if (name === "firebase/auth") return { onAuthStateChanged: (_, cb) => { cb(auth.currentUser); return () => {}; } };
      if (name === "@/lib/firebase") return { firebaseAuth: auth };
      if (name === "sonner") return { toast: { error: () => {} } };
      return {};
    },
  });
  const hook = exports.useRoadCoverage();
  effects.forEach((effect) => effect());
  return { hook, states };
}

test("coverage survives reload and duplicate visits keep one upload", () => {
  const storage = new Map();
  const { hook } = mount(storage, "alice");
  hook.rememberCoverage([58.6, 23.2]);
  hook.rememberCoverage([58.6, 23.2]);
  const saved = JSON.parse(storage.get("muhu-road-coverage-v1:alice"));
  assert.equal(Object.keys(saved.points).length, 1);
  assert.equal(Object.keys(saved.pending).length, 1);
  assert.equal(mount(storage, "alice").states[1].length, 1);
  assert.equal(mount(storage, "bob").states[1].length, 0);
});

test("historical raw GPS rebuilds only inside timestamp-bounded trips", () => {
  const raw = [
    ["a",58.6,23.2,"2026-09-04T10:00:00Z",true],
    ["b",58.6001,23.2,"2026-09-04T10:00:10Z",true],
    ["c",58.6002,23.2,"2026-09-04T10:05:00Z",true],
    ["d",58.6003,23.2,"2026-09-04T10:05:10Z",true],
    ["legacy",58.6004,23.2,"2026-09-04T10:05:20Z",false],
  ].map(([id,lat,lng,t,verifiedTime]) => [id,{id,lat,lng,t,verifiedTime}]);
  const storage = new Map([["muhu-road-coverage-v1:alice",JSON.stringify({points:Object.fromEntries(raw),pending:{}})]]);
  const tracks = mount(storage,"alice").states[1];
  assert.equal(JSON.stringify(tracks.map(track => track.length)),"[2,2]");
});

test("a walk connector is green only when confirmed by consecutive movement", () => {
  const mapSource = readFileSync(new URL("../src/components/MuhuMap.tsx", import.meta.url), "utf8");
  const body = mapSource.slice(mapSource.indexOf("const processPoint ="), mapSource.indexOf("processPointRef.current = processPoint;"));
  const marked = [];
  const road = {coords:[[0,0],[0,0.001]], motorRoad:false};
  const context = {
    ROAD_INDEX_DEG:1, roadSpatialRef:{current:new Map([["0:0",new Set(["walk"])]])},
    roadBoxRef:{current:new Map([["walk",[-1,-1,1,1]]])}, roadsRef:{current:new Map([["walk",road]])},
    roadHitMetersRef:{current:8}, segmentDistanceMeters:()=>1,
    coverageCallback:{current:(_pt,segment)=>marked.push(segment)},
  };
  vm.runInNewContext(ts.transpileModule(body + "processPoint([0,0.0002]); processPoint([0,0.0003], true);", {
    compilerOptions:{target:ts.ScriptTarget.ES2022},
  }).outputText, context);
  assert.equal(marked.length,1);
  assert.equal(marked[0].motorRoad,false);
  assert.equal(marked[0].coverageVersion,2);
});

test("one isolated GPS fix cannot color a road", () => {
  const source = readFileSync(new URL("../src/components/MuhuMap.tsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("// Asukoha uuendused"), source.indexOf("}, [me, mapReady]);", source.indexOf("// Asukoha uuendused")));
  assert.doesNotMatch(effect, /processPointRef\.current\((?:pt|last)\)/);
  assert.match(effect, /processPointRef\.current\(s, true\)/);
});

test("new local GPS samples reach coverage replay before cloud sync or reload", () => {
  const { hook, states } = mount(new Map(), "alice");
  hook.rememberCoverage([58.6, 23.2]);
  hook.rememberCoverage([58.6, 23.2]);
  hook.rememberCoverage([58.61, 23.21]);
  assert.equal(states[1].length, 2);
  assert.equal(states[1][1][0][0], 58.61);
});

test("legacy unclassified coverage is retained but only car-road revalidation makes it green", () => {
  const segment = {aLat:58.6, aLng:23.2, bLat:58.601, bLng:23.201};
  const id = "segment_58.6000000_23.2000000_58.6010000_23.2010000";
  const point = {id, lat:58.6, lng:23.2, t:"2026-09-04T00:00:00Z", segment};
  const storage = new Map([["muhu-road-coverage-v1:alice", JSON.stringify({points:{[id]:point},pending:{}})]]);
  const app = mount(storage, "alice");
  assert.equal(app.states[1].length, 0);
  assert.equal(app.states[3].length, 0);
  app.hook.rememberCoverage([58.6,23.2], {...segment, motorRoad:true, traversableRoad:true, coverageVersion:2});
  assert.equal(app.states[3].length, 1);
  const saved = JSON.parse(storage.get("muhu-road-coverage-v1:alice"));
  assert.equal(Object.keys(saved.points).length, 1);
  assert.equal(saved.pending[id].segment.motorRoad, true);
});

test("all 1394 vector features survive missing or repeated optional feature IDs", () => {
  const mapSource = readFileSync(new URL("../src/components/MuhuMap.tsx", import.meta.url), "utf8");
  const statement = mapSource.match(/nearbyRoads\.push\([^\n]+/)[0];
  const nearbyRoads = [];
  for (let i = 0; i < 1394; i++) {
    vm.runInNewContext(statement, {
      nearbyRoads, coords: { z: 14, x: 1, y: 2 }, i,
      feature: { id: i % 2 ? undefined : 42 }, lineIndex: 0, motorRoad: true,
      roadCoords: [[58.6, 23.2], [58.601, 23.201]],
    });
  }
  assert.equal(new Map(nearbyRoads.map(road => [road.id, road])).size, 1394);
});

test("acknowledged local coverage remains visible with an empty upload queue", () => {
  const storage = new Map();
  mount(storage, "alice").hook.rememberCoverage([58.6, 23.2]);
  const saved = JSON.parse(storage.get("muhu-road-coverage-v1:alice"));
  saved.pending = {};
  storage.set("muhu-road-coverage-v1:alice", JSON.stringify(saved));
  assert.equal(mount(storage, "alice").states[1].length, 1);
});

test("road geometry survives reload without GPS or road downloads and reverse visits deduplicate", () => {
  const storage = new Map();
  const segment = { aLat: 58.6, aLng: 23.2, bLat: 58.601, bLng: 23.201, motorRoad: true, traversableRoad: true, coverageVersion: 2 };
  const first = mount(storage, "alice");
  first.hook.rememberCoverage([58.6, 23.2], segment);
  first.hook.rememberCoverage([58.601, 23.201], { aLat: segment.bLat, aLng: segment.bLng, bLat: segment.aLat, bLng: segment.aLng, motorRoad: true, traversableRoad: true, coverageVersion: 2 });
  const restored = mount(storage, "alice");
  assert.equal(restored.states[3].length, 1);
  assert.equal(restored.states[3][0].bLng, 23.201);
  const saved = JSON.parse(storage.get("muhu-road-coverage-v1:alice"));
  assert.equal(Object.keys(saved.pending).length, 1);
  assert.equal(Object.values(saved.pending)[0].segment.aLat, 58.6);
});

test("cloud history uses only owner filter and sorts locally without a composite index", async () => {
  const exports = {};
  let ready = false;
  const queries = [];
  const firestore = {
    collection: (_, ...path) => path.join("/"),
    where: (...args) => ({ where: args }),
    orderBy: (...args) => ({ orderBy: args }),
    query: (path, ...filters) => { const q = { path, filters }; queries.push(q); return q; },
    getDocs: async (q) => {
      assert.ok(ready, "authentication must be restored before querying");
      if (q.path === "tracks") {
        assert.equal(q.filters.length, 1);
        assert.equal(q.filters[0].where[0], "userId");
        assert.equal(q.filters[0].where[2], "alice");
        return { docs: ["2025-01-01", "2026-01-01"].map((date, i) => ({
          id: `track${i}`, data: () => ({ startedAt: { toDate: () => new Date(date) }, coverage: i === 1 }),
        })) };
      }
      return { docs: [{ data: () => ({ lat: 58.6, lng: 23.2 }) }] };
    },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/firebase-data.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Date, console,
    require: (name) => name === "firebase/firestore" ? firestore : name === "@/lib/firebase" ? {
      firebaseAuth: { currentUser: { uid: "alice" }, authStateReady: async () => { ready = true; } },
    } : {},
  });
  const result = await exports.listFirebaseTracks();
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "track1");
  assert.equal(result[0].coverage, true);
  assert.equal(result[0].points[0][0], 58.6);
});

test("10,000 repeat passes after reload do not grow saved road geometry or requeue uploads", () => {
  const storage = new Map();
  const segment = { aLat: 58.6, aLng: 23.2, bLat: 58.601, bLng: 23.201, motorRoad: true, traversableRoad: true, coverageVersion: 2 };
  mount(storage, "alice").hook.rememberCoverage([58.6, 23.2], segment);
  const saved = JSON.parse(storage.get("muhu-road-coverage-v1:alice"));
  saved.pending = {};
  storage.set("muhu-road-coverage-v1:alice", JSON.stringify(saved));
  const before = storage.get("muhu-road-coverage-v1:alice");
  const { hook } = mount(storage, "alice");
  for (let i = 0; i < 10000; i++) {
    hook.rememberCoverage([58.6 + (i % 100) * 0.000001, 23.2], i % 2 ? segment : {
      aLat: segment.bLat, aLng: segment.bLng, bLat: segment.aLat, bLng: segment.aLng,
      motorRoad: true,
      traversableRoad: true, coverageVersion: 2,
    });
  }
  assert.equal(storage.get("muhu-road-coverage-v1:alice"), before);
});

test("tracking saves through deduplicated coverage, not per-trip GPS documents", () => {
  const tracking = readFileSync(new URL("../src/hooks/useMuhu.ts", import.meta.url), "utf8")
    .split("export function useTracking")[1].split("export function usePointActions")[0];
  assert.doesNotMatch(tracking, /startFirebaseTrack|appendFirebaseTrackPoints|randomUUID/);
  assert.match(tracking, /rememberCoverage\(\[lat, lng\]\)/);
});
