import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "android/app/src/main/java";
const manifestPath = "android/app/src/main/AndroidManifest.xml";
let manifest = readFileSync(manifestPath, "utf8");
if (!manifest.includes("android.permission.REQUEST_INSTALL_PACKAGES")) {
  manifest = manifest.replace("</manifest>", '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n</manifest>');
  writeFileSync(manifestPath, manifest);
}
const destination = join(root, "ee/muhukaart/updater");
mkdirSync(destination, { recursive: true });
copyFileSync("scripts/native/AppUpdaterPlugin.java", join(destination, "AppUpdaterPlugin.java"));
function findActivity(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { const found = findActivity(path); if (found) return found; }
    else if (entry.name === "MainActivity.java") return path;
  }
}
const path = findActivity(root);
if (!path) throw new Error("MainActivity.java missing");
let source = readFileSync(path, "utf8");
if (!source.includes("registerPlugin(ee.muhukaart.updater.AppUpdaterPlugin.class)")) {
  if (source.includes("void onCreate(")) throw new Error("Review existing MainActivity.onCreate before installing updater");
  source = source.replace(/extends BridgeActivity\s*\{/, `extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ee.muhukaart.updater.AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
`);
  if (!source.includes("registerPlugin(ee.muhukaart.updater.AppUpdaterPlugin.class)")) throw new Error("Cannot register updater");
  writeFileSync(path, source);
}
