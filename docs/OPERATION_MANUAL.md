# Operation manual — 0.8.0

## Daily workflow
- Open the management workspace from the Desktop icon. Configure the administrator-owned HTTPS Gateway on first launch, then log in as an employee. Do not share employee passwords.
- Zalo: open the Zalo account screen, create/select an account, initiate QR connection, and scan with the authorized test account. Treat QR/session material as credentials. Actual connected-account send/receive is BLOCKED pending authorization and credentials.
- Facebook: open Facebook Fanpage, start the external Meta OAuth flow, and select a page allowed for the organization. The remote Gateway must have valid Meta credentials, callback and webhook setup and permissions. No successful live OAuth is claimed.
- Google Sheets: open Settings and its Sheets section. The administrator provisions service-account credentials on the Gateway (never embeds them in the EXE), shares the spreadsheet, configures its ID, checks connection, then enables sync. Use dedicated schema tabs. See `GOOGLE_SHEETS_SETUP.md` and `SHEETS_SCHEMA.md`.
- Inbox: use the unified inbox for authorized conversations and jobs. Role restrictions and provider status still apply. A successful simulator fixture is not a live delivery receipt.
- Settings: theme, tray/background operation, notifications, Windows login startup and SQLite backup are available. Closing a window may leave the app running when background mode is enabled; Quit exits it.

## Data and recovery
SQLite `pvh.sqlite`, WAL/SHM, settings and backups live in Electron `app.getPath('userData')`. Resolve this for the installed application rather than assuming an install-folder path. Do not move a live database by copying only the SQLite file while WAL is active.

Use Settings → Sao lưu ngay to create a consistent database snapshot under `userData/backups`. Store a protected off-device copy. The SQLite backup is **not** a complete Gateway/D1 backup or a portable encrypted-session export.

Restore is currently an **operator-assisted procedure**, not an in-app restore feature: fully Quit the app, preserve the entire current userData directory, validate a backup in a separate maintenance environment with SQLite integrity checks, replace the closed database with the verified snapshot, and do not reuse stale WAL/SHM from another database state. Only the administrator should perform this; complete restore acceptance is NOT_TESTED. Never delete the only existing database. Gateway/D1 recovery follows the server operator's process.

Employee and Zalo secret material uses Electron safeStorage; tests verify encryption round-trip on this Windows account, not portability across PCs/users. Reauthenticate after migration to a different Windows identity. Avoid syncing session files through shared drives. UserData ACL hardening and formal retention/erasure policy remain release gates.

Gateway origin is persisted in `userData/gateway.json`; it contains no password. To change organizations/endpoints, fully log out and have the administrator back up and review connector fences, local history and configuration before changing the file with the app stopped. A self-service Gateway-change UI after initial setup is not implemented. Do not reuse another organization's data directory.

## Known incomplete screens
Some navigation entries (including standalone reports/customer views) still show truthful disconnected/not-implemented states. The workspace shell is not evidence that every administrative feature is implemented. See `PHASE-08-TEST-REPORT.md`.