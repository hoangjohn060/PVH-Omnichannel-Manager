# Facebook Phase 03 — validation and live checklist

## Truthful verification labels

| Label | Result | Evidence / limit |
| --- | --- | --- |
| META_OAUTH_LIVE | **BLOCKED** | No supplied Meta App ID/Secret, deployed public HTTPS gateway or authorized test person/Page |
| PAGE_CONNECTED_LIVE | **BLOCKED** | No actual granted Page token/subscription inspection |
| WEBHOOK_INBOUND_LIVE | **BLOCKED** | No real Meta webhook received |
| MESSENGER_OUTBOUND_LIVE | **BLOCKED** | No authorized real recipient/message ID verified |
| DELIVERY_READ_LIVE | **BLOCKED** | No real receipt observed |
| APP_REVIEW | **BLOCKED / NOT VERIFIED** | Approval/business verification not supplied |

Fixture names/IDs are test-only, never seeded into the production UI. A local D1/workerd test proves the binding/migration path, not public Meta connectivity. Zalo live labels in Phase 02 remain unchanged.

## Automated scope

### Executed results — Phase 03 build v0.3.0

| Command | Result |
| --- | --- |
| `pnpm typecheck` | PASS: desktop, gateway and tests strict |
| `pnpm test` | **51/51 PASS**, including 25 Facebook fixture/HTTP tests and all prior 26 tests |
| `pnpm test:gateway` | **2/2 PASS**, local workerd D1 binding |
| `pnpm test:e2e` | **3 PASS, 1 skipped** (Zalo real QR opt-in, unchanged) |
| `pnpm --filter @pvh/gateway build` | PASS, Wrangler deploy dry-run only |
| `pnpm dist:win` | PASS, Windows x64 NSIS v0.3.0 |
| `pnpm test:packaged` | **3 PASS, 1 skipped**, final rebuilt v0.3.0 EXE |
| Installer Authenticode | **NotSigned**, verified with PowerShell |

Artifacts:
- `D:\cvvui\PVH Omnichannel Manager\apps\desktop\release\win-unpacked\PVH Omnichannel Manager.exe` — keep the whole folder.
- `D:\cvvui\PVH Omnichannel Manager\apps\desktop\release\PVH-Omnichannel-0.3.0-x64-Setup.exe`.

Local ignored evidence: `phase03-typecheck.log`, `phase03-unit.log`, `phase03-d1.log`, `phase03-e2e.log`, `phase03-worker-build.log`, `phase03-installer.log`, `phase03-packaged-e2e.log` in `D:\cvvui\PVH Omnichannel Manager`. Non-fatal Vite CJS-config deprecation and electron-builder dependency-reference warnings remain; they did not prevent checks/builds. No clean-machine install/uninstall was performed.

- Unit + HTTP integration: actual gateway router and migration SQL with SQLite-backed D1 fixture; Graph network mocked. Covers state mismatch/expiry/one-time claim, authorized Page selection, token encryption/context, raw signature/forgery/body size, event dedup/normalization, permission denied/revoked, Page/organization isolation, real credential-derived agent mapping, 24h boundary, official attachment payload, API errors/UNKNOWN/idempotency and interrupted-send recovery.
- `pnpm test:gateway`: real local workerd D1 binding via Wrangler; actual migration, authenticated API, signed persistence/duplicate message path and concurrent OAuth claim. No remote database modified.
- Source/packaged Electron E2E: Facebook preload allowlist, invalid IPC rejection, navigation/Settings integration and truthful BLOCKED empty state; existing desktop/Zalo regressions.
- Worker dry-run bundles successfully. This is not a deployed endpoint or full Worker HTTP/network policy test.

## Manual live procedure — operator consent required

1. Follow `D:\cvvui\PVH Omnichannel Manager\docs\META_APP_SETUP.md`. Use only your own consenting app-role tester/Page first; record app mode, Graph version and scope approvals without recording secrets.
2. Launch desktop with operator-issued personal gateway credential. Settings > Facebook Fanpage > Connect. Verify only the official Meta page opens in the default browser, not an embedded browser. Reject/omit permission once: no Connected.
3. Start a new transaction, complete login/consent, return to desktop and select a granted Page. Verify Page identity, required scopes and webhook subscription through runtime check. Check that unselected/unauthorized Pages cannot be read or used for sends. Save redacted evidence.
4. Repeat callback URL once: one-time state rejects it. Wait 5 minutes on another transaction: expired state rejects callback/select. Do not share URLs containing state/code.
5. Configure dashboard webhook verification. Test wrong verify token; then correct token. Signed real inbound message from consenting second person: verify one D1 event/message, Page ID + PSID + local conversation key, Vietnamese/emoji preservation.
6. Replay the same redacted test webhook with valid fixture secret **only in isolated staging**, not production: one message. Tamper bytes/signature: 403, no persisted event. Inject unknown Page: no data stored. Check 256 KiB limit.
7. Reply from PVH as employee A, then employee B with distinct provisioned credentials. Compare actual recipient and Meta message IDs. Verify persisted agent IDs are server-derived; outside-client Page echo remains null. Never count ACCEPTED as delivered.
8. Observe real delivery/read events and echo ordering; confirm monotonic status. Force a network failure only in staging: FAILED/UNKNOWN displayed; no automatic second Send API call for the same request ID. Inspect Meta Inbox before any fresh send.
9. Test a legitimately older conversation outside 24h: gateway blocks. Do not forge timestamps in production or enable unauthorized tags to bypass policy.
10. Send public owned test image/file URLs allowed by Meta; compare recipient rendering, ID and errors. Inbound media metadata is stored; preview/local upload are outside current scope.
11. Two authorized Pages with same person's PSID-shaped values remain isolated; two organizations cannot connect/read the same assigned Page. Wrong-org direct API calls return no data.
12. Revoke Meta app/token: Check and Send must mark TOKEN_REVOKED/PERMISSION_DENIED and not Connected. Reconnect via fresh OAuth. Disconnect removes subscription and deletes stored Page token; if Graph unsubscribe fails, UI reports error and keeps the connection for explicit operator recovery/revocation.
13. Restart desktop: gateway retains encrypted token/history; renderer does not receive token. Revoke/expire gateway employee credential: routes reject it. Verify credential is not in logs/build assets.
14. Exercise DEAD queue replay using a staging processing failure; admin replay is tenant-scoped, processed idempotently and never re-sends outbound. Confirm cron cleanup/UNKNOWN recovery.

Only replace a BLOCKED label after recording time, real environment, redacted trace/message IDs and operator result. Do not store passwords, access tokens, OAuth URLs, QR material or customer content in the test report.

## Remaining production gates

Actual deployment/DNS/HTTPS/Meta review, public privacy/deletion handling, signed-request deauthorization/deletion callbacks, formal SSO/per-Page ACL and operator credential delivery, monitoring/WAF, tenant data retention/deletion, remote D1 load/retry testing, Windows code signing and clean-machine install/uninstall. No production-ready claim from fixture success.