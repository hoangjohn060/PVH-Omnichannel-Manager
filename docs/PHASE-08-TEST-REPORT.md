# Phase 08 — build, test and release gates

Version: desktop 0.8.0. Overall: **BLOCKED for production release**, installer build PASSED.

## Verified on build host
Windows 10 Home 10.0.19045 x64; Node 24.21.0; pnpm 10.34.7; Electron 44.9.0; electron-builder 26.15.3; better-sqlite3 13.0.3. Workspace root/Gateway/shared retain independent 0.1.0 package versions. Resolved package inventory is in `phase08-versions.log`; no claim of latest dependency versions.

| Check | Result | Evidence / limitation |
|---|---|---|
| TypeScript | PASSED | phase08-typecheck.log, final exit 0 |
| ESLint TS/TSX | PASSED | phase08-lint.log, zero warnings; CJS scripts not covered by this lint config |
| Unit tests | PASSED | phase08-unit.log: 110 tests / 10 files |
| Local workerd/D1 integration | PASSED | phase08-gateway-final.log: 5 tests / 2 files |
| Source Electron | PASSED | phase08-source-e2e-final.log: 9 pass / 1 skipped |
| Packaged Electron | PASSED | phase08-packaged-e2e-final.log: 9 pass / 1 skipped |
| NSIS x64 build | PASSED | phase08-build.log; config artifact name, no post-build rename |
| Native SQLite | PASSED | Electron ABI 149, N-API 10, x64 probe integrity ok; automatic dependency rebuild; packaged database creation/restart test |
| Required archive assets | PASSED | release-inspection.json: main/workers/preload/renderer/icon present; app.asar and unpacked win32-x64.node |
| Hardcoded secret scan | PASSED | No matches in scoped regex scan. Not exhaustive; excludes dependency content, history and arbitrary binary secrets |
| Development dependency paths | PASSED | First-party packaged JS/CSS/HTML checked for workspace/localhost dev paths; not a whole-binary forensic audit |
| Production IPC | PASSED | Existing sender/frame URL and schema checks, sandbox/context isolation; packaged renderer ignores ELECTRON_RENDERER_URL; secure bridge tests |
| Dependency audit | FAILED | 1 moderate sprintf-js build-chain advisory, no patched version returned; phase08-audit.json. No unreviewed override applied |
| Code signing | BLOCKED | No signing certificate supplied; Authenticode NotSigned despite builder log saying signing with signtool |

Initial lint/typecheck issues were corrected. Initial onboarding tests selected the splash rather than main window; corrected to select the application window. One source run failed workspace visibility during concurrent load; final rerun passed. One integration auth test returned HTTP 500 during concurrent execution; preserved in phase08-gateway.log, final rerun passed 5/5. This intermittency is a known issue, not proof of production auth stability.

## Installer and live acceptance matrix
| Acceptance | Result | Reason |
|---|---|---|
| Clean Windows 10 installation | NOT_TESTED | Build host is not clean; setup not installed on it |
| Windows 11 x64 | NOT_TESTED | No VM/PC supplied |
| Launch from installed Desktop/Start Menu shortcut | NOT_TESTED | Shortcuts configured, not exercised through installer |
| SQLite creation + app restart + settings persistence | PASSED | Packaged executable, isolated temporary userData; not installed lifecycle |
| Gateway onboarding without environment/Terminal | PASSED | New packaged UI test, HTTPS validation and restart persistence |
| Windows reboot persistence | NOT_TESTED | No host reboot performed |
| Session encryption round-trip | PASSED | Actual Windows safeStorage; does not prove provider session after reboot |
| Configured live channels retained across reboot | BLOCKED | No authorized connected accounts, reboot fixture absent |
| Real Zalo send/receive and QR login | BLOCKED | Live QR test skipped; credentials/authorization absent |
| Real Facebook OAuth/send/receive | BLOCKED | No deployed approved Meta test environment |
| Real Google Sheets sync | BLOCKED | No authorized spreadsheet/service account/deployed Gateway |
| Upgrade 0.6.0 → 0.8.0 with existing DB | NOT_TESTED | Requires backed-up representative data and install lifecycle |
| Uninstall and data retention | NOT_TESTED | deleteAppDataOnUninstall=false configured only |
| Backup | PASSED | SQLite backup file created in packaged test |
| Complete backup/restore acceptance | NOT_TESTED | No restore UI; operator procedure not acceptance-tested |
| 4–8h soak / two-PC acceptance | NOT_TESTED | Phase 06/07 gaps carry forward |

## Known issues / features not accepted
- Unsigned distribution; potential SmartScreen warnings; no protection bypass.
- Moderate build dependency audit remains open; assess before wider distribution.
- Installer lifecycle, Windows 11, reboot, cross-version migration and restore not validated.
- Remote Gateway deployment and provider credentials are mandatory. Desktop EXE is not a bundled cloud backend.
- No production live-provider/two-PC acceptance; simulator cases do not substitute.
- UserData ACL/migration, comprehensive abuse/rate controls, retention/erasure, attachment cache/archive and long-run history memory remain unresolved from Phase 07.
- Auto-update is design-only and disabled; no unattended binary retrieval.
- Standalone customer/report and some navigation screens remain incomplete/disconnected.
- Gateway setup is first-run only; changing a configured endpoint requires administrator review while stopped.
- No Git repository available at this workspace root; no commit provenance/diff can be asserted.

## Manual release/setup checklist
- [ ] Approve Gateway infrastructure, HTTPS certificate, tenant/employee roles and secrets.
- [ ] Obtain code-signing certificate and produce/verify signed artifacts; distribute checksum through an authenticated channel.
- [ ] Resolve/approve dependency advisory with documented risk ownership.
- [ ] Verify clean install, Desktop/Start shortcuts, SQLite and uninstall retention on Windows 10 and Windows 11 x64.
- [ ] Test Windows reboot and encrypted-session handling under actual user identity.
- [ ] Back up representative old data; test upgrade/migration and recovery on copies.
- [ ] Authorize Zalo QR/login/send/receive, Meta OAuth/webhooks/send/receive, and Google Sheets live sync.
- [ ] Exercise network loss, connector kill, Gateway timeout, Sheets quota and retry recovery.
- [ ] Complete multi-hour soak, two-PC role/dedup acceptance, ACL hardening and retention/erasure review.
- [ ] Owner signs test report and production release approval. No 100% completion claim before gates pass.