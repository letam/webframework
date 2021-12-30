import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import tsconfigPaths from "vite-tsconfig-paths";

const HMR_PORT = +(process.env.HMR_PORT || "");
const MODE = process.env.MODE || "";

export default defineConfig({
  build: {
    brotliSize: false,
    ...(MODE === "development"
      ? {
          manifest: true,
          rollupOptions: {
            input: "app/src/main.tsx",
          },
        }
      : {}),
  },
  plugins: [
    tsconfigPaths(),
    react(),
    VitePWA({
      // registerType: "autoUpdate",
      includeAssets: [
        // 'favicon.png',
        // 'robots.txt',
        // 'apple-touch-icon.png',
        // 'icons/*.svg',
        "fonts/*.woff2",
      ],
      manifest: {
        name: "wut.sh",
        short_name: "wut.sh",
        theme_color: "#BD34FE",
        icons: [
          {
            src: "/android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
  server: {
    hmr: { ...(HMR_PORT ? { port: HMR_PORT } : {}) },
  },
});
