import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(path, require = () => ({})) {
  const exports = {};
  vm.runInNewContext(compile(readFileSync(new URL(path, import.meta.url), "utf8")), { exports, require });
  return exports;
}
const roadsLib = load("../src/lib/roads.ts");
const gaps = load("../src/lib/road-gap.ts", () => roadsLib);
const mapSource = readFileSync(new URL("../src/components/MuhuMap.tsx", import.meta.url), "utf8");
const matching = mapSource.slice(mapSource.indexOf("const processPoint ="), mapSource.indexOf("processPointRef.current = processPoint;"));
const route = { id: "car-road", coords: Array.from({length: 61}, (_, i) => [0, i * 10 / 111320]) };

for (const speed of [5, 30, 90]) {
  test(`GPS replay at ${speed} km/h: sparse fixes and duplicate sources leave no road holes`, () => {
    const geometry = [route, { id: "duplicate-tile", coords: [...route.coords].reverse() }];
    const covered = new Set();
    const context = {
      ROAD_INDEX_DEG: 1, roadHitMetersRef: {current: 8},
      roadSpatialRef: {current: new Map([["0:0", new Set(geometry.map(r => r.id))]])},
      roadBoxRef: {current: new Map(geometry.map(r => [r.id, [-1,-1,1,1]]))},
      roadsRef: {current: new Map(geometry.map(r => [r.id, r]))},
      segmentDistanceMeters: roadsLib.segmentDistanceMeters,
      coverageCallback: {current: (_point, s) => covered.add(Math.round(Math.min(s.aLng, s.bLng) * 111320 / 10))},
    };
    vm.runInNewContext(compile(matching + "globalThis.processPoint = processPoint;"), context);
    let previous;
    for (let metres = 1; metres < 599; metres += speed / 3.6 * 2) {
      // One fix every two seconds; exact road samples exercise actual gap logic.
      const point = [0, metres / 111320];
      context.processPoint(point);
      if (previous) for (const p of gaps.roadGapPath(geometry, previous, point)) context.processPoint(p);
      previous = point;
    }
    for (const p of gaps.roadGapPath(geometry, previous, [0,599/111320])) context.processPoint(p);
    assert.equal(covered.size, 60);
    // Reported 6m drift is accepted on an isolated road with 8m uncertainty.
    covered.clear();
    context.processPoint([6/110540, 5/111320]);
    assert.equal(covered.size, 1);
    assert.ok(covered.has(0));
  });
}

test("roads arriving after an outage restore saved anchors, without inventing a 500m jump", () => {
  const anchors = [1, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 599].map(m => [0,m/111320]);
  const paths = gaps.savedRoadGapPaths(route, anchors.reverse());
  const covered = new Set();
  for (const path of paths) for (const p of path) covered.add(Math.floor(p[1]*111320/10));
  assert.equal(covered.size, 60);
  assert.equal(gaps.roadGapPath([route], [0,0], [0,500/111320]).length, 0);
});

test("a connection drop mid-upload retries 1394 records in Firestore-safe batches", async () => {
  const stored = new Map();
  let commits = 0, failAt = 2;
  const api = load("../src/lib/firebase-data.ts", name => name === "firebase/firestore" ? {
    doc: (_, ...path) => path.join("/"), serverTimestamp: () => 0,
    writeBatch: () => {
      const writes = [];
      return {
        set: (key, value) => writes.push([key,value]),
        update: () => {},
        commit: async () => {
          assert.ok(writes.length <= 499);
          if (++commits === failAt) throw Error("connection interrupted");
          for (const [key,value] of writes) stored.set(key,value);
        },
      };
    },
  } : {});
  const points = Array.from({length:1394}, (_,i) => ({id:String(i),lat:58.6,lng:23.2,t:"2026-09-04T00:00:00Z"}));
  await assert.rejects(api.appendFirebaseTrackPoints("test",points), /connection interrupted/);
  assert.equal(stored.size,499);
  failAt=Infinity;
  await api.appendFirebaseTrackPoints("test",points);
  assert.equal(stored.size,1394);
});

test("reconnect requeues failed roads and redraws tiles without movement", () => {
  const start = mapSource.indexOf("reconnect = () =>");
  const end = mapSource.indexOf('window.addEventListener("online", reconnect)',start);
  let redraws=0, refreshes=0, corridors=0;
  const cells = new Map([["failed",{ok:false}], ["loaded",{ok:true}]]);
  vm.runInNewContext(compile("let reconnect;" + mapSource.slice(start,end) + "reconnect();"), {
    cellStateRef:{current:cells}, redRoadTiles:{redraw:()=>redraws++},
    refreshQueue:()=>refreshes++, corridorFetch:()=>corridors++, lastFixRef:{current:[58.6,23.2]},
  });
  assert.equal(cells.has("failed"),false);
  assert.equal(cells.has("loaded"),true);
  assert.equal(redraws,1);
  assert.equal(refreshes,1);
  assert.equal(corridors,1);
});

test("offline queue survives reload, failed uploads and reconnect without losing local coverage", async () => {
  const storage = new Map();
  const cloud = new Map();
  let online = false;
  function mount() {
    let cursor = 0;
    const slots = [], effects = [], timers = new Set();
    const auth = { currentUser: {uid: "simulation"} };
    const exports = {};
    vm.runInNewContext(compile(readFileSync(new URL("../src/hooks/useRoadCoverage.ts", import.meta.url), "utf8")), {
      exports, Date, console,
      localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v)},
      window: {setInterval: f => {timers.add(f); return f;}, addEventListener: () => {}, removeEventListener: () => {}},
      clearInterval: f => timers.delete(f),
      require: name => {
        if (name === "react") return {
          useState: initial => { const i=cursor++; if (!(i in slots)) slots[i]=initial; return [slots[i], next => {slots[i]=typeof next === "function" ? next(slots[i]) : next;}]; },
          useRef: initial => {const i=cursor++; return slots[i] ??= {current:initial};},
          useCallback: fn => fn,
          useEffect: (fn,deps) => {const i=cursor++; if (!slots[i] || deps.some((d,j) => !Object.is(d, slots[i][j]))) {slots[i]=deps; effects.push(fn);} },
        };
        if (name === "firebase/auth") return {onAuthStateChanged: (_,cb) => {cb(auth.currentUser); return () => {};}};
        if (name === "firebase/firestore") return {doc: () => ({}), serverTimestamp: () => 0, setDoc: async () => {if (!online) throw Error("offline");}};
        if (name === "@/lib/firebase") return {firebaseAuth:auth};
        if (name === "@/lib/firebase-data") return {appendFirebaseTrackPoints: async (_, points) => {if (!online) throw Error("offline"); for (const p of points) cloud.set(p.id,p);}};
        if (name === "sonner") return {toast:{error:()=>{}}};
        return {};
      },
    });
    const render = () => {cursor=0; const hook=exports.useRoadCoverage(); while(effects.length) effects.shift()(); return hook;};
    render();
    const hook = render();
    return {hook, render, tick: async () => {for (const timer of timers) await timer(); await new Promise(resolve => setImmediate(resolve));}};
  }
  let app = mount();
  for (let i=0; i<1394; i++) app.hook.rememberCoverage([58.6+i*0.00005,23.2]);
  await app.tick();
  const snapshot = () => JSON.parse(storage.get("muhu-road-coverage-v1:simulation"));
  assert.equal(Object.keys(snapshot().pending).length,1394);
  assert.equal(cloud.size,0);
  app = mount();
  assert.equal(app.render().localCoverage.length,1394);
  await app.tick();
  assert.equal(Object.keys(snapshot().pending).length,1394);
  online=true;
  await app.tick();
  assert.equal(cloud.size,1394);
  assert.equal(Object.keys(snapshot().pending).length,0);
  assert.equal(Object.keys(snapshot().points).length,1394);
  await app.tick();
  assert.equal(cloud.size,1394);
});
