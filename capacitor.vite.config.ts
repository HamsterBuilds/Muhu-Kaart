import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Capacitor serves the app from a local file URL, so root-relative asset
  // URLs ("/assets/...") result in a blank screen on Android.
  base: "./",
  plugins: [react(), tsconfigPaths(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { index: "capacitor/index.html" } },
  },
});
