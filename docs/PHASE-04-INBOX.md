# Phase 04 — unified inbox and agent management

Desktop version **0.4.0**. All inbox work stays inside the existing Electron application. No Chatwoot, Messenger Web or Zalo Web redirect. Production has no fixture injection mode; transport simulators exist only in test processes.

## Implemented

- Gateway D1 migration `D:\cvvui\PVH Omnichannel Manager\apps\gateway\migrations\0002_inbox.sql`: Organization, User, Membership, ChannelConnection, Customer, CustomerIdentity, Conversation, ConversationAssignment, Message, Attachment, InternalNote, AuditEvent, per-user reads/drafts, channel change cursors and durable send jobs.
- Lowercase stored roles map to ADMIN / MANAGER / AGENT / VIEWER. Active membership is authoritative on every authenticated request; an old credential's role cannot restore a downgraded membership. Revoked/expired credentials remain rejected.
- ADMIN manages membership and connector registrations. ADMIN/MANAGER manage grants and all organization inboxes. AGENT/VIEWER need explicit per-channel grants. VIEWER reads only (may update own read watermark); cannot send, assign, draft, tag, note, retry or change roles.
- Three-column inbox: channel/inbox filters, customer/content search, 50-row keyset pagination, unread count, channel badge, preview/time, assignment/status; 50-message timeline pages, attribution, status, drafts, notes, assignment/state CAS; customer identity, tags/care notes, bounded history and first-response statistics.
- Facebook immutable journal is projected via D1 triggers, including existing history at migration. Native echoes have unknown attribution. Platform receipts update the unified message. Meta 24-hour preflight is unchanged.
- Zalo has an independent durable connector outbox including native self events, changed receipts and pre-existing local history. Electron main uploads bounded batches and claims authenticated gateway send jobs. Connector results are persisted locally before upload. One sequential connector cycle every 15 seconds, 60-second error backoff; never a concurrent timer loop.
- The renderer cannot invoke connector registration/ingest/claim/results. Old direct Zalo history/send IPC and Facebook send IPC are denied. Connector screens now direct staff to the inbox. Legacy Facebook read endpoints also enforce grants, and viewer writes are forbidden at gateway.
- Sender identity derives from gateway principal, never a renderer `agent_id`. Original content is not overwritten by duplicate inbound events. Identity is platform + connection + external ID (Page-scoped Meta identifiers must not merge across Pages).
- Outgoing message and job persist atomically before sending. Client UUID, content hash, conversation version and one-active-send constraint prevent replay/racing agents. UNKNOWN blocks a fresh send for that conversation. Only definitive FAILED jobs can be retried manually. Retry actor is audited separately from original sender.
- Facebook PENDING jobs are recovered by maintenance; interrupted SENDING jobs become UNKNOWN. Zalo ambiguous SDK errors are UNKNOWN, not retryable failures. No automatic retry after an ambiguous platform call.

## Operator setup (no remote resource deployed by this phase)

1. Complete `D:\cvvui\PVH Omnichannel Manager\docs\META_APP_SETUP.md` and Meta setup/review requirements. Real D1 ID and HTTPS origin are still operator inputs. Back up D1 before applying migration 0002.
2. From `D:\cvvui\PVH Omnichannel Manager`, run `pnpm --filter @pvh/gateway db:remote`, then deploy the Worker. Migration 0002 backfills existing Facebook messages in one migration; validate size/maintenance window against real history before production rollout.
3. Provision individual credentials using `D:\cvvui\PVH Omnichannel Manager\apps\gateway\scripts\provision-credential.mjs`. Accepted roles: `admin`, `manager`, `agent`, `viewer`. Existing credentials seed memberships once. Issuing another credential does not silently overwrite an existing membership role; use employee management for role changes.
4. Configure `PVH_GATEWAY_URL` / `PVH_GATEWAY_CREDENTIAL` only in Electron main's environment. Admin opens **Nhân viên** to configure verified employee membership and per-inbox grants. Creating a membership does not issue a bearer credential; credential issuance remains operator-only.
5. For Zalo, retain exactly one connector host/account owner. Obtain the local account UUID from the connector's main-process/local SQLite account record; do not copy session secrets. With an admin credential in the operator environment:

   ```powershell
   pnpm --filter @pvh/gateway exec node scripts/register-zalo.mjs <local-account-uuid> "Zalo bán hàng" <verified-connector-user-id>
   ```

   Connector user must be an active ADMIN/MANAGER. Run that one Windows host with its individual credential, connect the real Zalo account, grant agents access through **Nhân viên**. Other employee desktops must not start additional SDK listeners for that account. Registration is deliberately not an automatic organization-wide import of arbitrary local accounts.

## Verification boundaries

- Automated tests use isolated fixtures/simulators. D1/workerd tests execute both real migrations and routes locally; they do not prove Meta/Zalo login, cloud deployment, recipient delivery or app approval.
- Manual live checklist: `D:\cvvui\PVH Omnichannel Manager\docs\INBOX_LIVE_TEST.md`. All live claims remain **BLOCKED** pending operator evidence.
- Test commands from `D:\cvvui\PVH Omnichannel Manager`: `pnpm typecheck`, `pnpm test`, `pnpm test:gateway`, `pnpm test:e2e`, `pnpm dist:win`, `pnpm test:packaged`, `pnpm --filter @pvh/gateway build`.

## Incomplete / production gates

- Real customer avatars/profile enrichment are not fetched: initials are a fallback, not a fabricated customer photo. PSID/external ID is used when platform profile name is unavailable.
- Attachment metadata is retained/displayed safely. Unified composer is text/emoji only. Upload, safe media preview/download, and adapter-specific reply/quote are **not implemented**. Existing Graph send media support is not exposed by the unified composer yet.
- Manual identity linking/unlinking is **not implemented**; no automatic same-name merge. Conversation history is scoped to that identity/channel, bounded to 50 entries. Notes are bounded to latest 50; separate older-note/history pagination remains future work.
- First-response statistic is the first verified accepted/sent reply timestamp minus first inbound timestamp; it is not a staffing/SLA reporting engine. ACCEPTED is not delivery.
- Credential-based authentication is not a complete employee login/SSO/MFA/device-attestation system. The connector host is privileged and must be managed; root/local OS compromise is not solved by renderer RBAC. Connector control/QR administration remains a trusted operator-local workflow, not a remote staff operation.
- Same client request ID is idempotent; different intentional requests after a refreshed conversation version are not semantic deduplication. The app cannot guarantee exactly-once delivery for external platforms. UNKNOWN requires operator reconciliation; there is no unsafe “force resend” button.
- Drafts debounce 700 ms and flush on conversation unmount; unsynchronized edits can still be lost on abrupt crash/network loss. UI shows unsynced state. Multi-device simultaneous draft revision control is not implemented.
- No distributed Zalo account lease/host failover; one operator-registered local connector host is required. Separate connector service credentials, queue throughput/backpressure, rate limits, production monitoring, retention/deletion, migration at scale, Meta callbacks/review, Windows signing and clean-machine tests remain rollout gates.
- Change log retention/compaction and indexed full-text search are not implemented; query results are bounded, but content search and unread/stat aggregates still need production-scale profiling. UI stops routine changes polling while hidden and uses per-channel cursors; it does not fetch all history each cycle.