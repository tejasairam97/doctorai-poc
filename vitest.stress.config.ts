import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.stress.test.ts"],
    setupFiles: ["./src/test/stress-env.ts"],
    restoreMocks: true,
    // Request parallelism is controlled inside the test to avoid accidental load multiplication.
    pool: "forks",
    fileParallelism: false,
    testTimeout: 180_000
  }
});
