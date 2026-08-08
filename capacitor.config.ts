import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.muhupunktid",
  appName: "Muhu punktid",
  webDir: "dist/client",
  server: {
    // Arenduseks: laeb Lovable'i live-preview'd. Eemalda enne poodi minekut.
    url: "https://id-preview--c6110938-cb10-46b3-a92e-9dec94070661.lovable.app",
    cleartext: true,
  },
  plugins: {
    Geolocation: {
      permissions: ["location"],
    },
  },
};

export default config;
