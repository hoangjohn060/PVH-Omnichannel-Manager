# Sheets synchronization and recovery

## Invariants

D1 is authoritative. Google Sheets is a reporting projection, never a queue or send control plane. Source write and outbox materialization commit together; disabled/offline sync never discards the source/outbox. A ten-minute D1 lease serializes sync/check/configuration per organization. API calls have 15-second timeouts; the worker rechecks lease ownership before writes. Crashed leases expire. Only one 100-record batch is processed per invocation.

For every record, row index is allocated and persisted BEFORE Google requests. Values are written to exact ranges with values.batchUpdate and RAW, never values.append. Preflight checks headers and logical keys at mapped ranges. A successful write is followed by exact-range readback; only matching values ACK the captured revision. A concurrent source change remains pending because ACK uses revision compare-and-set.

## Timeout / Internet recovery

Timeout may occur after Google committed. Keep the mapping and revision pending. Worker waits exponential backoff with jitter, then reads/writes the same assigned range and verifies it. No second append occurs. Network/5xx failures retry automatically while enabled. A failed readback also remains pending. Original messages and customer history are never deleted by this feature. The outbox payload is a coalesced latest-state projection, not an immutable every-update export journal.

## Error handling

- `SHEETS_RETRY_NETWORK`, `SHEETS_RETRY_SERVER`, `SHEETS_RETRY_TOKEN`, `SHEETS_RETRY_UNCONFIRMED`, `SHEETS_RETRY_RECONCILIATION`: keep pending and retry with capped exponential backoff/jitter. Attempts/deadline survive restart. No automatic maximum-attempt deletion.
- `SHEETS_RETRY_QUOTA`: use Retry-After for 429 where provided (bounded to one hour), otherwise at least one minute and exponential backoff. Quota-specific 403 is also retried. Manual retry/sync must not bypass the saved deadline.
- `SHEETS_RECONNECT_REQUIRED`: invalidate cached access token, pause and require operator/check. Normal access-token expiry refreshes via signed Service Account JWT automatically. Revoked/invalid private keys require provisioning a replacement, then checking access and re-enabling.
- `SHEETS_PERMISSION_DENIED`, `SHEETS_NOT_FOUND`: verify the configured ID and Editor share with the provisioned account; reconnect/check after correction.
- `SHEETS_HEADER_CONFLICT`, `SHEETS_LAYOUT_CHANGED`, `SHEETS_ROW_CONFLICT`, `SHEETS_INVALID_LAYOUT`: stop and preserve D1. Restore the original tabs/header/row ordering from an audited backup; do not blindly reset mappings or continue overwriting someone else's rows.
- `SHEETS_TAB_NOT_EMPTY`: initial adoption refuses existing data, even with matching headers. Use a new empty dedicated spreadsheet.
- `SHEETS_DESTINATION_IMMUTABLE`: changing destination is intentionally operator-only to prevent accidental overwrite/exfiltration.

Settings counters count logical keys, not HTTP attempts: pending includes errors, success means current revision read back and ACKed, failed is the pending subset with safe error. A successful batch clears its matching revision's error. Up to 100 recent safe-code logs per organization are retained. Never log token/JWT/private key/raw Google error body or message content.

## Manual recovery procedure

1. Disable scheduled sync in Settings. Wait for any active batch/lease to finish, then snapshot D1 and spreadsheet. Do not erase source tables or the mapping.
2. Diagnose the safe code; fix network/quota/sharing/credentials or restore the exact source-tab layout.
3. Recheck access/header write when required; enable again. After backoff expires, Retry errors or Sync now schedules another bounded batch. Subsequent cron invocations drain the backlog.
4. Compare D1 logical IDs, spreadsheet mapped rows, statuses and counts. Keep failed/ambiguous records pending until verified.

## Replacement spreadsheet / full rebuild

No renderer reset destination button is exposed. An authorized operator must stop sync AND gateway writes/scheduled processing, back up D1/mappings, confirm the new spreadsheet is empty and uniquely reserved, then transactionally change this organization's spreadsheet_id, set initialized=0, verified_at=NULL, enabled=0, error=NULL, next_attempt=0, clear expired leases, and set every outbox synced_revision=0, attempts=0, next_attempt=0, error=NULL. Preserve row_index and payload/revision. Recheck the new destination, then resume source writes and sync. Never reset mappings against a populated spreadsheet. Historical exported files/revision history require separate access/retention cleanup by admin.

## Validation and live gate

Local test fixtures cover inbound/outgoing for Zalo/Facebook, missing agent, offline persistence, ambiguous timeout retry, expired-token refresh/reconnect, denied permission, quota backoff, atomic rollback, stale ACK, bounded batches, echo clearing, masked rewrite and row/header conflicts. These are not real platform/Google acceptance. Record private operator evidence of a test spreadsheet write AND readback reconciliation before claiming **LIVE SYNC PASS**. No such evidence is currently present.