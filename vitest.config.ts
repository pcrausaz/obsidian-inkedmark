import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Pure modules that the layered architecture exists to keep testable.
      include: [
        "src/model/**/*.ts",
        "src/ink/stroke-builder.ts",
        "src/canvas/viewport.ts",
        "src/canvas/hit-test.ts",
        "src/canvas/spatial-index.ts",
        "src/canvas/zoom.ts",
        "src/input/palm-rejection.ts",
        "src/recognition/text-layer.ts",
        "src/recognition/registry.ts",
        "src/recognition/manual.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
