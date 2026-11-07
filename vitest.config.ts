import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const stub = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": stub("./tests/stubs/server-only.ts") },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          env: { APP_ENV: "test", AI_PROVIDER: "mock" },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          fileParallelism: false,
          env: {
            APP_ENV: "test",
            AI_PROVIDER: "mock",
            DATABASE_URL:
              process.env.TEST_DATABASE_URL ??
              "postgresql://postgres:postgres@localhost:5432/aactivated_test?schema=public",
          },
        },
      },
    ],
  },
});
