import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      CMS_MIGRATIONS: D1Migration[];
    }
  }
}
