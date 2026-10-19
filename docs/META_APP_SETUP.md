# Phase 03 — Meta App / shared gateway setup

> Phase 06 supersedes the legacy desktop bearer-login instructions below. Use the employee bootstrap and Windows login workflow in `D:\cvvui\PVH Omnichannel Manager\docs\PHASE-06-MULTIAGENT.md`. Legacy credentials remain server-side compatibility tooling, not desktop employee sessions.

Implemented inside the existing Windows app, not a second administration website. Callback responses are plain text; the UI remains in PVH. No browser automation, webview login, password collection or localhost production webhook.

## Prerequisites / current blocker

Live verification is **BLOCKED** until an operator supplies a Meta App ID/Secret, eligible owned test Page and person, public HTTPS Worker, D1 database and the necessary Meta access/review. Code and local tests do not constitute Meta approval. Do not populate production Connected status manually.

Graph API is pinned to **v26.0**, confirmed against Meta's changelog on 2026-10-18 (released 2026-07-29). Version changes require a deliberate code/review/test update.

## Cloudflare deployment

Run from `D:\cvvui\PVH Omnichannel Manager`:

```powershell
pnpm --filter @pvh/gateway exec wrangler login
pnpm --filter @pvh/gateway exec wrangler d1 create pvh-omnichannel
```

Replace the all-zero **non-deployable** database ID in `D:\cvvui\PVH Omnichannel Manager\apps\gateway\wrangler.jsonc` with the returned real ID. It is deliberately not a fabricated cloud resource. Add `vars.PUBLIC_ORIGIN` (exact HTTPS origin, no trailing slash/path) and `vars.META_APP_ID` using your real values. No user-controlled redirect URI is accepted.

```powershell
pnpm --filter @pvh/gateway exec wrangler secret put META_APP_SECRET
pnpm --filter @pvh/gateway exec wrangler secret put META_VERIFY_TOKEN
pnpm --filter @pvh/gateway exec wrangler secret put TOKEN_ENCRYPTION_KEY
pnpm --filter @pvh/gateway db:remote
pnpm --filter @pvh/gateway deploy
```

`TOKEN_ENCRYPTION_KEY` is a securely generated **32-byte base64** AES key. Generate locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`, then enter it via secret put. Back it up securely; losing/changing it without re-encrypting existing tokens requires reconnect. Never commit real keys or `.dev.vars`. Token envelopes are AES-256-GCM with fresh 96-bit IV and organization/Page associated data. Old keys need an operator-controlled decrypt/re-encrypt migration; automatic key rotation is not implemented.

Wrangler local development can use `.dev.vars` (ignored) and `db:local`; **desktop deliberately only accepts HTTPS gateways**. A local Wrangler endpoint is for tests, not a production Meta webhook. Cron runs each minute for persisted event processing, bounded backoff/dead-letter handling, OAuth cleanup and interrupted sends.

## Verified employee authentication

Phase 01 had no remote employee login. Phase 03 supplies a minimal operator-provisioned, revocable credential per verified employee, not an SSO/employee management website. An authorized operator verifies employee identity and issues an expiring credential:

```powershell
pnpm --filter @pvh/gateway exec node scripts/provision-credential.mjs org-pvh employee-verified-001 admin 30 --remote
```

Use role `agent` for staff who may read/reply/check but must not connect/disconnect/replay. The script inserts **only SHA-256 of a random 256-bit bearer** into D1, then shows the bearer once. Never share credentials across employees; agent attribution is to the authenticated credential holder, not biometric proof of who used an unlocked Windows session. Revoke using D1 `UPDATE gateway_credentials SET revoked=1 WHERE token_hash=...`; expiry uses epoch milliseconds. There is no unauthenticated provisioning endpoint.

Launch the existing desktop with `PVH_GATEWAY_URL` (exact deployed HTTPS origin) and `PVH_GATEWAY_CREDENTIAL` configured in the main process environment. Do not use a `VITE_` variable, renderer setting, command-line flag or committed file. The app does not persist this credential to disk. Production distribution should inject it through an approved per-user secret-management/login mechanism; complete employee SSO/RBAC remains future work. Tenant/employee IDs are never accepted from renderer send requests.

## Meta App dashboard

1. Configure the Messenger/Facebook Page business messaging use case supported by your app type. Add Facebook Login as required by the chosen use case; validate its eligibility in the real dashboard.
2. Exact Valid OAuth Redirect URI: your gateway origin + `/meta/callback`. Enable strict redirect URI matching and HTTPS. No return URL, deep link redirect or arbitrary callback is accepted by this gateway.
3. Request only `pages_show_list,pages_messaging,pages_manage_metadata`; see `D:\cvvui\PVH Omnichannel Manager\docs\META_PERMISSIONS.md`.
4. Set Page webhook callback to gateway origin + `/meta/webhook`; verify token must equal the gateway secret. Subscribe the application product to `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads` in Meta Dashboard. Page subscription is configured after selection and checked with Graph.
5. Development mode: use consenting app-role users and eligible Pages. For non-role customers, obtain applicable Advanced Access/App Review and business verification. Publish privacy policy/data deletion instructions and implement operational deletion handling before public rollout. This phase does **not** implement Meta signed-request deauthorization/data-deletion callbacks; do not claim public app compliance complete.
6. From PVH > Settings > Facebook Fanpage, Connect opens only official `www.facebook.com/.../dialog/oauth` via `shell.openExternal`. Confirm permissions in the system browser, return to PVH, select an authorized Page.

## Security and operations

- OAuth state: random 256 bits, hashed in D1, 5-minute TTL, atomic one-time claim; bound to org/user. Poll/select require the same admin. Denial/missing permissions creates an error, not Connected. Candidate tokens are encrypted, expire with transaction and are removed on selection/expiry.
- Page token inspection checks app ID, expiry/data-access expiry, scopes and granular target restrictions. Identity must equal selected Page; subscription must include the configured fields. No Connected from OAuth callback alone. Snapshot changes stale Connected to CHECK_REQUIRED after five minutes; sends recheck Graph and 24h window.
- A Page is assigned to one organization globally to avoid cross-tenant fanout. Transfers require an audited operator migration; disconnection is not automatic reassignment. Organization members share that organization's Pages; per-Page employee ACL is not implemented.
- Webhook: 256 KiB streaming limit; raw-body HMAC SHA-256; native Workers timing-safe comparison of fixed-length digests (native Web Crypto verification fallback in Node fixtures). Unknown/unassigned Pages and mismatched Page/sender/recipient are ignored. ACK only after D1 persistence, no Graph calls in webhook path. DB failure yields non-200 for Meta retry. Events are idempotent by Page + Meta message ID; receipts use normalized digest.
- Processing is idempotent, retries 5 times with bounded exponential backoff then DEAD. Authenticated admin may POST `/api/facebook/events/{event-key}/replay` only for own DEAD events; it never retries outbound sends. Cron and immediate `waitUntil` processing can overlap safely via database uniqueness/monotonic updates.
- Send request IDs are durably claimed globally; conflicting tenant/Page/employee/content is rejected. No blind retry after network ambiguity. Interrupted SENDING becomes UNKNOWN after a minute. ACCEPTED requires Meta message ID/recipient, never means DELIVERED. Delivery/read updates are monotonic and survive receipts arriving before echo.
- Graph code/subcode/fbtrace_id are retained; raw upstream error messages/bodies are not logged because they may leak credentials. No Page token goes to preload/renderer. D1 messages/event payloads are **not application-encrypted**; apply Cloudflare access controls and your retention/privacy policy.
- Processed raw event retention: 7 days, OAuth transactions: 1 day, Graph logs: 30 days. DEAD events, conversations, messages, receipt watermarks and outbound audit records require an operator's data retention/deletion policy. Latest 200 threads/messages are exposed per Page/thread; historical pagination/backfill is not implemented.
- Configure Cloudflare WAF/rate limiting and monitoring for production. Code limits active OAuth transactions (3 per employee) but does not replace infrastructure-wide rate limiting. Observability is off by default to avoid logging callback code/state or webhook bodies; audit the platform's own request logging separately.
- Page subscription state proves Graph configuration, not successful end-to-end webhook delivery. Use the live checklist before claiming inbound/outbound verified.

## Commands / sources

`pnpm typecheck`, `pnpm test`, `pnpm test:gateway`, `pnpm test:e2e`, `pnpm test:packaged`, `pnpm --filter @pvh/gateway build`.

Official references read before implementation:
- https://developers.facebook.com/docs/graph-api/changelog/
- https://developers.facebook.com/docs/permissions/
- https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/
- https://developers.facebook.com/docs/messenger-platform/webhooks/
- https://developers.facebook.com/docs/messenger-platform/send-messages/
- https://developers.cloudflare.com/d1/worker-api/d1-database/