import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["packages/*/src/**/*.e2e.test.ts", "extensions/*/src/**/*.e2e.test.ts"],
      testTimeout: 60_000,
    },
  }),
);
