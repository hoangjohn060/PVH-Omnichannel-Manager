# Phase 07 — Security audit

## Verdict

**CONDITIONAL / NOT RELEASE-APPROVED.** Static review plus local regression tests, not an independent penetration test or proof of absence of vulnerabilities. Evidence collected on host local 2026-10-19. Existing Phase 06 staging/two-PC/live-provider gaps remain open.

## Fixed in this phase

1. Trusted renderer URL comparison now checks protocol, host and absence of credentials as well as origin/path/query. Prevents treating remote UNC `file:` hosts as equivalent merely because file origins are `null`. Regression test added.
2. Main error logs redact URLs, bearer tokens, named credential fields and 64-hex tokens; cap each entry at 2,000 chars, rotate at 2 MiB with one prior file. Errors still reach stderr; no console-error suppression added. Regex redaction is defense in depth, not a guarantee against arbitrary unlabelled PII or credentials. Existing logs are not retroactively scrubbed.
3. DB worker failures reject later operations immediately; failed postMessage clears pending timers and bounded pending RPC prevents unlimited queue growth.
4. Batch writes retain transaction atomicity, account checks, idempotency and FULL SQLite durability; no security flags disabled for speed.

## Reviewed boundaries

| Area | Evidence / status | Residual risk |
|---|---|---|
| IPC | Main validates exact WebContents, main frame, trusted URL and strict method schemas; unauthorized legacy direct-send/history routes rejected | No global renderer IPC rate limiter; local compromised renderer could cause resource pressure |
| Preload | Explicit bridge methods; no generic invoke, filesystem, shell or tokens exposed; listener unsubscribe functions | Object freeze is shallow; not a substitute for main authorization |
| Renderer | sandbox, contextIsolation, webSecurity true; nodeIntegration/webview false; packaged devtools off | Recheck every Electron upgrade |
| CSP | Packaged default/script self, connect none, frame/object/base/form blocked; only inline styles allowed | Development does not apply production header; style unsafe-inline remains for UI |
| Navigation | New windows denied; navigation, redirects and webview attachment blocked; tightened IPC URL test | Test harness chooses file-loaded main page, not blank/splash window |
| OAuth / URL allowlist | HTTPS gateway origin; Facebook dialog origin/path allowlist; server stores state digest, expiry and atomic one-time transition; tenant/user-bound selection | Real Meta callback/replay/consent tests require operator account; full authorization query validation can be strengthened |
| Windows DPAPI | Main-only safeStorage availability check, encrypted session/auth secrets; real Electron roundtrip E2E PASS | DPAPI is not protection against malware running as the same Windows user or an administrator |
| SQLite permissions | Database/backups in userData; no renderer filesystem access | **OPEN HIGH:** inherited Windows ACL is not hardened/verified by app; current host AppData ACL includes extra Modify principals; custom PVH_USER_DATA may be shared |
| Local business data | SQLite messages and backups remain plaintext, sessions separately encrypted | **OPEN:** disk-at-rest confidentiality relies on OS ACL/BitLocker; tenant business-data erasure and retention not implemented |
| Server RBAC | D1-backed server principal, tenant scope, role enforcement, employee revocation, connector fence; unit + real workerd tests PASS | Live multi-PC revocation/lease acceptance not complete |
| Webhook HMAC | Verify raw bounded body with META_APP_SECRET before ingest; signature/dedup integration tests PASS | Live provider validation pending; production secrets must be Workers secrets |
| Secret storage | Desktop DPAPI; gateway AES-GCM context-bound encryption; strict responses avoid raw tokens in renderer | Secret rotation/production provisioning remain operator tasks |
| Rate limiting | Login IP/email, refresh and OAuth outstanding-transaction limits; Sheets quota backoff | **OPEN:** no comprehensive per-tenant read/send/webhook abuse budget; edge WAF/rate limits needed before exposure |
| SQL injection | Parameter binding for user data; query plans and malicious account string regression PASS | Static/dynamic table identifiers must remain internal allowlists |
| XSS | React text rendering; attachment metadata only; no dangerouslySetInnerHTML found; packaged CSP | No complete browser fuzzing corpus or active malicious-media suite |
| Traversal / downloads | No renderer-controlled filesystem download/cache API; fixed DB/backup paths and backup filename filter | Controlled attachment downloader/archive not implemented; do not claim traversal coverage for nonexistent future code |
| Malicious media | No automatic customer URL fetch or video playback; avatar allowlist/stream cap/timeout/no redirects | Image dimensions/decompression cost not validated; thumbnails and safe download scanning absent |
| Log redaction | IPC logs code-only; connector SDK streams consumed without logging credentials; main redaction and rotation tested | Message text/customer PII cannot be made safe by regex alone; avoid raw objects at call sites |
| Dependencies | Actual pnpm audit output saved at workspace root `phase07-audit.json` | One moderate advisory below; registry scan does not prove runtime supply-chain safety |
| Auto-update | No autoUpdater flow found or introduced | **OPEN HIGH release gate:** installer NotSigned; signed publisher validation/update transport/rollback/compromised-feed tests not implemented |

## Dependency result

`pnpm.cmd audit --json` exited 1 and reported 1 moderate, 0 high, 0 critical, 550 total dependencies. Advisory `GHSA-hp3w-g68c-fv3c` / `CVE-2026-97058`: `sprintf-js` 1.1.3, unbounded precision formatting DoS. Reported path: desktop > electron-builder > app-builder-lib > @electron/get > global-agent > roarr > sprintf-js. Registry returned no patched version (`<0.0.0`, recommendation None).

This is a build-tool chain finding, not an established remotely reachable production renderer vulnerability. Do not apply a fabricated version override or hide the advisory. Keep build input trusted, track an upstream fix, rerun audit before release and verify packaged dependency contents. No dependency versions were changed in this phase.

## Release blockers / operator actions

1. **Restrict actual userData DACL**, including DB, WAL/SHM, backups and auth files. Review owner SID and inherited entries with `icacls`; validate alternate non-admin user cannot read/write. Do not recursively rewrite the user's AppData ACL or grant Everyone for performance. Use dedicated protected directory, admin-reviewed migration and rollback before enforcing ACL changes; this task did not modify host ACLs.
2. Sign installer and binaries with trusted publisher, verify Authenticode independently, bump version and test clean install/upgrade/uninstall. Builder's signing log is not signature evidence. No unsigned auto-updater may be enabled.
3. Define business-data retention, employee/tenant erasure semantics and encrypted-backup policy. Never implement cache cleanup as deletion of canonical messages/outboxes/attachments.
4. Configure production abuse controls, HTTPS Workers secrets, monitoring and secret rotation; run staging two-PC contention/revocation and genuine Meta/Zalo/Sheets roundtrips.
5. Test resource exhaustion (oversized images/JSON, request floods, queue overflow), compromised renderer attempts, OAuth replay, path canonicalization for any future downloads and malicious-media handling in an isolated environment.

## Evidence and limitations

Workspace: `D:\cvvui\PVH Omnichannel Manager`. Final local validation: typecheck PASS; 103 unit tests PASS; 5 workerd/D1 tests PASS; source and packaged Electron each 8 PASS / 1 SKIPPED (live QR test explicitly gated). See the corresponding root `phase07-*.log` files and `D:\cvvui\PVH Omnichannel Manager\docs\STRESS_TEST.md`. Tests use isolated temporary data; provider fixtures are not a live security certification.

Audit aligned with official Electron Security checklist, safeStorage documentation and code-signing guidance. Upstream documentation describes newer majors too; installed Electron 44.9.0 was exercised rather than blindly adopting newer API migrations.