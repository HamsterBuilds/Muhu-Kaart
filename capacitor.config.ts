import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.muhupunktid",
  appName: "Muhu punktid",
  webDir: ".output/public",
  plugins: {
    Geolocation: {
      permissions: ["location"],
    },
  },
};

export default config;
