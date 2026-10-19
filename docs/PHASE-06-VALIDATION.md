# Phase 06 validation — desktop 0.6.0

## Recorded local evidence

All commands below ran in `D:\cvvui\PVH Omnichannel Manager` with exit 0 on their final recorded run.

| Check | Result | Log in workspace root |
|---|---|---|
| `pnpm typecheck` | PASS, desktop/gateway/tests | `phase06-typecheck.log` |
| `pnpm test` | **99 PASS**, 8 files | `phase06-unit.log` |
| `pnpm test:gateway` | **5 PASS**, 2 files | `phase06-gateway.log` |
| `pnpm exec playwright test` after final build | **7 PASS, 1 SKIPPED** | `phase06-e2e-final.log` |
| `pnpm dist:win` | PASS, native SQLite probe and x64 NSIS | `phase06-dist.log` |
| `pnpm test:packaged` | **7 PASS, 1 SKIPPED** | `phase06-packaged-final.log` |
| Gateway dry-run build | PASS, no deployment | `phase06-worker-build.log` |
| Wrangler local migration 0004 | PASS; 16 commands | `phase06-local-migrations.log` |
| New SUPER_ADMIN bootstrap | Syntax check and local D1 smoke PASS; fixture organization only | `phase06-bootstrap.log` |

The HTTP test runs the actual bundled handler inside local workerd, not only a Node handler with a D1 proxy. It verifies native scrypt, employee creation/login, wrong-password denial, single-use refresh rotation and server-side membership revocation. The initial HTTP failure was a fixture persistence-path mismatch (`getPlatformProxy` required the versioned `v3` path used by Wrangler dev); correcting it made the real runtime test pass. Unit reporting SQL JSON quoting was corrected, with agent ID verified at index 9 of the Sheets message projection. Earlier failed logs are not final acceptance evidence.

Additional regression tests cover unique real Zalo identity binding, expired auth-state pruning, inactive persisted fence heartbeat suppression, lease-loss shutdown and suspended in-flight acquisition. Existing suites cover tenant guards, role restrictions, CAS conflicts, deduplication, pagination, local connector journaling, IPC boundaries and real Windows safeStorage encryption. E2E transport fixtures explicitly authenticate test sessions; environment bearer credentials are no longer a desktop bypass. Fixture E2E is not a real platform send.

## Artifact

Installer: `D:\cvvui\PVH Omnichannel Manager\apps\desktop\release\PVH-Omnichannel-0.6.0-x64-Setup.exe`.

SHA-256: `C25008776C19F609F6237A7122CBC84E18FE14FB2B4F3D699DB85906475BC21B`.

Authenticode: **NotSigned**. Build's signtool messages do not constitute a valid signature. Clean-machine install/upgrade/uninstall and SmartScreen were not performed. Vite config-loader and duplicate dependency warnings remain nonfatal. The workspace has no Git metadata, so a trustworthy git diff/status cannot be supplied.

## Acceptance boundary

**Local automated validation PASS; full Phase 06/live acceptance NOT COMPLETE.**

No remote Worker/D1 deployment, real two-PC test, Google/Meta/Zalo live roundtrip or live QR login was performed. The opt-in live QR test remains skipped. These need operator-owned accounts, devices and infrastructure.

Outstanding product/acceptance gaps: tenant-wide connector-offline display; full initial-sync benchmark; automatic cross-PC connector-channel/session adoption; acknowledged cursor application for an already-mounted renderer after IPC loss; controller-approved business-data retention/erasure implementation; installer lifecycle/signing and live acceptance. Lease expiry cannot force a network-partitioned third-party SDK process to stop instantaneously; verify behavior on actual PCs. Server fencing guards backend operations but is not a transactional lock inside Zalo's external send API.

Provisioning, retention policy and live checklist: `D:\cvvui\PVH Omnichannel Manager\docs\PHASE-06-MULTIAGENT.md`.