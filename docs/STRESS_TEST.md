# Phase 07 — Stress test evidence

## Scope

Real SQLite and Electron on available i7-5500U / approximately 12 GB / Windows 10 host. Synthetic fixtures are confined to tests, never added as production data. No real employee/provider account was used, no external production load generated. Hardware benchmark results are narrowly scoped in `D:\cvvui\PVH Omnichannel Manager\docs\PERFORMANCE_REPORT.md`.

## Results

| Scenario | Result | Evidence / limitation |
|---|---|---|
| 10,000 database messages | PASS | File-backed SQLite, WAL + FULL, batches of 100 |
| 100 recent conversations | PASS at DB layer | 100 distinct threads with indexed reads; 100 simultaneously opened UI workspaces NOT_MEASURED |
| 100 incoming events | PASS simulated layers | Verified supervisor batch fixture + SQLite transaction + renderer 200-to-300 message fixture; real Zalo/WAN roundtrip NOT_MEASURED |
| 20 duplicate events | PASS | Messages and both outboxes remain one row per account/message ID |
| Batch failure | PASS | Foreign-key failure rolls back earlier message and outbox rows from same batch |
| Query indexing / injection | PASS | EXPLAIN uses thread index; SQL-like account input returns no rows |
| Abrupt network loss | PASS unit simulation | Existing Sheets offline handling / connector NETWORK state and bounded reconnect; physical cable/router drop NOT_MEASURED |
| Zalo worker crash | PASS unit simulation | Existing supervisor emits worker error, checks backoff and no competing duplicate listener; real logged-in worker kill NOT_MEASURED |
| Gateway timeout | PARTIAL | Production uses 45-second AbortSignal and redirect error; dedicated full-stack WAN timeout fault injection NOT_MEASURED |
| Google Sheets quota | PASS unit simulation | 429 sets SHEETS_RETRY_QUOTA; next attempt delayed; manual retry cannot bypass backoff |
| Ambiguous Sheets write timeout | PASS unit simulation | Same durable row mapping reused/read back, no blind append |
| Restart | PASS local | SQLite close/reopen count + quick_check; source/packaged app settings, window, backup persistence E2E |
| Virtualized variable-height messages | PASS Electron fixture | <40 articles mounted for 200/300 loaded messages; final burst row visible after scroll; no pageerror |
| Multi-hour leak/soak | NOT_MEASURED | No authorized multi-hour connected-account test run |
| Real two-PC contention/revocation | NOT_MEASURED this phase | Phase 06 operator acceptance still required |
| Clean Windows installer lifecycle | NOT_MEASURED | Packaged launch is not install/upgrade/uninstall validation |

## Final validation commands and counts

From `D:\cvvui\PVH Omnichannel Manager`:

| Command | Result | Log |
|---|---|---|
| `pnpm.cmd typecheck` | PASS | `phase07-typecheck.log` |
| `pnpm.cmd test` | 103 PASS, 9 files | `phase07-unit.log` |
| `pnpm.cmd test:gateway` | 5 PASS, real workerd/D1 | `phase07-gateway.log` |
| `pnpm.cmd build` | PASS | `phase07-build.log` |
| `pnpm.cmd exec playwright test` | 8 PASS / 1 SKIPPED | `phase07-e2e-final.log` |
| `pnpm.cmd --filter @pvh/desktop dist:win` | PASS | `phase07-dist.log` |
| `pnpm.cmd test:packaged` | 8 PASS / 1 SKIPPED | `phase07-packaged.log` |
| `pnpm.cmd audit --json` | Exit 1: 1 moderate advisory | `phase07-audit.json` |

Live QR test remains intentionally skipped without the pre-existing explicit environment opt-in. No failing tests were deleted, disabled or given automatic retries. Earlier failed runs are retained in `phase07-e2e.log` / `phase07-performance.log` where applicable; final authoritative run is named above.

## Issues found while validating

- New test initially used incorrect login labels and a disallowed IPC fixture path. Fixed only the test harness; production IPC remained strict.
- Existing desktop E2E could select an initial blank/splash page by testing only “not data URL.” Updated both selection branches to target the actual file-loaded renderer. Did not loosen the workspace assertion or increase its timeout to hide startup failures.
- New test's TypeScript timeout overload/environment typing corrected; typecheck rerun PASS.
- Batch stop path now flushes worker's buffered messages and captures only identity-verified/account-matching final batches during graceful shutdown. Abrupt crash before DB commit can still lose an unpersisted event; this phase does not claim provider replay guarantees.

## Raw metrics

`D:\cvvui\PVH Omnichannel Manager\artifacts\phase07-database.json` includes seed/burst times, 100 query samples summarized as p50/p95, runtime and EXPLAIN plan. `D:\cvvui\PVH Omnichannel Manager\artifacts\phase07-electron.json` and `D:\cvvui\PVH Omnichannel Manager\artifacts\phase07-electron-packaged.json` include process IDs, CPU and memory fields plus startup and simulated-render timing. They do not contain real customer data. Rerunning tests overwrites these metric files; archive them per build for comparisons.

## Authorized soak / fault-injection follow-up

1. Use staging tenant, dedicated test Zalo/Meta/Sheets accounts and disposable business data. Obtain provider/operator authorization before load.
2. Record app hash, OS, RAM, drivers, active GPU, power plan, disk layout and baseline CPU/RAM. Preload 10,000 test messages / 100 conversations through authorized flows, not by mutating a live user's database.
3. Run 4–8 hours with periodic navigation, search, history pagination, bursts and duplicate replay. Collect 5-second memory/CPU samples, per-worker heap, event-to-paint percentiles, long tasks, database latency and disk growth. Compare early/late steady-state and post-navigation reclaimed heap; stable short-term RSS is not leak proof.
4. Disconnect network during ingest/send, kill only test connector, inject gateway timeout/5xx and Sheets 429. Reconnect/restart; reconcile IDs, durable outboxes, UNKNOWN sends, attribution and lease fencing. Never resend an ambiguous operation under a new ID to make the test pass.
5. Repeat source/package and Windows 10/11; separately validate signed installer lifecycle on clean machine. Publish all failures and NOT_MEASURED cases alongside successes.