import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
test("disabled 3D never schedules rendering and releases its canvas",()=>{
  const exports={}; let scheduled=0, cancelled=0;
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/building-depth.ts",import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,requestAnimationFrame:()=>++scheduled,cancelAnimationFrame:()=>cancelled++});
  const canvas={style:{},width:200,height:200,remove(){}};
  const layer=exports.createBuildingDepthLayer({DomUtil:{create:()=>canvas}}, {createPane:()=>({style:{}}),on(){},off(){}});
  layer.setTile("a",[]);
  assert.equal(scheduled,0);
  layer.setEnabled(true);
  assert.equal(scheduled,1);
  layer.setEnabled(false);
  assert.equal(canvas.width,0);
  assert.equal(canvas.height,0);
  layer.setTile("b",[]);
  assert.equal(scheduled,1);
  assert.ok(cancelled>0);
  layer.destroy();
});
