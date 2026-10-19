# Phase 05 — Google Sheets setup

**LIVE SYNC: BLOCKED / NOT VERIFIED.** Automated mocks and local D1/Electron tests do not establish that Google accepted real data. No spreadsheet has been written live in this implementation session.

## Chosen authentication

Admin-owned **Service Account**, Google Sheets API v4. No desktop OAuth consent flow is implemented; do not interpret the Connect button as opening OAuth. It checks the backend Service Account and spreadsheet permission. No Google library/dependency is added: Workers Web Crypto signs RS256 JWT assertions, exchanges them at Google's fixed token endpoint, caches the access token encrypted, and renews it before expiry.

Private key and access token are AES-256-GCM encrypted in gateway D1, with organization-bound AAD. `TOKEN_ENCRYPTION_KEY` is a backend secret, the same key already used by the gateway. Neither key JSON nor access token is returned to the renderer or bundled in the EXE. Provisioning is an operator-only backend step, not an IPC operation.

## Operator steps

1. In the admin-owned Google Cloud project enable Google Sheets API. Create a dedicated Service Account and RSA JSON key; secure the file outside the source tree. Do not enable domain-wide delegation for this feature.
2. Create a **new empty spreadsheet**, share only that spreadsheet with the Service Account email as **Editor**. Do not make the spreadsheet public. Use a distinct spreadsheet per organization. No Drive listing scope is requested; input the spreadsheet ID manually.
3. Deploy the authorized HTTPS gateway/D1 using the existing deployment guide, and apply **all migrations including `0003_sheets.sql`**. Cron is already configured once a minute. Set backend `TOKEN_ENCRYPTION_KEY` with Wrangler secrets, never renderer environment variables.
4. In an admin-controlled terminal, use the same AES key in the process environment, then execute (replace parameters with operator values):

   ```powershell
   Set-Location 'D:\cvvui\PVH Omnichannel Manager\apps\gateway'
   node 'D:\cvvui\PVH Omnichannel Manager\apps\gateway\scripts\provision-sheets.mjs' <org-id> <absolute-service-account-json> --remote
   Remove-Item Env:TOKEN_ENCRYPTION_KEY
   ```

   `--local` targets only local Wrangler D1. This script encrypts before calling Wrangler; a temporary SQL file contains ciphertext only and is deleted in `finally`. Keep the original Google key in an admin secret store, outside backups/source logs; rotate it according to your organization's policy. Do not provision during active sync: first disable sync and let the current lease finish.
5. Launch the desktop with the existing individual gateway admin credential. In **Settings > Google Sheets**, enter the spreadsheet ID, leave masking enabled unless explicit data-export approval exists, then save.
6. Select **Kết nối / Kiểm tra quyền / Tạo tab**. This checks metadata, creates missing tabs, checks exact headers and performs a RAW header write to verify Editor permission. Existing nonempty data tabs are not adopted on first connection.
7. Only after a successful check, enable sync or select Sync now. Saving a masking change deliberately pauses sync and invalidates verification; recheck and re-enable afterward. Status, counters, retry deadlines and safe-code logs are visible here.

Only ADMIN can read/control this organization-wide export. AGENT/MANAGER/VIEWER cannot export all inboxes through these endpoints. Google requests always use the single configured spreadsheet ID; destination changes are rejected. Creating a replacement destination requires a controlled backend recovery/migration (see SYNC_RECOVERY), not entering arbitrary URLs.

## Live acceptance gate

Record operator, date/time, gateway build/migrations, test spreadsheet ID (in private operator evidence), and initial row counts. Send one inbound and one agent reply on each real platform. Match source D1 IDs/content/directions/status/attribution to the corresponding spreadsheet rows. Native unknown agent IDs must be blank. Exercise offline/retry without new duplicate rows, expired/revoked credential, denied sharing and quota handling where safe. Verify formula-like text remains literal and masking removes selected fields. Record row indices and readback evidence with secrets/PII redacted. **Only then mark LIVE SYNC PASS.**

## Limits

- Only data durably projected into gateway D1 is exported. A disconnected Zalo host first retains its local outbox, then uploads to D1; Google export occurs afterward.
- Dedicated app-managed source tabs: no manual sorting, insertion, deletion, renaming or concurrent writer. Build charts/pivots/formulas on separate tabs/copies. Known row/header conflicts pause sync, but arbitrary spreadsheet edits cannot be made transactionally safe by the API.
- Attachment links intentionally stay blank until URLs can be positively verified as public/non-sensitive. No cookie, session, Page access token, raw attachment JSON or local/private media path is exported.
- Up to 100 logical rows per batch per organization per cron pass, five organizations per scheduled pass, sequential API requests; backlog catches up over successive minutes. Large backfills/source-transaction aggregate costs need production-scale benchmarking. No distributed cross-organization global quota scheduler yet.
- An existing running batch may finish after disabling sync. Retention and deletion of already-exported Google data remain the operator's responsibility. Masking rewrites rows but does not erase Google revision history or previous downloads.

Official protocol references: Google Developers documentation for Service Account OAuth2, Sheets v4 values.batchUpdate / ValueInputOption, and Sheets API usage limits. URLs are kept in the developer source comments/research evidence rather than copied credentials or live evidence.