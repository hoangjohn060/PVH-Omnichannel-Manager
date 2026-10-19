# Phase 06 — shared Windows employee workspace

## Deployment and first administrator

Workspace root: `D:\cvvui\PVH Omnichannel Manager`.
Gateway config: `D:\cvvui\PVH Omnichannel Manager\apps\gateway\wrangler.jsonc`.
Use a real D1 database ID instead of the all-zero placeholder, set the exact HTTPS `PUBLIC_ORIGIN`, and provision platform secrets using the existing Meta/Sheets guides. Back up D1 before applying migrations. Test on staging first: migration 0004 rebuilds memberships and creates a unique real-Zalo identity index; existing duplicate real identities must be reconciled before deployment.

From the workspace root, apply migrations and deploy using the existing gateway scripts. These commands affect production and were **not** executed during local validation:

```powershell
pnpm --filter @pvh/gateway db:remote
pnpm --filter @pvh/gateway deploy
```

An authorized operator creates the initial organization and SUPER_ADMIN with:

```powershell
# Set PVH_BOOTSTRAP_PASSWORD via your approved secret-entry mechanism, not a committed file.
node apps/gateway/scripts/bootstrap-employee.mjs <org-id> <verified-user-id> <email> --remote
Remove-Item Env:PVH_BOOTSTRAP_PASSWORD
```

Script: `D:\cvvui\PVH Omnichannel Manager\apps\gateway\scripts\bootstrap-employee.mjs`.
Password length is 15–128 characters. Only the salted versioned scrypt hash enters the temporary SQL file; it is removed in a finally block. Never use fixture passwords in production. The script is INSERT-only, intended for a new organization, not account recovery or resetting an existing administrator. A failed rerun must be inspected by the operator; do not treat it as a reset tool. Use `--local` only for local D1 smoke tests.

Configure `PVH_GATEWAY_URL` to the same exact HTTPS origin on each Windows PC before starting the app. Do not distribute `PVH_GATEWAY_CREDENTIAL`: desktop uses employee email/password sessions now. Log in through the Windows form, open **Nhân viên**, and create individual employee credentials and inbox grants. SUPER_ADMIN is tenant-scoped, not cross-tenant authority. Only SUPER_ADMIN can create/edit another SUPER_ADMIN. ADMIN manages other employees; MANAGER manages inbox operations; AGENT/VIEWER require grants and VIEWER cannot send. Membership changes revoke sessions, legacy credentials and leases. Removal preserves historical attribution.

## Session and connector operations

- Access: 15 minutes; refresh: seven days with single-use atomic rotation. Passwords are not persisted. Tokens use main-process Electron encrypted storage; renderer receives status/principal only.
- A cached login status is not offline authorization. Every backend request checks active membership. Offline operations requiring server authorization fail closed.
- One real Zalo UID has one registered channel globally. Configure/reuse its connector channel rather than creating another local UUID for the same UID. Automatic channel adoption/moving a saved SDK session between PCs is **not implemented**.
- Connector owner must be SUPER_ADMIN/ADMIN/MANAGER and match the channel owner. Server lease TTL is 90 seconds; heartbeat is 20 seconds. Persisted fences are not automatically heartbeated after startup. Every ensure validates server ownership; lease failure stops the local connector. Logout suspends renewals and disconnects local accounts. A second PC must wait for lease expiry before taking ownership; no force-takeover UI exists.
- Result reconciliation uses the original claim's device/fence, not a newly acquired fence. UNKNOWN sends are not blindly retried. A crash between job claim and durable local send journal may need operator reconciliation; do not interpret UNKNOWN as proof of failure.
- Zalo local state displays disconnection on the connector PC. A tenant-wide remote connector-offline badge is **not yet implemented**; a visible inbox is not evidence that its listener is online.

## Sync and recovery semantics

D1 is authoritative. Desktop local outbox and result journals survive transient network failures. Per-employee/per-channel cursors are stored in local SQLite, monotonically advanced. The renderer invalidates/refetches authoritative queries, rather than applying change payloads as a message replica. Cursor writes currently precede renderer invalidation: restart/remount refetches current data, but an IPC loss while an existing view stays mounted can leave that view stale until refetch/remount. This is not an acknowledged, transactionally applied replica protocol.

Change pages are bounded to 100; conversations and timelines use keyset pagination. Existing tests exercise bounded paging/deduplication, not a full production initial-sync benchmark. Platform history before connector ingestion is not promised. A partial channel polling failure no longer suppresses invalidation for successful channels. Reconnect and multi-PC eventual consistency still require live acceptance.

## Retention and deletion policy

Authentication sessions are removed when expired; revoked records are removed after seven days from creation. Old rate-limit windows are pruned. Processed Meta raw events retain seven days, OAuth transactions one day and Graph logs 30 days. Cron must actually run in production.

Messages, customers, drafts, notes, inbox audit, send journals, DEAD events and Sheets projections have **no automatic business-data deletion**. Employee removal is not customer erasure. Before production, the data controller must approve retention periods and a tenant-scoped deletion/export procedure covering D1, local SQLite/automatic backups, Windows encrypted sessions and Google Sheets. No customer-erasure UI or backup-purge automation is claimed. Uninstall retains userData. D1 business payloads are not application-encrypted. Restrict operator access and backup access; redact Sheets where appropriate.

## Required live acceptance (not performed)

1. Two Windows PCs and distinct employees on the same HTTPS tenant: grant/deny, role revoke, reconnect, logout and no cached sensitive workspace after user change.
2. Simultaneous assignment/version conflicts and send attribution; disconnect/reconnect without duplicate messages or missed updates; paginate a dataset beyond one page.
3. Same channel on two connector devices: second blocked, expiry takeover, old owner's claims rejected, late original result reconciled without resend. Verify only one actual SDK listener.
4. Real UID duplicate binding rejected before listener.start; verify reboot/network loss and explicit disconnect.
5. Real Meta webhook/send and Google Sheets reporting from both employees. Confirm audit, attribution and redaction.
6. Clean Windows installation, upgrade/uninstall, signing/SmartScreen and platform monitoring. Local unpacked E2E does not prove installer lifecycle or live acceptance.