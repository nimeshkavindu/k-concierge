import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist-relay/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
