import { readFileSync, writeFileSync } from "node:fs";

const service = "node_modules/@capacitor-community/background-geolocation/android/src/main/java/com/equimaps/capacitor_background_geolocation/BackgroundGeolocationService.java";
const manifest = "node_modules/@capacitor-community/background-geolocation/android/src/main/AndroidManifest.xml";

let java = readFileSync(service, "utf8");
const plugin = "node_modules/@capacitor-community/background-geolocation/android/src/main/java/com/equimaps/capacitor_background_geolocation/BackgroundGeolocation.java";
let pluginJava = readFileSync(plugin, "utf8");
pluginJava = pluginJava.replace(
  `                        alias = "location"\n                )\n        }`,
  `                        alias = "location"\n                ),\n                @Permission(\n                        strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION },\n                        alias = "background"\n                )\n        }`,
);
const backgroundMethod = `\n    @PluginMethod()\n    public void requestBackgroundPermission(final PluginCall call) {\n        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {\n            call.resolve();\n            return;\n        }\n        requestPermissionForAlias("background", call, "backgroundPermissionsCallback");\n    }\n\n    @PermissionCallback\n    private void backgroundPermissionsCallback(PluginCall call) {\n        if (getPermissionState("background") == PermissionState.GRANTED) call.resolve();\n        else call.reject("Background location permission was not granted", "NOT_AUTHORIZED");\n    }\n`;
if (!pluginJava.includes("requestBackgroundPermission")) {
  pluginJava = pluginJava.replace("    @PluginMethod()\n    public void removeWatcher", `${backgroundMethod}\n    @PluginMethod()\n    public void removeWatcher`);
}
writeFileSync(plugin, pluginJava);
const oldUnbind = `    public boolean onUnbind(Intent intent) {
        for (Watcher watcher : watchers) {
            watcher.client.removeLocationUpdates(watcher.locationCallback);
        }
        watchers = new HashSet<Watcher>();
        stopSelf();
        return false;
    }`;
const newUnbind = `    public boolean onUnbind(Intent intent) {
        // Keep the foreground location service alive when the WebView activity
        // is closed/swiped away. Tracking stops when the app removes its watcher.
        return true;
    }`;
if (java.includes(oldUnbind)) java = java.replace(oldUnbind, newUnbind);
writeFileSync(service, java);

let xml = readFileSync(manifest, "utf8");
xml = xml.replace(
  'android:foregroundServiceType="location" />',
  'android:foregroundServiceType="location"\n            android:stopWithTask="false" />',
);
writeFileSync(manifest, xml);
