import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.CMS_DB, env.CMS_MIGRATIONS);
