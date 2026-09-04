import {test} from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import {readFileSync} from "node:fs";
test("server deletion checks Google identity and explicit confirmation",async()=>{
  const exports={}; let deletions=0;
  let token={email:"other@gmail.com",email_verified:true,firebase:{sign_in_provider:"google.com"}};
  const db={collection:p=>p,recursiveDelete:async p=>{assert.equal(p,"tracks");deletions++;},doc:p=>({set:async()=>assert.equal(p,"tracks/_placeholder")})};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/admin-tracks.server.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,Response,process:{env:{FIREBASE_PROJECT_ID:"test",FIREBASE_SERVICE_ACCOUNT_JSON:"{}"}},
    require:()=>({getApps:()=>[],initializeApp:()=>({}),cert:()=>({}),getAuth:()=>({verifyIdToken:async()=>token}),getFirestore:()=>db}),
  });
  const call=(confirmation="DELETE ALL TRACKS")=>exports.deleteServerTracks(new Request("https://test/api/admin/delete-tracks",{method:"POST",headers:{authorization:"Bearer test"},body:JSON.stringify({confirmation})}));
  assert.equal((await call()).status,403);
  token.email="hamsterbuildsee@gmail.com";token.firebase.sign_in_provider="password";
  assert.equal((await call()).status,403);
  token.firebase.sign_in_provider="google.com";token.email_verified=false;
  assert.equal((await call()).status,403);
  token.email_verified=true;
  assert.equal((await call("wrong")).status,400);
  assert.equal(deletions,0);
  assert.equal((await call()).status,200);
  assert.equal(deletions,1);
});
