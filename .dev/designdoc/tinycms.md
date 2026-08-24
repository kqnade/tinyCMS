Record schema: context-handoff/v1
Task key: tinycms-design
Repository identity method: git-common-dir hash 700f6c40d45a5ac3eab32b31ff05f419e4cdd4f06e4e6266df0c5db5f02570f1
Repository state key: repository-local:.dev
Resolved workflow state root: /Users/kanato.momose/repos/github.com/kqnade/tinyCMS/.dev
Repository root at write: /Users/kanato.momose/repos/github.com/kqnade/tinyCMS
Source worktree: /Users/kanato.momose/repos/github.com/kqnade/tinyCMS
Source ref: refs/heads/main
Source commit: unborn (no commit exists; git rev-parse --verify HEAD exited 128)
Dirty worktree: no at source snapshot; this export adds only .dev/designdoc/tinycms.md
Created: 2026-08-24T19:00:00+09:00
Updated: 2026-08-24T19:00:00+09:00
Producing client: Codex

# tinyCMS design snapshot

## Status and trust

- **User:** Build a new personal blog and custom CMS independently of https://k4na.de.
- **User:** Lowering the friction required to publish is the primary product outcome.
- **User:** The CMS must be suitable for ordinary daily use, not merely a proof of concept.
- **User:** Adopt the recommended Cloudflare capabilities, AI authoring assistance, hybrid vector search, and email for inbound routing and administrator alerts.
- **User:** Do not implement public comments or public email update subscriptions.
- **User:** No product-code, configuration, infrastructure, dependency, commit, or provisioning changes are authorized until the complete architecture is approved. Only this .dev record is authorized now.
- **Observed:** The repository has no remote, no commits, and no source files.
- **Observed:** The directory was renamed from tinyworld to tinyCMS; the current path above is authoritative.
- **Decision:** This record is an architecture proposal and implementation handoff, not implementation authorization.
- **Unverified:** Production domains, branding, Cloudflare identifiers, and exact Terraform provider coverage are not yet known.

## Product definition

tinyCMS is an edge-native, single-site publishing system with a quiet public reading experience and a capable authoring application.

Public experience:

- typography-first, one-column reading;
- restrained navigation and decoration;
- no ranking, follower graph, social timeline, or engagement pressure;
- semantic HTML that remains readable without JavaScript;
- HTML, Markdown, RSS/Atom, sitemap, embed, and AI-agent representations;
- responsive layout, dark mode, reduced motion, and accessible focus states.

Author experience:

- Cloudflare Access login;
- distraction-free React and Tiptap editor;
- keyboard and Markdown shortcuts;
- drag-and-drop images and reusable media library;
- autosave with explicit save state;
- draft, preview, schedule, publish, archive, trash, restore;
- revisions with comparison and restore;
- tags, excerpt, slug, canonical URL, noindex, cover image, and publish time;
- visible publication and derivative-job state with actionable retries;
- content export sufficient to avoid lock-in;
- explicit, human-reviewed AI assistance.

## Non-goals

- **Decision:** No public comments, comment tables, moderation UI, or compatibility scaffolding.
- **Decision:** No subscriber list, newsletter, bulk email, or public update notification.
- **Decision:** No public user registration or account system.
- **Decision:** No external relational database at launch.
- **Decision:** No automatic AI-authored publication.
- **Decision:** No generative chatbot in the first search release.
- **Decision:** No generic server-side URL scraper.
- **Decision:** No product is adopted solely to increase the Cloudflare product count.

## Architecture

~~~text
Cloudflare DNS + DNSSEC
          |
          +-- WAF / Cache Rules / Response Header Rules
          |
          +-- public.example.com
          |     Public Hono Worker
          |       +-- Static Assets: CSS, JS, icons
          |       +-- R2: HTML, Markdown, media, OG images
          |       +-- KV: publication index and read models
          |       +-- Durable Objects: exact per-post likes
          |       +-- Vectorize: semantic search
          |       +-- D1 FTS5: lexical search
          |       +-- Workers AI: query embeddings and reranking
          |       +-- Analytics Engine: product telemetry
          |
          +-- cms.example.com
                Cloudflare Access
                  |
                  Admin Hono Worker
                    +-- D1: editorial source of truth
                    +-- R2: originals and publication artifacts
                    +-- Queues: fan-out and batch jobs
                    +-- Workflows: durable publication flow
                    +-- Workers AI + AI Gateway: author assistance
                    +-- Browser Rendering: publish-time OG image
                    +-- Email Service: administrator alerts
                    +-- Cron Triggers: schedules, repair, backup

Operations
  +-- Workers Logs and Traces
  +-- Cloudflare Web Analytics
  +-- Images Transformations
  +-- AI Crawl Control
~~~

## Deployment topology

- **Decision:** One monorepo contains two separately deployed Module Workers.
- **Decision:** The public Worker registers only public reading, discovery, search, embed, media, and like routes.
- **Decision:** The admin Worker registers the authoring API, preview, publication orchestration, Queue consumers, scheduled handlers, and administrator notifications.
- **Decision:** The admin hostname is entirely protected by Cloudflare Access.
- **Decision:** Production workers.dev and alternate preview routes must not bypass Access.
- **Decision:** Both Workers may bind shared resources, but public code paths never register admin handlers.
- **Decision:** Static application assets use Workers Static Assets. Mutable published articles are immutable R2 artifacts selected by revision.

## Stack and repository layout

Technology:

- TypeScript strict mode and pnpm workspaces;
- Hono as the HTTP and Module Worker event kernel;
- Hono RPC for the internal typed Studio client;
- React only for the admin Studio;
- Tiptap structured content;
- Valibot through Hono Standard Schema;
- Drizzle for typed D1 access plus explicit SQL migrations;
- Hono JSX as a deterministic publication renderer, not request-time article SSR;
- Vite, Vitest, Cloudflare Workers Vitest pool, and Playwright.

Layout:

~~~text
apps/
  public-worker/
  admin-worker/
  studio/

packages/
  application/
  content/
  contracts/
  database/
  design/
  email/
  observability/
  search/

migrations/d1/
infra/terraform/
tests/e2e/
docs/operations/
~~~

Package boundaries:

- contracts owns route schemas, identifiers, errors, and pagination.
- content owns the Tiptap schema and HTML, Markdown, RSS, and embed renderers.
- application owns use cases and ports without Cloudflare globals.
- database owns D1 schema, repositories, migrations, and FTS5.
- search owns chunking, candidate normalization, RRF, and reranking.
- email owns administrator notifications only.
- design owns public typography and tokens without a public React dependency.

## Shared contracts

- **Decision:** IDs are lowercase UUIDv7 strings.
- **Decision:** API timestamps are RFC 3339 UTC with Z. D1 may store epoch milliseconds for indexed ordering.
- **Decision:** Slugs use lowercase ASCII letters, digits, and hyphens. Japanese-only titles receive a stable generated fallback. Published slug changes create permanent redirects.
- **Decision:** Success responses use an object with data and optional meta fields.
- **Decision:** Errors contain stable code, human message, optional details, and requestId.
- **Decision:** Admin mutations require an expected revision/version. Conflicts return HTTP 409.
- **Decision:** Unbounded lists use cursor pagination.
- **Decision:** Published artifact paths contain immutable post and revision identity.

## D1 editorial model

Required tables:

- authors: Access subject and display metadata;
- posts: identity, slug, lifecycle, active published revision, schedule, canonical and indexing policy;
- post_revisions: immutable title, structured content JSON, excerpt, metadata, author, timestamps;
- tags and post_tags;
- media: R2 identity, filename, media type, size, dimensions, alt text, hash, state;
- redirects;
- publication_jobs: idempotency key, revision, state, attempts, error, timestamps;
- site_settings;
- audit_events;
- search_chunks and FTS5 virtual tables.

Lifecycle:

~~~text
draft -> scheduled -> publishing -> published -> archived
   |          |            |
   +----------+----------> failed
published/archived -> trash -> restored or permanently deleted
~~~

A failed new publication never replaces the prior published revision.

## Structured content

Tiptap JSON is the canonical editable format. The server accepts only a versioned allowlist.

Initial blocks:

- paragraph, heading, ordered and bullet lists;
- blockquote and code block with language;
- image with media ID, caption, and alt text;
- bookmark/link card;
- YouTube, Bluesky, and X;
- callout and horizontal rule.

Rules:

- raw HTML nodes are rejected;
- all text and attributes are escaped or allowlisted;
- embeds use provider allowlists and privacy-conscious placeholders;
- generic server-side metadata scraping is excluded to avoid SSRF;
- each block has deterministic HTML and Markdown output;
- schema versions are migrated explicitly.

## Publication

- **Decision:** Workflows owns the durable multi-step publication state machine.
- **Decision:** Queues owns fan-out, batching, and independently retryable derivative jobs.
- **Decision:** D1 stores an outbox-style publication job so Cron can recover a failed start.
- **Decision:** Every step is idempotent by job and revision.

Sequence:

1. Validate and freeze an immutable revision.
2. Store the requested publication and outbox job in D1.
3. Render complete HTML and Markdown.
4. Write versioned artifacts to R2.
5. Generate OG output and retain a deterministic fallback if Browser Rendering fails.
6. Activate only after mandatory HTML and Markdown exist.
7. Rebuild the coalesced KV publication index.
8. Update D1 FTS5 and Vectorize.
9. Regenerate archive, tag, feed, sitemap, llms, and embed derivatives.
10. Emit analytics and structured logs.
11. Notify the administrator only for terminal or repeatedly failing work.

Search, feed, sitemap, analytics, and enhanced OG failures are visible and retryable but do not remove a readable activated article. Missing mandatory HTML or Markdown blocks activation.

## R2 and media

~~~text
media/
  originals/{mediaId}/{contentHash}
  derivatives/{mediaId}/{variant}

publication/
  posts/{postId}/{revision}/index.html
  posts/{postId}/{revision}/article.md
  posts/{postId}/{revision}/og.png
  indexes/{revision}/archive.json
  exports/{exportId}/...
~~~

- Originals and publication artifacts are immutable.
- Temporary uploads expire and are cleaned by Cron.
- Draft content is never placed behind a public R2 custom domain.
- Images Transformations provides responsive AVIF/WebP output.
- Browser Rendering runs only from publication jobs.
- Upload validation checks size, declared MIME, magic bytes, and dimensions. SVG is rejected initially.

## KV read model

KV is eventually consistent and never authoritative.

The publication-index:v1 value contains active revision, slug, title, excerpt, times, tags, canonical URL, HTML URL, Markdown URL, and OG URL.

Hono derives:

- sitemap.xml;
- feed.xml and atom.xml;
- archive.json;
- llms.txt;
- llms-full.txt pointer;
- tag and discovery responses.

Updates are coalesced because one KV key may be written only once per second. This is near-real-time, not strong real-time; global propagation may take 60 seconds or more. Large llms-full output is generated to R2.

## HTML, Markdown, and AI discovery

Representations:

~~~text
GET /entry/{slug}       Accept: text/html      -> HTML
GET /entry/{slug}       Accept: text/markdown  -> Markdown
GET /entry/{slug}.md                              -> Markdown
~~~

Markdown includes deterministic frontmatter for title, description, author, publish/update time, tags, canonical URL, and content policy.

Required behavior:

- text/markdown UTF-8 content type;
- Vary: Accept;
- representation-specific ETag and internal cache key;
- canonical Link header;
- configured Content-Signal;
- only active published revisions;
- no draft representation.

Discovery:

- robots.txt;
- sitemap.xml;
- llms.txt and llms-full.txt;
- article .md URLs;
- search.md.

Native tinyCMS Markdown is authoritative. Cloudflare Markdown for Agents may be enabled on eligible plans but is not required.

## Hybrid search

- **Decision:** Adopt D1 FTS5 plus Workers AI embeddings and Vectorize.
- **Decision:** FTS5 handles identifiers, code, exact terms, and lexical relevance.
- **Decision:** Vectorize handles semantic similarity.
- **Decision:** Reciprocal Rank Fusion combines ranked candidates.
- **Decision:** Search returns attributable sources and excerpts, not a generated answer.
- **Decision:** Provide HTML, JSON, and Markdown search interfaces.

Index flow:

1. Normalize the published revision to Markdown.
2. Split on heading boundaries at roughly 400-800 tokens.
3. Include title and heading context.
4. Generate embeddings through Workers AI.
5. Upsert IDs as {postId}:{revision}:{chunkIndex}.
6. Store bounded post, revision, slug, title, heading, excerpt, tag, and public metadata.
7. Update FTS5 from the same chunks.
8. Delete the old revision only after the new index succeeds.
9. Never index drafts or previews.

Query flow:

1. Validate and normalize the query.
2. Fetch up to 20 FTS5 candidates.
3. Embed the query and fetch up to 20 Vectorize chunks.
4. Validate candidates against the active public revision.
5. Group chunks by article.
6. Fuse ranks using RRF.
7. Optionally rerank a bounded top set using BGE reranker.
8. Return title, canonical URL, heading, excerpt, and representation links.

Embedding gate:

- **Decision:** Benchmark BGE-M3 against PLaMo Embedding on Japanese, mixed Japanese/English, and code identifiers before creating the immutable production index.
- **Inference:** BGE-M3 is the likely default for mixed-language technical writing.
- **Unverified:** Vector dimension is intentionally open until the benchmark. Use cosine unless the chosen model specifies otherwise.

Vectorize Free includes 5 million stored and 30 million queried vector dimensions. At 1024 dimensions this is roughly 4,800 chunks, about 1,200 four-chunk articles.

## Likes

- **Decision:** Likes have an exact count and reversible per-browser state.
- **Decision:** KV is not authoritative because it lacks atomic increment.
- **Decision:** Use one SQLite-backed Durable Object per article.

The object supports getState, add, and remove using a visitor ID hash. A signed HttpOnly SameSite cookie carries a random visitor identifier. Only a keyed hash is stored. A unique constraint prevents duplicates. Raw IP addresses are not retained.

Cached public counts may be stale, but mutation responses return the exact count. PUT and DELETE endpoints are rate limited. Turnstile is added only in response to abuse evidence.

## AI authoring assistance

Workers AI and AI Gateway are adopted for explicit, reviewed assistance:

- title, excerpt, and tag candidates;
- alt text candidates;
- proofreading without silent application;
- draft summary and structure review;
- deterministic broken-link checks plus AI explanation where useful;
- related published article suggestions via Vectorize;
- preview of the AI-facing Markdown representation.

Rules:

- an author explicitly starts every AI action;
- outputs are candidates separate from canonical content;
- applying a candidate is explicit;
- AI cannot change publication state;
- deterministic CMS functions do not depend on AI availability;
- drafts are not exposed through public routes;
- AI Gateway owns routing, rate limits, observability, and budget controls;
- prompts and responses are retained only according to configured policy;
- embedding and reranking jobs are asynchronous where possible.

## Email

- **Decision:** No public update mailing list, subscriber management, newsletter, or bulk campaign.
- **Decision:** Use Email Routing for contact and administrative addresses.
- **Decision:** Use Email Sending only for administrator transactional alerts: repeated publication failure, backup failure, or security-relevant operational failure.
- **Decision:** Queue sends, deduplicate by incident key, and consume delivered, deferred, bounced, failed, rejected, and complained lifecycle events.
- **Decision:** Never retry terminal suppressions or complaints.

## Security

Admin:

- Access protects the whole admin hostname.
- The Worker verifies Cf-Access-Jwt-Assertion signature, issuer, audience, and expiry.
- Client-supplied identity headers are not trusted independently.
- Access policies allow only explicit identities.
- Write requests require expected origin, JSON content type, and a CSRF-resistant custom header.
- Service tokens are purpose-specific.

Public:

- WAF managed protection and route-specific rate limits;
- Valibot validation and bounded request bodies;
- prepared or typed SQL;
- CSP, HSTS, Referrer-Policy, Permissions-Policy, and X-Content-Type-Options;
- no raw HTML or generic URL fetcher;
- signed like identity;
- logs redact tokens, email, drafts, and secrets.

Bot policy:

- AI Crawl Control, robots, and Content Signals express policy.
- Bot Fight Mode is initially disabled because it may challenge intended AI consumers.
- Abuse is handled by route-specific WAF and application controls.

## Cache

- Versioned assets and derivatives: immutable long cache.
- Article HTML and Markdown: representation-specific cache and ETag.
- Sitemap, feeds, and llms: short cache with safe stale behavior.
- Search: bounded short cache for normalized anonymous queries.
- Like mutations and personalized state: no shared cache.
- Admin, preview, drafts, and Access responses: bypass.
- R2 is the durable publication store; Cache Reserve is excluded.

## Analytics and operations

Web Analytics measures page views and Core Web Vitals, never business state.

Analytics Engine records privacy-conscious:

- article representation views;
- search zero-result rate and lexical/vector contribution;
- like outcomes;
- publication and derivative latency;
- cache class;
- AI action type, latency, and failure without draft content.

Workers Logs and Traces use request ID, operation, duration, outcome, and stable error code. Publication and errors are fully sampled; normal reads are sampled.

Cron handles:

- scheduled publication;
- stranded outbox recovery;
- D1/KV/R2/Vectorize consistency audit;
- expired upload cleanup;
- backup/export generation;
- stale-job cleanup;
- health summaries.

## Visual design

Public:

- approximately 680px maximum reading width;
- one-column archive and article;
- calm neutral palette;
- light and dark modes;
- configurable system sans/serif;
- reduced motion;
- no like count on list pages;
- like appears after the article;
- semantic HTML and accessible contrast;
- readable without JavaScript.

Studio:

- distraction-free mode;
- persistent save state and last-saved time;
- shortcuts and metadata side panel;
- device preview;
- unambiguous draft, publishing, published, and failed state;
- retryable job errors;
- accessible media picker with alt workflow;
- desktop-first full editor with mobile small-edit support.

The design may be inspired by quiet personal publishing but must not copy another service's branding, exact visual design, or proprietary interface.

## Infrastructure ownership

- **Decision:** Wrangler owns Worker bundle deployment, Static Assets, runtime bindings, routes, Cron handlers, Queue consumers, Durable Object migrations, and secrets.
- **Decision:** Terraform owns stable account and zone resources where the pinned provider supports them: DNS, Access, WAF, Cache Rules, response headers, and provisioned data/index/queue resources.
- **Decision:** Terraform does not deploy Worker bundles or D1 schema.
- **Decision:** D1 schema uses Wrangler migrations.
- **Decision:** Environment-specific Wrangler configuration may be generated from Terraform outputs and remains ignored.
- **Decision:** Provider and Wrangler versions are pinned; credentials and state secrets are never committed.
- **Unverified:** Exact provider coverage for Vectorize, Email event subscriptions, Workflows, and all bindings must be checked. Unsupported resources remain Wrangler/API-owned, never double-owned.

## Cost and abuse guardrails

Expected baseline is Workers Paid minimum account billing plus the domain.

- Worker CPU limits;
- no Browser Rendering on reader requests;
- no Workers AI on ordinary reads except search embedding;
- Cache and R2 before D1 for publication artifacts;
- bounded search input and candidate counts;
- Queue/Workflow concurrency limits;
- sampled analytics;
- email deduplication;
- usage dashboards and alerts;
- D1 row-read/write observation;
- explicit quota failure instead of false success.

## Route surface

Public:

~~~text
GET    /
GET    /entry/:slug
GET    /entry/:slug.md
GET    /tags/:tag
GET    /archive
GET    /search
GET    /search.md
GET    /api/v1/search
GET    /api/v1/posts/:slug/like
PUT    /api/v1/posts/:slug/like
DELETE /api/v1/posts/:slug/like
GET    /sitemap.xml
GET    /feed.xml
GET    /atom.xml
GET    /llms.txt
GET    /llms-full.txt
GET    /embed/:slug
GET    /oembed
GET    /robots.txt
~~~

Admin route families exist only in the admin Worker:

~~~text
/api/v1/admin/posts
/api/v1/admin/posts/:id/revisions
/api/v1/admin/posts/:id/preview
/api/v1/admin/posts/:id/publish
/api/v1/admin/media
/api/v1/admin/jobs
/api/v1/admin/search
/api/v1/admin/analytics
/api/v1/admin/ai
/api/v1/admin/settings
/api/v1/admin/export
~~~

## Verification contract

Every executable increment follows List -> Red -> Green -> Refactor.

Required evidence:

- content-schema fixtures and malicious inputs;
- HTML and Markdown golden tests;
- negotiation and representation cache tests;
- empty D1 migration;
- optimistic concurrency conflicts;
- Access JWT and host fence;
- publication idempotency, duplicate delivery, and failure recovery;
- old revision remains public during failed replacement;
- stale KV never exposes drafts;
- Durable Object concurrent likes and eviction recovery;
- Japanese, English technical, and identifier search fixtures;
- unpublished content removed from search;
- AI suggestions cannot mutate canonical content without apply;
- email alert deduplication and terminal suppression;
- media validation and unauthorized access;
- Playwright draft -> preview -> publish -> HTML/Markdown;
- accessibility checks;
- Worker bundle and deployment dry runs.

## Implementation increments after approval

1. Foundation: workspaces, contracts, tests, local bindings.
2. Editorial core: D1, content schema, revisions, renderers.
3. Access security and Studio CRUD/autosave.
4. Media and Images Transformations.
5. Workflows, Queues, outbox, preview, schedule, publication.
6. Public reading and cache.
7. KV discovery, feeds, sitemap, llms, Markdown negotiation.
8. Durable Object likes.
9. FTS5, embedding benchmark, Vectorize, RRF, search representations.
10. Workers AI and AI Gateway authoring assistance.
11. Browser Rendering OG and oEmbed.
12. Email Routing, admin alerts, lifecycle events, Cron, exports.
13. Analytics Engine, Logs/Traces, Web Analytics, Terraform, budgets.
14. Security, accessibility, backup/restore, deployment hardening.

The implementation is large and must be routed into isolated, independently verifiable worktree units only after shared contracts are approved and a base commit exists.

## Git evidence

- **Observed:** git remote -v produced no entries after the rename.
- **Observed:** git status reported an initial main branch with no source changes before export.
- **Observed:** git rev-parse --verify HEAD failed because no commit exists.
- **Observed:** No repository AGENTS.md, active TODO, README, package manifest, application, test, or infrastructure file existed.
- **Observed:** A prior git cc attempt rejected the empty staged set and created no commit or file.
- **Observed:** No implementation or test has run.
- **Decision:** The final managed changed path from this export is .dev/designdoc/tinycms.md.
- **Unverified:** With no source commit, future imports must reconcile this record against current files.

## Resolved contradictions

- tinyworld is stale; tinyCMS is current.
- A minimal CMS target was rejected; daily usable quality is required.
- Public comments were considered and removed.
- KV was considered for exact likes; Durable Objects are authoritative.
- Realtime sitemap means near-real-time KV propagation.
- Native Markdown is authoritative over paid HTML conversion.
- Public email updates were considered and removed.
- Vector-only search was replaced by hybrid FTS5 and Vectorize.

## Open decisions before implementation

1. Public, admin, and optional media hostnames.
2. Site name, wordmark, and initial design tokens.
3. Initial Content Signals policy for ai-train, search, and ai-input.
4. BGE-M3 versus PLaMo benchmark result.
5. Whether public numeric like counts are shown.
6. One-minute or five-minute schedule granularity.
7. Backup destination and retention beyond D1 Time Travel and R2 export.
8. Terraform state backend.
9. Whether contact mail forwards directly or passes through an Email Worker.

## Next action

Review this architecture. Do not create a base commit, scaffold code, provision Cloudflare, install dependencies, or dispatch implementation work until the user explicitly approves the architecture and resolves or delegates the open decisions.

## Primary sources

Retrieved 2026-08-24 unless stated otherwise.

Product:

- https://k4na.de/
- https://mq1.dev/entry/rIhGFBCz3nkO
- https://github.com/chan-mai/mq1-web
- https://static.sizu.me/about

Hono:

- https://hono.dev/docs/getting-started/cloudflare-workers
- https://hono.dev/docs/guides/rpc
- https://hono.dev/docs/guides/validation
- https://hono.dev/docs/guides/testing

Cloudflare:

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/sql-api/sql-statements/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/kv/platform/pricing/
- https://developers.cloudflare.com/kv/concepts/how-kv-works/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/examples/build-a-counter/
- https://developers.cloudflare.com/queues/platform/pricing/
- https://developers.cloudflare.com/workflows/reference/pricing/
- https://developers.cloudflare.com/vectorize/platform/pricing/
- https://developers.cloudflare.com/vectorize/platform/limits/
- https://developers.cloudflare.com/vectorize/reference/metadata-filtering/
- https://developers.cloudflare.com/workers-ai/models/%40cf/baai/bge-m3/
- https://developers.cloudflare.com/workers-ai/models/plamo-embedding-1b/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/ai-gateway/reference/pricing/
- https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/images/pricing/
- https://developers.cloudflare.com/browser-run/pricing/
- https://developers.cloudflare.com/analytics/analytics-engine/
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/email-service/platform/pricing/
- https://developers.cloudflare.com/email-service/platform/limits/
- https://developers.cloudflare.com/queues/event-subscriptions/events-schemas/
