import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function moduleAt(path, require) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url),"utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,require});
  return exports;
}
const roads = moduleAt("../src/lib/roads.ts",()=>({}));
const {roadGapPath, savedRoadGapPaths} = moduleAt("../src/lib/road-gap.ts",()=>roads);
const bend = {id:"bend",coords:[[0,0],[0,0.0003],[0.0003,0.0003]]};
test("short gap follows road bend, not diagonal shortcut",()=>{
  const path=roadGapPath([bend],[0,0.00001],[0.00029,0.0003]);
  assert.ok(path.length>10);
  assert.ok(path.every(p=>p[0]===0 || Math.abs(p[1]-0.0003)<1e-10));
});
test("reverse travel follows same road",()=>{
  assert.ok(roadGapPath([bend],[0.00029,0.0003],[0,0.00001]).length>10);
});
test("200 metre gap follows an unambiguous mapped road",()=>{
  const road={id:"200m",coords:[[0,0],[0,0.001],[0,0.002]]};
  assert.ok(roadGapPath([road],[0,0],[0,0.0018]).length >= 100);
});
test("parallel plausible roads do not produce guessed coverage",()=>{
  const a={id:"a",coords:[[0,0],[0,0.0005]]};
  const b={id:"b",coords:[[0.00002,0],[0.00002,0.0005]]};
  assert.equal(roadGapPath([a,b],[0.00001,0.0001],[0.00001,0.0004]).length,0);
});
test("different roads and long gaps are not bridged",()=>{
  assert.equal(roadGapPath([bend],[0,0],[0.01,0.01]).length,0);
  assert.equal(roadGapPath([{id:"long",coords:[[0,0],[0,0.01]]}],[0,0],[0,0.005]).length,0);
});

test("duplicate and reversed map sources do not disable gap repair", () => {
  assert.ok(roadGapPath([bend, {id:"duplicate", coords:[...bend.coords].reverse()}], [0,0.00001], [0.00029,0.0003]).length > 10);
});

test("saved green-red-green holes restore along the road regardless of upload order", () => {
  const paths = savedRoadGapPaths(bend, [[0.00029,0.0003], [0,0.00001]]);
  assert.equal(paths.length, 1);
  assert.ok(paths[0].length > 10);
  assert.ok(paths[0].every(p => p[0] === 0 || Math.abs(p[1] - 0.0003) < 1e-10));
  assert.equal(savedRoadGapPaths(bend, [[0,0], [0.01,0.01]]).length, 0);
});

test("walk connectors are traversable but remain excluded from the red car-road layer", () => {
  for (const kind of ["footway", "path", "cycleway", "steps", "pedestrian", "bridleway", "platform", "construction", "unknown"]) {
    assert.equal(roads.isMotorRoad({kind}), false, kind);
    assert.equal(roads.isMotorRoad({highway:kind}), false, kind);
    assert.equal(roads.isTraversableRoad({kind}), ["footway", "path", "cycleway", "steps", "pedestrian"].includes(kind), kind);
  }
  for (const kind of ["primary", "secondary", "residential", "service", "living_street", "track"]) {
    assert.equal(roads.isMotorRoad({kind}), true, kind);
  }
  assert.equal(roads.isMotorRoad({kind:"service", motorcar:"no"}), false);
  assert.equal(roads.isMotorRoad({kind:"primary", rail:true}), false);
});
