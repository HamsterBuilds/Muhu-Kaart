import { readFileSync, writeFileSync } from "node:fs";

const service = "node_modules/@capacitor-community/background-geolocation/android/src/main/java/com/equimaps/capacitor_background_geolocation/BackgroundGeolocationService.java";
const manifest = "node_modules/@capacitor-community/background-geolocation/android/src/main/AndroidManifest.xml";

let java = readFileSync(service, "utf8");
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
