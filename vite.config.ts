import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths so the build works from any static host or sub-path.
  base: "./",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
