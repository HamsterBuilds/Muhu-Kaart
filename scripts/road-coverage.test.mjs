import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

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
          return [value, (next) => { states[index] = next; }];
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
