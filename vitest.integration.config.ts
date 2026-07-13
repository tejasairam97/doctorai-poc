import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./src/test/integration-env.ts"],
    restoreMocks: true,
    pool: "forks",
    fileParallelism: false
  }
});
