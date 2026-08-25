import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrationsPath = new URL("../../migrations/d1", import.meta.url).pathname;
const setupPath = new URL("./test/apply-migrations.ts", import.meta.url).pathname;

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        d1Databases: ["TEST_DB"],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(migrationsPath),
        },
      },
    })),
  ],
  test: {
    setupFiles: [setupPath],
  },
});
