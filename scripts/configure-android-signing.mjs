import { readFileSync, writeFileSync } from "node:fs";

const buildFile = "android/app/build.gradle";
let source = readFileSync(buildFile, "utf8");

if (!source.includes("muhuReleaseKey")) {
  source = source.replace(
    /android\s*\{\s*/,
    `android {
    signingConfigs {
        muhuReleaseKey {
            storeFile file("../../android-debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
`,
  );
  source = source.replace(
    /buildTypes\s*\{\s*/,
    `buildTypes {
        debug {
            signingConfig signingConfigs.muhuReleaseKey
        }
`,
  );
  writeFileSync(buildFile, source);
}

