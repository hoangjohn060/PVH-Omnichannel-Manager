# Phase 07 — Low-spec performance

## Scope and verdict

Measured on the available physical Windows host: Intel Core i7-5500U @ 2.40 GHz, 4 logical CPUs, 12,544,638,976 bytes RAM, Windows 10 Home 10.0.19045. Evidence timestamps are UTC on 2026-10-19 (host local UTC+07). GPU model, active GPU selection, power plan, thermal state, storage placement and Windows 11 behavior: NOT_MEASURED. No before/after baseline was retained: do not claim a percentage improvement.

**Local functional validation passes; full performance acceptance remains OPEN.** Short, empty-database idle measurements are not representative of several connected accounts or hours of use.

## Reproducible measurements

Workspace root: `D:\cvvui\PVH Omnichannel Manager`. Run commands there:

```powershell
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd test:gateway
pnpm.cmd build
pnpm.cmd exec playwright test
pnpm.cmd --filter @pvh/desktop dist:win
pnpm.cmd test:packaged
pnpm.cmd audit --json
```

Raw evidence:
- `D:\cvvui\PVH Omnichannel Manager\artifacts\phase07-electron.json`
- `D:\cvvui\PVH Omnichannel Manager\artifacts\phase07-electron-packaged.json`
- `D:\cvvui\PVH Omnichannel Manager\artifacts\phase07-database.json`
- Root logs `phase07-typecheck.log`, `phase07-unit.log`, `phase07-gateway.log`, `phase07-build.log`, `phase07-e2e-final.log`, `phase07-packaged.log`, `phase07-dist.log`.

Electron measurement: launch to visible workspace, wait 5 seconds, prime `app.getAppMetrics()`, then sample over 10 seconds. Visible dashboard, empty local database, no authenticated live connectors. Playwright/VS Code and OS activity can affect results. Memory values returned by Electron are KiB, converted to MiB below. Sum of working sets may double-count shared pages; private bytes are also reported, not substituted for physical RAM. CPU is the sum of Electron-reported process percentages, not a separately collected Task Manager counter.

| Metric | Source production build | Packaged executable |
|---|---:|---:|
| Main process working set | 123.70 MiB | 138.38 MiB |
| Renderer working set | 102.19 MiB | 105.06 MiB |
| GPU process working set | 85.00 MiB | 86.77 MiB |
| Network utility working set | 46.43 MiB | 46.31 MiB |
| Summed working sets | 357.32 MiB | 376.51 MiB |
| Summed private bytes | 197.74 MiB | 217.82 MiB |
| Summed reported idle CPU | 0.1338% | 0.0902% |
| Launch to visible workspace, one sample | 1882.66 ms | 1994.07 ms |
| Simulated burst + route remount + last-row visibility | 436.07 ms | 452.95 ms |
| Separate DB/Zalo worker memory | NOT_MEASURED | NOT_MEASURED |

DB and connector workers use `worker_threads`, not separate OS processes. Their RSS is included in the main PID; isolated heap/memory attribution is NOT_MEASURED. Do not report the entire main RSS once for every worker. The renderer scenario returns 200 then 300 synthetic messages via a test-process-only fetch fixture. Less than 40 articles are mounted and the last variable-height message remains reachable. This is NOT a measured real-provider delivery latency, not a 10,000-row IPC response, and not a live 100-event roundtrip.

SQLite test: file-backed temporary database, real better-sqlite3 under Node 24.21.0, WAL, synchronous FULL; 10,000 seeded messages across 100 threads; 100 new messages plus 20 duplicates; indexed per-thread reads (101 rows each), including JSON decoding and assertion overhead:

| Metric | Measurement |
|---|---:|
| Seed 10,000 | 2870.18 ms |
| Burst 100 + 20 duplicates, two transactions | 80.76 ms |
| Query p50 / p95, 100 reads | 0.80 / 1.00 ms |

These DB times do not include Electron IPC, WAN, D1, Sheets or UI. Query plan confirms `idx_zalo_messages_thread`.

## Target status

The source column uses the final isolated rerun (`phase07-performance-verified.log`, UTC 00:48:01); packaged uses the full packaged suite sample. Earlier source samples varied (approximately 1.47–2.14 seconds startup); this is not a statistical startup percentile.

| Target | Status |
|---|---|
| Idle RAM below 500 MB | OBSERVED below threshold in the short empty-DB samples only; connected-account acceptance NOT_MEASURED |
| Idle CPU below 5% | OBSERVED below threshold in the short samples only; sustained connected idle NOT_MEASURED |
| Fast startup / no multi-second UI stalls | Startup measured above; cold boot, p95 startup and worst-case UI stall NOT_MEASURED |
| No freeze with 100 incoming events | Local batch and simulated timeline tests PASS; live end-to-end NOT_MEASURED |
| No long-running memory leak | NOT_MEASURED; no multi-hour soak or heap-snapshot trend |
| No full-history sync every launch | Cursor persistence and bounded history tests PASS; live initial-sync volume NOT_MEASURED |

## Implemented changes

- Five secondary screens use React lazy/Suspense and separate build chunks; dashboard stays eager.
- Variable-height timeline virtualizes DOM, measures visible rows with ResizeObserver, overscans, disconnects observers and prunes discarded height keys. No truncation of message content. Existing cursor-based older-history API and 350 ms search debounce retained.
- Inactive React Query results have 60-second GC. User-requested older pages still occupy memory while the conversation remains open; unlimited historical traversal is not a proven bounded-memory workload.
- Connector worker batches normalized incoming messages at 25 ms / 100 items. DB worker handles atomic batch transactions, with cached prepared statements. Stop flushes final queued messages; abrupt process/worker termination before persistence still has an uncommitted delivery window. This is not a zero-loss claim.
- Renderer `zalo:changed` notifications coalesce over 100 ms, with shutdown cleanup. Existing backed-off polling retained; no new high-frequency network interval.
- SQLite: suggested 8 MiB page cache, mmap disabled, WAL autocheckpoint at 1000 pages, 16 MiB journal retention limit, queued PASSIVE checkpoint every five minutes and final TRUNCATE on clean close. WAL can temporarily exceed retention settings while readers pin pages. FULL durability retained. No periodic VACUUM or FTS5 added without a demonstrated query need.
- DB RPC rejects requests after worker failure and caps pending calls at 512. Queue rejection is explicit, not silent loss or unlimited RAM growth; provider replay after overload remains a live-validation concern.
- One ordinary main window and temporary startup splash retained; no per-account BrowserWindow. Existing workers are threads, not process-isolated connectors.
- Hardware acceleration left enabled. No CUDA, local AI or 3D processing introduced. GPU affinity and driver failure diagnosis NOT_MEASURED.

## Media and storage policy

Customer attachments remain metadata-only. No automatic external image/video download, no video preload, and no attachment cache deletion added. Thus thumbnails, file-cache quota/TTL, controlled downloads and HDD archive selection are NOT_IMPLEMENTED, not falsely reported as optimized. Existing avatar downloads have HTTPS host allowlist, no redirects, timeout and 350 KB streamed size cap. Avatar resize/decompression-bomb validation is not proven. QR/avatar data are the only image previews.

Never treat the SQLite database, WAL, backups, auth/session files, connector outboxes or future attachment archive as temporary cache. Do not relocate live database files to HDD or delete WAL while app is running. Future archive/cache implementation must separate original attachments from regenerable thumbnails, enforce canonical paths, quotas and atomic archive writes, and test cleanup against originals.

## Installer

Rebuilt existing version 0.6.0 (not a new public release):
`D:\cvvui\PVH Omnichannel Manager\apps\desktop\release\PVH-Omnichannel-0.6.0-x64-Setup.exe`

- 117,001,755 bytes (~111.58 MiB).
- SHA-256: `2C0CA734F85E4F4175ACF138DC1A9A08FE027932F90B8CA0B16B7728F65BCD19`.
- Authenticode: **NotSigned** despite builder printing signing steps.
- Clean-machine install/upgrade/uninstall: NOT_MEASURED. Version bump, signing and lifecycle validation required before distribution.

## Remaining benchmark protocol

On authorized test accounts, repeat cold/warm start at least 10 times; sample all process CPU/memory every 5 seconds for 4–8 hours with 100 recent conversations, 10,000+ messages, several actual connectors, repeated navigation/search/older-page loading, 100-event bursts and network reconnects. Capture p50/p95/p99 event-to-paint, longest renderer task, DB/worker heap snapshots, disk/WAL/cache growth, and whether RAM returns after navigation/idle. Repeat packaged on Windows 10 and 11, AC and battery. Do not claim leak freedom from stable RSS in a ten-second sample.

Reference interpretation: Electron official MemoryInfo, CPUUsage and ProcessMetric documentation; security controls follow its official Security checklist. Current upstream docs can differ from installed Electron 44.9.0; runtime evidence is authoritative for this build.