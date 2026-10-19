# License integration Phase 1 — local security patch

Date: 2026-10-19. Status: PARTIAL; NOT production-ready.

## Approval boundary

The supplied V1 commercial policy is explicitly conditional on product-owner approval.
No explicit approval was assumed. No 3-device/3-agent/1-channel defaults, first-activation
expiry policy for newly purchased ACTIVE licenses, entitlement API, tenant binding,
Gateway enforcement, or desktop onboarding have been enabled.
Only local security fixes and tests were implemented. No production data, environment
files, issued Tool Codes, migrations, deployment or installer releases were changed.

## Files changed by this task

Under `D:\cv\veo3theaderd\pvhmedia\apps\server\`:

- `src/controllers/redisLicense.controller.ts`: redacted cache/DB hit logs; reject
  expired/invalid ACTIVE expiry before activation; conditional expiry updates;
  use compare-and-swap for registration in both validation and activation;
  remove raw exception details from validation/activation responses.
- `src/services/licenseDevice.service.ts` (new): conditional single-document update
  matching status, expiry, quota, identity, product/project, duration and session snapshot.
  Existing limits and expiry are preserved; PENDING retains its existing activation-time
  expiry semantics. Contention fails closed rather than overwriting another claim.
- `src/cache/license.cache.ts`: remove raw Redis error objects from logs.
- `src/services/paymentService.ts`: redact issued license from payment log.
- `src/services/orderService.ts`: redact revoke exception details in refund log.
- `create-license.js`, `create-veo3-license.js`, `register-test-account.js`:
  redact license/password output and exception details. Scripts were NOT executed.
- `migrate_and_clear_cache.js`: redact key and raw error output; NOT executed.
- `list-keys.js`: show record ID rather than license key; NOT executed.
- `src/services/licenseDevice.service.test.ts` (new).
- `src/services/licenseDevice.integration.test.ts` (new).
- `jest.license-security.config.js` (new isolated unit config).
- `jest.license-device-integration.config.js` (new disposable MongoDB config).

This report: `D:\cvvui\PVH Omnichannel Manager\docs\LICENSE-INTEGRATION-PHASE-1.md`.

Existing uncommitted certificate-related files and route changes were present before
this task. They were not overwritten or claimed as changes made here.

## API before / after

No new routes or request fields. Existing success response shapes remain.

- ACTIVE activation formerly could succeed past expiresAt; it now denies with HTTP 403.
- Conditional activation conflicts return HTTP 409 and success:false; caller must retry
  deliberately after revalidation. This is a behavioral change, not a transparent retry.
- Conditional validation conflicts return HTTP 200, valid:false,
  status:device_limit_or_state_changed. No device is silently admitted.
- Expiry boundary uses <= server time; malformed ACTIVE expiry fails closed.
- Validation/activation server-error responses no longer include exception.message.
- Successful MongoDB validation invalidates cache rather than repopulating an ACTIVE
  snapshot that could race with renewal/revocation.
- Legacy Redis TTL remains unchanged. This patch does NOT provide immediate revocation
  when Redis invalidation fails, nor eliminate every stale-cache race.
- POST /validate remains mutating and is NOT suitable for periodic entitlement checks.
- TOOLEDIT_CERTIFICATE audience remains unchanged; not accepted as Omnichannel authority.

## Test results

PASSED:

- New isolated security suite: 16 tests.
- New disposable actual MongoDB suite: 3 tests. Eight concurrent ACTIVE or PENDING
  contenders admit exactly one device at quota 1; existing subdocument session refresh
  works; stale snapshots cannot overwrite revocation.
- Existing certificate suites: 12 tests (controller tests mock underlying activation).
- Downloader license-validation/license-date: 9 tests; source unchanged.
- Server TypeScript --noEmit: exit 0.
- node --check for five edited management scripts: exit 0 each.

No test failures in these executed suites. Total: 40 tests.
Downloader emitted the existing Vite CommonJS API deprecation warning.

BLOCKED: enabling commercial V1 entitlement policy pending explicit approval.

NOT_TESTED: complete server/Downloader regression, production API compatibility,
cross-process fault/load testing, Gateway quota enforcement, entitlement invalidation,
Google Sheets worker policy, desktop license onboarding, QR recovery, Windows installer,
live activation/login/provider send/receive.

The source scan covered application source and server management scripts (excluding
dependencies/generated builds), including direct console interpolation and console.table.
It is not proof that all indirect error objects, request URLs, telemetry or reverse-proxy
logs are secret-free. In particular the existing key-bearing revoke URL needs a separate
access-log review before staging traffic.

## Downloader impact

No Downloader source changes, migration, new Tool Code or changed stored expiry/quota.
Its existing license unit tests pass, but they mock HTTP and do not prove end-to-end
compatibility. Under concurrent registration it may receive a new denial/conflict;
verify user-facing retry behavior on staging. Scripts no longer print handover credentials;
use the existing authorized credential delivery flow, not terminal logs.

## Contract and migration proposal — not implemented

PVH Media should own purchased entitlement and owner identity; Gateway should own
memberships, inbox grants and usage counts. The binding must be server-verified and
idempotent; a supplied key is not proof of customer ownership.

After approval, define an additive entitlement/binding record with stable product/license/
owner references, one organization binding, approved quota snapshot, status and revision.
Existing License has maxDevices, expiresAt and status, but no full organization entitlement.
Do not synthesize missing product IDs or limits from the product name.

The requested contractVersion, entitlementId, licenseId, productId, ownerId,
organizationBinding, status, expiresAt, deviceLimit, agentLimit, zaloLimit,
facebookLimit, googleSheetsEnabled, revision, checkedAt and validUntil require that
schema and policy first. No endpoint with fabricated fields was created.

Use a read-only server endpoint with separate scoped service authentication and key
rotation; never a KEY_MANAGER/admin JWT, Tool Code secret, or desktop-provided role.
Cache at most 60 seconds and not beyond expiry; authenticate invalidation events,
retry delivery, prevent stale in-flight results overwriting revocation, and recheck
before sends/lease renewal/Sheets jobs. Preserve RBAC as a separate mandatory gate.
Expired read-only behavior must explicitly cover queued sends, inbound ingestion,
history access and exports. No SQLite deletion.

No schema/migration was created or run. Cross-store binding needs recoverable orchestration,
not an assumed transaction spanning MongoDB and D1.

## Local rerun (no production)

Working directory: `D:\cv\veo3theaderd\pvhmedia\apps\server`.

```powershell
.\node_modules\.bin\jest.cmd --config jest.license-security.config.js --runInBand
.\node_modules\.bin\jest.cmd --config jest.license-device-integration.config.js --runInBand
.\node_modules\.bin\jest.cmd --config jest.certificate.config.js --runInBand
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
```

Working directory: `D:\cvvui\DowloadvideoPVH`.

```powershell
.\node_modules\.bin\vitest.cmd run tests/license-validation.test.ts tests/license-date.test.ts
```

MongoDB tests use MongoMemoryServer and no dotenv/app import. They fail rather than
fall back to a remote database. They may require the test MongoDB binary locally.

## Staging and manual acceptance (not executed)

1. Review this diff together with pre-existing certificate changes separately.
2. Approve or revise commercial policy; specify device definition, replacement/reset,
   renewal rules, offline grace, revocation SLA and expired inbound/job behavior.
3. Use isolated staging MongoDB/Redis/D1 and dedicated secrets. Never copy production
   license records or run existing provisioning/migration scripts as part of these tests.
4. Run complete regression, mixed validate/activate races, repeated same-device races,
   concurrent renewal/revoke, cache outage and old-client behavior.
5. Complete approved entitlement contract, then Gateway and desktop integration with tests.
6. Use authorized staging identities to verify activation, membership, read-only expiry,
   tenant separation, quotas, QR failure cleanup and real provider send/receive.
7. Build/sign/test installer only after integration acceptance. No production release
   until clean-install/upgrade/uninstall and live-provider results are recorded.