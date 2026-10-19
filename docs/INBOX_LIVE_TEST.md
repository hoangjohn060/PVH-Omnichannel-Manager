# Phase 04 manual live integration — BLOCKED

No live execution claimed. Requires deployed HTTPS gateway/D1 with migrations 0001+0002, real authorized Meta Page/test people, real owned Zalo account on one connector host, individually provisioned users in two organizations and documented permissions/review. Automated fixtures are not evidence for this checklist.

Record UTC time, app/gateway version, redacted message/request IDs, operator and observed result. Never store tokens, bearer credentials, QR material, passwords or customer content in reports.

1. **BLOCKED** — Apply migration to staging copy of existing history; verify customer/message counts, unknown native attribution and history backfill. Record duration and rollback/backup procedure.
2. **BLOCKED** — Connect real Zalo on its single Windows host, register its local UUID to the correct org/connector principal, grant AGENT A/B and VIEWER access. No other desktop starts that SDK listener.
3. **BLOCKED** — Customer sends Vietnamese text/emoji to Zalo. Verify one incoming row, correct inbox identity, unread and list preview, source timestamp and native attribution. Duplicate event does not overwrite text.
4. **BLOCKED** — Complete Meta checklist in `D:\cvvui\PVH Omnichannel Manager\docs\FACEBOOK_LIVE_TEST.md`. Receive a real Page message; verify it appears in the same inbox UI with correct Page and no cross-Page merge.
5. **BLOCKED** — A/B send via inbox on both platforms. Compare actual recipient and platform ID. Verify database principal attribution, durable pending before platform call, ACCEPTED/SENT distinct from delivery/read, and audit.
6. **BLOCKED** — Both users operate the same version concurrently. One succeeds, stale send/assignment gets conflict. Same request UUID replay never sends twice; different agent cannot reuse it. Refresh intentionally before a second distinct send.
7. **BLOCKED** — VIEWER direct API write and old connector send IPC are denied; no send button. Revoke AGENT grant/membership while app is open and while Zalo job is queued; next backend request/claim must deny/cancel, not send.
8. **BLOCKED** — Two organizations use real distinct credentials. Test guessed conversation/customer/channel/job IDs, notes, tags, drafts, changes, attachments and legacy Facebook routes: no foreign data or mutation.
9. **BLOCKED** — Transfer assignment A→B, close/reopen (OPEN/PENDING/RESOLVED), leave internal note, edit tags/care notes. Confirm note never reaches platform, actor audited, stale version rejected.
10. **BLOCKED** — Reply from native Zalo/Business Suite outside PVH. Do not infer A/B from time/name. Known platform message without correlation must remain unknown agent; acknowledge SDK may not emit every native Zalo event.
11. **BLOCKED** — Staging fault injection only: known pre-send rejection → FAILED and manual retry; platform timeout / missing confirmation → UNKNOWN and no auto/manual blind retry. Compare recipient before operator reconciliation. Late receipt/echo must not duplicate/regress the message.
12. **BLOCKED** — Restart connector/app around claimed send, result persisted, upload ACK lost; verify durable outbox/results, idempotent result ACK and UNKNOWN recovery without retransmission. Stop connector: pending job stays visibly pending, never sent.
13. **BLOCKED** — Read/unread per employee, draft switch/restart, search/filter, >50 conversations/messages, delayed events, hidden window, disconnect/network backoff. Verify no full-history fetch and reasonable CPU/network on real scale.
14. **BLOCKED** — Facebook beyond 24 hours: backend denies, job/message remains failed, no exception tag or Messenger Web fallback. Customer media remains safe metadata; unsupported upload/preview/quote must not pretend to work.

Do not mark Phase 04 production-ready until these checks and outstanding security/compliance gates pass with recorded evidence.