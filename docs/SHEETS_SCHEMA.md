# Sheets schema and semantics

The four source tabs have exactly the following headers (case and order matter). Row 1 is the header; data starts at row 2. Values use `RAW`, never `USER_ENTERED`. Numeric timestamps are UTC Unix milliseconds; missing values are blank. Response duration is seconds. Formula-like message text remains a string, including leading `=`, `+`, `-`, `@`.

## CUSTOMERS

`customer_id, platform, platform_customer_id, customer_name, channel_account, first_seen_at, last_seen_at, total_conversations`

Logical key is the durable **customer identity ID**, not display name; one row per platform/channel identity, with the canonical customer ID exported. Customers with identical names are not merged. `channel_account` is the configured channel name. First seen is canonical customer creation time; last seen is the latest source message timestamp for the customer. Total conversations is the number of stored conversation records for this customer/channel (the current inbox stores one persistent thread, not session splits).

## MESSAGES

`message_id, conversation_id, platform, channel_account, customer_id, customer_name, direction, sender_name, sender_type, agent_id, agent_name, content, attachment_links, source_timestamp, received_timestamp, send_status, attribution_status`

Logical key and message_id are the canonical app D1 message ID, NOT an unscoped platform ID. That key exists before a send adapter is called and stays stable as delivery/attribution updates arrive. Directions are `incoming` / `outgoing`. Source timestamp comes from the message journal; received timestamp is the gateway ingestion timestamp. Pending, failed and UNKNOWN sends are exported truthfully and updated in place, not called delivered. Unknown agent ID/name is blank. Internal notes are not customer messages and are not exported. Attachment links currently blank by design.

When an early native echo is merged into the authoritative pending send, its superseded projection row is cleared (`payload=[]`) at its existing index. The mapping remains as a tombstone; no row is deleted or shifted and no original source data is deleted by Sheets sync.

## CONVERSATIONS

`conversation_id, customer_id, platform, assigned_agent, status, created_at, last_message_at, first_response_at, resolved_at, incoming_count, outgoing_count`

Logical key is conversation_id. assigned_agent is the current authenticated assignment user ID. First response is the earliest confirmed outgoing agent message at/after the first inbound in the stored conversation. Only ACCEPTED/SENT/DELIVERED/READ/SEEN qualify; UNKNOWN/FAILED/PENDING do not. Incoming/outgoing counts count stored messages, including unsuccessful outgoing attempts; distinguish these from `messages_sent`. resolved_at tracks the latest transition to RESOLVED after Phase 05 migration; historical resolved timestamps are unknown/blank, and reopening clears it.

## AGENT_REPORTS

`agent_id, agent_name, platform, period, conversations_assigned, conversations_replied, messages_sent, average_response_time`

Logical key is JSON `[agent_id,platform,period]`, generated in SQL, scoped by organization. period is UTC day `YYYY-MM-DD`. Assignment count is distinct conversations assigned via assignment journal on that day. Replied count is distinct conversations with confirmed agent messages that day. Messages sent counts confirmed outgoing agent messages on that day (ACCEPTED does NOT mean delivered). Average response time is the mean, per conversation/agent/day, from the conversation's first inbound to that day's earliest confirmed reply by that agent, excluding negative/missing intervals. It is not an SLA/business-hours or per-turn metric. Native unknown-agent messages are not assigned to an agent report. Historical assignments unavailable before the journal remain unknown, not inferred.

## Storage / safety

`sheets_outbox` stores organization, tab, logical key, materialized payload, immutable row index, revision, synced_revision, attempts, next_attempt and safe error. SQL triggers create/update these in the **same transaction as source writes**. Equal payload does not increase revision. Migration backfills existing source data once without remote API calls. A stable per-organization/tab row allocation and UNIQUE constraint prevent duplicate row index allocation. Revision CAS on ACK prevents an in-flight batch from swallowing newer source changes.

Default masking blanks customer platform ID/name in CUSTOMERS and customer/sender name, content and attachment links in MESSAGES. Internal customer/message IDs and channel names remain so reports can join; this is pseudonymization, NOT anonymization (legacy IDs may encode platform identity). Do not share exports publicly even with masking. Enabling masking rewrites existing rows asynchronously; until backlog is confirmed, old visible values may remain. Google history/downloads are not purged.

Users/assignment changes refresh relevant reports. Platform/channel metadata renames and identity editing need controlled re-projection if performed outside supported inbox paths. Aggregate triggers scan related source records and require scaling validation before large production deployments.