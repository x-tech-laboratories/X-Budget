import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Tests read local dates, so every run uses the same time zone.
process.env.TZ = "UTC";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        autoUpdate: (new_threshold) => Math.floor(new_threshold),
        lines: 0,
        statements: 0,
        functions: 0,
        branches: 0,
      },
    },
  },
});
