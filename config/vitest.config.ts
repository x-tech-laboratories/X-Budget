// X-App's test preset, with X-Budget's coverage floor, which only rises.

import { defineConfig, mergeConfig } from "vitest/config";
import { vitest_config } from "@x-tech-laboratories/x-app/config/vitest";

export default mergeConfig(
  vitest_config(),
  defineConfig({
    test: {
      coverage: {
        thresholds: {
          autoUpdate: (new_threshold) => Math.floor(new_threshold),
          lines: 88,
          statements: 86,
          functions: 83,
          branches: 71,
        },
      },
    },
  }),
);
