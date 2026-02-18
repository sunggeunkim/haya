import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: "packages/core/src/index.ts",
    outDir: "packages/core/dist",
    platform: "node",
    fixedExtension: false,
  },
  {
    entry: "packages/core/src/entry.ts",
    outDir: "packages/core/dist",
    platform: "node",
    fixedExtension: false,
  },
]);
