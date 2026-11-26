import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/dashboard/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/dashboard/api": {
        target: "http://127.0.0.1:8318",
        changeOrigin: false,
      },
      "/dashboard/assets": {
        target: "http://127.0.0.1:8318",
        changeOrigin: false,
      },
      "/dashboard/panel": {
        target: "http://127.0.0.1:8318",
        changeOrigin: false,
      },
    },
  },
});
