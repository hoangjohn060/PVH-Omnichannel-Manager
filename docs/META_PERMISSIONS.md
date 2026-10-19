# Meta permissions — Graph v26.0

Reviewed 2026-10-18 against the official permission reference, Messenger webhook documentation and standard messaging-window documentation. Exact dashboard approval and Page task eligibility must still be verified against the real Meta App; no credentials were supplied.

| Permission | Why requested | Runtime verification |
| --- | --- | --- |
| `pages_show_list` | List only Pages the authorizing person grants to this app via `/me/accounts` | Scope inspection; candidate IDs originate only from paginated Graph results |
| `pages_messaging` | Receive/respond to Messenger conversations for selected Page | Page token debug scopes/targets, Page identity and Send API response |
| `pages_manage_metadata` | Install/check/remove Page webhook subscription | Scope inspection and selected Page `/subscribed_apps` POST/GET |

No `email`, `public_profile`-specific data retrieval, `business_management`, ads, insights, Page feed/content management or engagement-reading permission is explicitly requested. Facebook Login may include its own mandatory default identity permission; PVH does not expand its use. Do not add unrelated scopes to make a failing request appear fixed.

The Page subscription documentation requires a Page token requested from a person able to perform the applicable `MODERATE` task and the messaging/metadata permissions. Returned Page tasks are displayed in OAuth candidate metadata, but no local task-name assumption overrides actual Graph authorization. A missing/denied scope, wrong token app/Page, revoked/expired token or failed subscription blocks connection. Granular target IDs are checked when present.

Standard Access is for eligible app-role/testing scenarios. Advanced Access for people without an app role requires the applicable App Review; Meta also documents business verification for Advanced Access. Deployment, Meta review and business verification are separate gates, not a unit-test result.

## Messaging policy enforcement

- Only standard `messaging_type: RESPONSE` is implemented.
- Reply window is **less than 24 hours from a verified non-echo incoming message timestamp**, checked server-side. Echo, read, delivery and arbitrary renderer input cannot open it. Future event timestamps do not extend it.
- This implementation is deliberately conservative: postbacks/other qualifying actions do not extend the local window yet. Postback webhook subscription does not mean the app assumes all postbacks permit a response.
- Outside the window, the gateway returns `MESSAGING_WINDOW_CLOSED`; no automatic tag, HUMAN_AGENT claim, utility template, private reply, sponsored send or one-time-notification exception is used.
- Text and HTTPS public image/file URLs are sent via official Send API. Meta fetches the attachment URL; the gateway does not proxy/download it. UI accepts owned public media URL; desktop file upload and inbound preview are not implemented. Operator must comply with Meta media limits/content rules and avoid private/signed sensitive URLs.
- `ACCEPTED` means Meta returned a message ID. Only webhook receipts produce `DELIVERED` / `READ`. External echoes have `agent_id=null`; authenticated PVH sends retain the verified credential holder's employee ID.

Sources:
- https://developers.facebook.com/docs/permissions/
- https://developers.facebook.com/docs/messenger-platform/webhooks/
- https://developers.facebook.com/docs/messenger-platform/send-messages/
- https://developers.facebook.com/docs/graph-api/changelog/