import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths so the build works from any static host or sub-path.
  base: "./",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The long simulation tests take ~1.5 s locally but share a small CI runner with ~40 files.
    testTimeout: 20000,
  },
});
