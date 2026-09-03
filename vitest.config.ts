import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "ui",
          include: ["tests/ui/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["tests/ui/setup.ts"],
        },
      },
    ],
  },
});
