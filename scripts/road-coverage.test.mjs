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
      return { status: 200, data: { elements: [{ type: "way", id: 42, geometry: [{lat:59,lon:24},{lat:59.001,lon:24.001}] }] } };
    } } }),
    fetch: () => { throw new Error("APK must not depend on the web-only proxy"); },
  });
  const roads = await exports.fetchRoadsForCells([{ key: "test", bbox: {south:59,west:24,north:59.01,east:24.01} }]);
  assert.equal(roads.length, 1);
  assert.equal(roads[0].id, "42");
  assert.equal(calls[0].url, "https://overpass-api.de/api/interpreter");
  assert.match(calls[0].data, /data=/);
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
  const segment = { aLat: 58.6, aLng: 23.2, bLat: 58.601, bLng: 23.201 };
  const first = mount(storage, "alice");
  first.hook.rememberCoverage([58.6, 23.2], segment);
  first.hook.rememberCoverage([58.601, 23.201], { aLat: segment.bLat, aLng: segment.bLng, bLat: segment.aLat, bLng: segment.aLng });
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
  const segment = { aLat: 58.6, aLng: 23.2, bLat: 58.601, bLng: 23.201 };
  mount(storage, "alice").hook.rememberCoverage([58.6, 23.2], segment);
  const saved = JSON.parse(storage.get("muhu-road-coverage-v1:alice"));
  saved.pending = {};
  storage.set("muhu-road-coverage-v1:alice", JSON.stringify(saved));
  const before = storage.get("muhu-road-coverage-v1:alice");
  const { hook } = mount(storage, "alice");
  for (let i = 0; i < 10000; i++) {
    hook.rememberCoverage([58.6 + (i % 100) * 0.000001, 23.2], i % 2 ? segment : {
      aLat: segment.bLat, aLng: segment.bLng, bLat: segment.aLat, bLng: segment.aLng,
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
