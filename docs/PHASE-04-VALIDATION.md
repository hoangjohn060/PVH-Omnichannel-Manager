# Phase 04 validation — desktop v0.4.0

Local Windows development verification only. Not a production/live-platform acceptance report.

| Check | Result |
|---|---|
| Strict desktop/gateway/test TypeScript (`pnpm typecheck`) | PASS |
| Unit + HTTP + SQLite fixtures (`pnpm test`) | 67 PASS across 5 files; 16 new inbox cases |
| Local real workerd/D1, both migrations (`pnpm test:gateway`) | 3 PASS |
| Source Electron E2E (final full suite) | 5 PASS, 1 live QR opt-in SKIPPED |
| Packaged Electron E2E | 5 PASS, 1 live QR opt-in SKIPPED |
| Hono Worker dry-run bundle | PASS; no deployment |
| Windows x64 NSIS build | PASS |
| Native SQLite Electron probe | PASS; integrity ok |
| Operator script syntax checks | PASS |
| Installer Authenticode | NotSigned |
| Clean-machine install/uninstall, SmartScreen | NOT TESTED |
| Meta/Zalo live OAuth/login/inbound/outbound/receipts | BLOCKED |

The first combined E2E run had a 45-second Electron launch timeout in the desktop foundation test. Its isolated rerun passed; subsequent full source suite passed, and packaged suite passed. This is recorded rather than hiding the initial failure. Vite emitted its existing config-loader/CommonJS warning; builds/tests completed.

## Coverage

- Zalo inbound simulator, external ID dedup, preserving original gateway message content.
- Facebook journal projection, native echo unknown attribution and receipt update.
- Authenticated agent sends through both adapter paths. Pending exists before the platform fixture responds; ACCEPTED is not delivery.
- Two agents sharing conversation/version, client UUID replay/conflict, single active job.
- VIEWER API and UI restrictions, revoked membership/grant, cross-organization access denial, connector path/traversal rejection.
- Assignment CAS/history/audit, private drafts, internal notes, customer tags/care-note version conflicts.
- Definitive FAILED versus UNKNOWN, safe manual retry, interrupted-send recovery, revoked sender before Zalo connector claim.
- Bounded 50-row/message keyset pagination and per-channel change cursor.
- Early self echo/send-result reconciliation and duplicate connector result ACK.
- Electron fixture-only UI: both channels, drafts, notes, native unknown agent, customer panel, viewer UI. Simulator replaces fetch only inside the isolated test Electron main process; no production switch injects fixtures.

## Artifacts

- Installer: `D:\cvvui\PVH Omnichannel Manager\apps\desktop\release\PVH-Omnichannel-0.4.0-x64-Setup.exe`
- Unpacked executable: `D:\cvvui\PVH Omnichannel Manager\apps\desktop\release\win-unpacked\PVH Omnichannel Manager.exe` — retain the entire win-unpacked folder.
- Logs at `D:\cvvui\PVH Omnichannel Manager\phase04-{typecheck,unit,gateway,worker-build,dist,source-final,packaged}.log`.

## Acceptance remains partial

See `D:\cvvui\PVH Omnichannel Manager\docs\PHASE-04-INBOX.md` for operator setup and detailed limits, and `D:\cvvui\PVH Omnichannel Manager\docs\INBOX_LIVE_TEST.md` for separately BLOCKED live acceptance. Real avatars, safe attachment preview/upload, unified media composer, reply/quote, manual identity linking, full SSO/device credentials, distributed connector failover and production-scale hardening are incomplete. Do not label Phase 04 fully production-ready from these tests.