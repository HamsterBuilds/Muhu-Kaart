import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.muhupunktid",
  appName: "Muhu punktid",
  webDir: "dist/client",
  plugins: {
    Geolocation: {
      permissions: ["location"],
    },
  },
};

export default config;
