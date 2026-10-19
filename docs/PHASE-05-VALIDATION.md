# Phase 05 validation — desktop 0.5.0

## Local automated verification

| Command / check | Result |
|---|---|
| `pnpm typecheck` | PASS, exit 0 |
| `pnpm test` | 88 PASS, 6 files, including 21 new Sheets tests |
| `pnpm test:gateway` | 4 PASS, real local workerd/D1 including Phase 05 trigger/checkpoint test |
| Source Electron E2E final (`pnpm exec playwright test`, after build) | 7 PASS, 1 live QR opt-in SKIPPED |
| `pnpm dist:win` | PASS, 0.5.0 x64 NSIS + native SQLite runtime probe |
| `pnpm test:packaged` | 7 PASS, 1 live QR opt-in SKIPPED |
| `pnpm --filter @pvh/gateway build` | PASS, dry-run only |
| Wrangler local migrations 0001/0002/0003 | PASS |
| Service Account provisioning script | Syntax PASS and local D1 smoke PASS using generated fixture-only RSA key; never contacted Google |
| Installer Authenticode | NotSigned |
| Remote deployment / real Google / real platform acceptance | **BLOCKED / NOT VERIFIED** |

Logs: `D:\cvvui\PVH Omnichannel Manager\phase05-{typecheck,unit,gateway,e2e,source-final,worker-build,dist,packaged,local-migrations}.log`.

An initial new test fixture supplied one extra SQL placeholder and shared a credential hash with another integration fixture; both fixture bugs were corrected before the final successful runs. Type export was also added before successful typecheck. Existing Vite config-loader warning and build dependency duplication warning remain nonfatal. No clean-machine install/uninstall or SmartScreen testing was performed. The workspace has no Git metadata, so no git diff/status evidence is available.

## Test scope

- A–D incoming/outgoing Zalo/Facebook projection and status updates; E unknown native agent stays blank.
- F offline preserves source/pending; G timeout-after-write reuses the exact range and reconciles without append; H expired access token signs/verifies JWT refresh and encrypts cached token; rejected token pauses/reconnects; I 403/404 safe errors; J 429 quota with saved Retry-After/backoff and manual bypass prevention.
- Atomic rollback, stale-revision ACK, disabled/leased worker, fixed destination/tenant admin guard, RAW formula-like strings, masking rewrite, missing tabs/header conflicts, refusal to adopt populated sheets, row conflict refusal, 100-record bound, old-data migration backfill, early echo tombstone and response-time report semantics.
- Two Electron UI tests cover truthful unconfigured/blocked setup, IPC traversal rejection, and isolated fixture controls/counters/redaction/check/sync. No production fixture switch or Google secret in renderer.

## Artifact

`D:\cvvui\PVH Omnichannel Manager\apps\desktop\release\PVH-Omnichannel-0.5.0-x64-Setup.exe`

SHA256: `921AC65236AD1CAD63413D674599BD4394D390E308B45BC07D8F58FDD2377A79`

The desktop installer does not contain gateway Service Account credentials. Apply migration 0003 to the authorized deployed gateway separately before use. No remote resources were created.

## Acceptance limits

Service Account only (not end-user OAuth UI), dedicated app-managed tabs, manual spreadsheet ID, attachment links intentionally blank, export masking is pseudonymization not anonymization. Google revision history is not purged by rewriting. No global cross-organization quota scheduler or production-scale load acceptance yet. Keep live sync BLOCKED until the operator checklist in `D:\cvvui\PVH Omnichannel Manager\docs\GOOGLE_SHEETS_SETUP.md` has real spreadsheet write/readback evidence.