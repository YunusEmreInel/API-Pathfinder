import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";
import TestDriver from "testdriverai/vitest";

config();

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    testTimeout: 900000,
    hookTimeout: 900000,
    reporters: ["default", TestDriver()],
    setupFiles: ["testdriverai/vitest/setup"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.js"],
  },
});
