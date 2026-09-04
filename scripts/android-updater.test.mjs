import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("updater survives a freshly generated Android project and repeated setup", () => {
  const fixture = mkdtempSync(join(tmpdir(), "muhu-updater-test-"));
  const main = join(fixture, "android/app/src/main");
  const activity = join(main, "java/ee/muhukaart/app/MainActivity.java");
  mkdirSync(join(main, "java/ee/muhukaart/app"), { recursive: true });
  cpSync(resolve("scripts/native"), join(fixture, "scripts/native"), { recursive: true });
  writeFileSync(join(main, "AndroidManifest.xml"), "<manifest><application /></manifest>");
  writeFileSync(activity, "package ee.muhukaart.app;\nimport com.getcapacitor.BridgeActivity;\npublic class MainActivity extends BridgeActivity {}\n");
  for (let i = 0; i < 2; i++) execFileSync(process.execPath, [resolve("scripts/configure-android-updater.mjs")], { cwd: fixture });
  assert.equal(readFileSync(activity, "utf8").match(/registerPlugin/g).length, 1);
  assert.equal(readFileSync(join(main, "AndroidManifest.xml"), "utf8").match(/REQUEST_INSTALL_PACKAGES/g).length, 1);
  assert.equal(readFileSync(join(main, "java/ee/muhukaart/updater/AppUpdaterPlugin.java"), "utf8"), readFileSync("scripts/native/AppUpdaterPlugin.java", "utf8"));
});
