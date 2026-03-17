import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router-dom/") ||
            id.includes("/@tanstack/react-query/")
          ) {
            return "framework";
          }
          if (id.includes("/recharts/") || id.includes("/d3-")) {
            return "charts";
          }
          if (id.includes("/lucide-react/")) {
            return "icons";
          }
          if (
            id.includes("/zustand/") ||
            id.includes("/clsx/") ||
            id.includes("/tailwind-merge/")
          ) {
            return "ui";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
