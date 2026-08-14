import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.muhupunktid",
  appName: "Muhu punktid",
  webDir: "dist",
  plugins: {
    FirebaseAuthentication: {
      providers: ["google.com"],
      skipNativeAuth: true,
    },
    Geolocation: {
      permissions: ["location"],
    },
  },
};

export default config;
