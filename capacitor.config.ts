import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ee.muhukaart.app",
  appName: "Muhu punktid",
  webDir: "dist/capacitor",
  plugins: {
    FirebaseAuthentication: {
      providers: ["google.com"],
    },
    Geolocation: {
      permissions: ["location"],
    },
  },
};

export default config;
