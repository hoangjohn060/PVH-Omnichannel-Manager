# Phase 05 update — desktop v0.5.0

Settings > Google Sheets exports gateway D1 projections to four dedicated tabs through Google Sheets API v4. Admin-owned Service Account credentials/token stay AES-GCM encrypted in backend D1, never in the EXE. Transactional SQL outbox, durable row mapping, RAW batch range writes, readback reconciliation, revision checkpoints, bounded sequential processing and backoff are implemented. No values.append and no Sheets message queue.

**LIVE SHEETS SYNC IS BLOCKED / NOT VERIFIED** until an operator writes a real test spreadsheet and reconciles it. No Google credentials, remote deployment or live spreadsheet evidence were supplied. Attachment links deliberately remain blank; masking is enabled by default. Dedicated source tabs must not be manually sorted/inserted/deleted. This is not a complete production acceptance.

Setup and schema/recovery:
- `D:\cvvui\PVH Omnichannel Manager\docs\GOOGLE_SHEETS_SETUP.md`
- `D:\cvvui\PVH Omnichannel Manager\docs\SHEETS_SCHEMA.md`
- `D:\cvvui\PVH Omnichannel Manager\docs\SYNC_RECOVERY.md`
- `D:\cvvui\PVH Omnichannel Manager\docs\PHASE-05-VALIDATION.md`

Apply gateway migration `0003_sheets.sql` after 0001/0002 before starting Phase 05. Existing Phase 04 inbox/connector/live-platform limitations below remain applicable.

# Phase 04 history — desktop v0.4.0

Unified Zalo/Facebook inbox and employee management now run inside the Windows app. D1 membership/RBAC and explicit inbox grants authorize requests server-side; sender attribution uses the authenticated principal, with unknown native sender identities left unknown. Durable send jobs, idempotency/version conflict checks, per-user drafts/reads, tags, notes, assignments, statuses, audit and bounded keyset history are implemented.

**Live remains BLOCKED.** No gateway has been deployed or real platform account verified by this phase. Configure real HTTPS/D1, individual credentials, channel grants and exactly one operator-registered Zalo connector host before live verification. No production fixture messages. Unified composer supports text/emoji; media preview/upload/quote, manual customer linking, full employee SSO and production hardening remain incomplete.

Current Phase 04 setup, limits and live checklist:
- `D:\cvvui\PVH Omnichannel Manager\docs\PHASE-04-INBOX.md`
- `D:\cvvui\PVH Omnichannel Manager\docs\INBOX_LIVE_TEST.md`
- `D:\cvvui\PVH Omnichannel Manager\docs\PHASE-04-VALIDATION.md`

The Phase 03/02 descriptions below are historical. Direct sends in connector screens are now disabled; use the authorized unified inbox. Zalo original journal/session stays local, with authorized message projections synchronized to gateway D1. Apply both gateway migrations before launching v0.4.0. AGENT/VIEWER must receive explicit grants; old organization-wide agent visibility is no longer permitted.

# Phase 03 history — desktop v0.3.0

Facebook Fanpage is integrated into the existing app, including Settings > Facebook Fanpage. Shared Cloudflare Workers/Hono/D1 gateway implements OAuth, encrypted server-side tokens, verified durable webhooks, Page isolation, authenticated employee sends and Graph permission/token/subscription checks. No separate admin website or browser automation.

**Live Meta is BLOCKED** pending real App credentials, public HTTPS deployment, owned authorized Page/test users and applicable review. No test fixture is a real Connected Page. Latest 200 conversations/messages are shown; public HTTPS media URLs can be sent, but local file upload and inbound media preview are not implemented.

Current authoritative Phase 03 setup, security boundaries and validation:
- `D:\cvvui\PVH Omnichannel Manager\docs\META_APP_SETUP.md`
- `D:\cvvui\PVH Omnichannel Manager\docs\META_PERMISSIONS.md`
- `D:\cvvui\PVH Omnichannel Manager\docs\FACEBOOK_LIVE_TEST.md`

Run `pnpm typecheck`, `pnpm test`, `pnpm test:gateway`, `pnpm test:e2e`, `pnpm test:packaged`. Gateway scripts: `pnpm --filter @pvh/gateway build` (dry run), `db:local`, `db:remote`, `deploy`. Deployment and credential provisioning must be performed by an authorized operator; no remote resource was created during implementation.

Facebook credentials/messages live in gateway D1, not desktop SQLite; Zalo retains its separate local storage/session model. The historical Phase 01 gateway/auth statements below describe that earlier phase and are superseded by the Phase 03 documents above. Full employee SSO, public Meta compliance/deletion workflows and production acceptance are not complete.

# PVH Omnichannel Manager — Phase 02

## Zalo QR connector (v0.2.0)

Tiếp nối nền tảng Phase 01. `zca-js@2.2.0` chạy trong worker, QR thật hiển thị ngay trong ứng dụng; session mã hóa safeStorage ở main; SQLite migration v2; trạng thái kết nối, disconnect/reconnect, hội thoại và gửi text qua SDK.

**Đã thử QR thật trên Windows và EXE đóng gói. Chưa xác minh login/inbound/outbound bằng tài khoản thật — BLOCKED vì chưa có người quét bằng tài khoản tự sở hữu.** Không coi unit fixtures là live PASS.

Xem `docs/PHASE-02-ZALO.md` và `docs/PHASE-02-VALIDATION.md` để biết giới hạn media, gateway và ownership giữa nhiều máy. Các mô tả Phase 01 bên dưới là nền tảng kế thừa, không thay thế báo cáo Phase 02.

Một ứng dụng Electron Windows x64, App ID `com.pvhmedia.omnichannel`. Không phải Next.js; không cần Docker, PostgreSQL, model AI hay trình duyệt ngoài.

## Chạy trên Windows

Yêu cầu Node.js 24 x64 và pnpm 10. Lockfile được commit cùng source. Tại thư mục gốc:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` khởi động Vite nội bộ và một Electron, không mở tab Chrome. Splash chỉ tồn tại lúc khởi động; sau đó chỉ còn một BrowserWindow chính.

```powershell
pnpm typecheck
pnpm test
pnpm test:dev
pnpm test:e2e
pnpm pack:win
pnpm test:packaged
pnpm dist:win
```

EXE chạy trực tiếp: `apps/desktop/release/win-unpacked/PVH Omnichannel Manager.exe`. Phải giữ toàn bộ thư mục `win-unpacked`, không tách riêng EXE. Installer NSIS nằm trong `apps/desktop/release` sau `dist:win`.

## Những gì có trong Phase 01

- Single-instance, splash, tray Windows, menu tiếng Việt, thông báo Windows.
- Tùy chọn minimize-to-tray, chạy nền khi đóng, khởi động cùng Windows; mặc định tắt.
- Lưu kích thước/vị trí/maximized, trang đang mở và theme; khôi phục sau restart.
- React/Vite + Tailwind, các primitive shadcn-style dùng Radix, Zustand, TanStack Query; light/dark/system; loading/error/empty/toast/confirmation.
- SQLite worker: WAL, foreign keys, migration versioned, 9 bảng ban đầu, indexes, transaction, backup khi mở và mỗi 24 giờ nếu ứng dụng còn chạy, giữ tối đa 7 bản.
- Contract Zalo/Facebook/Auth/Sheets/Gateway/MessageRepository/CustomerRepository. Tích hợp chưa kết nối, không giả dữ liệu sản xuất.
- Gateway skeleton chỉ có `/health`; không được triển khai lên Cloudflare và không lưu secrets.

## Dữ liệu và bảo mật

`app.getPath('userData')/pvh.sqlite`; backup trong `userData/backups`, log lỗi main trong `userData/desktop.log`. Không ghi dữ liệu người dùng vào Program Files. Test dùng thư mục tạm riêng qua `PVH_USER_DATA`.

Renderer sandbox, contextIsolation=true, nodeIntegration=false. Preload chỉ expose API có tên cố định; IPC main kiểm tra sender/frame và input Zod strict. Không có generic invoke, Node API, remote module, webview hoặc mở URL tùy ý. Navigation/popups/permissions bị chặn. CSP production không cho connect; CSP dev chỉ mở thêm HMR và script inline do Vite React Refresh yêu cầu.

Secrets chỉ xử lý ở main bằng Electron safeStorage (Windows OS encryption). Đây là boundary cho phase sau, chưa có token thực được lưu. SQLite cache không được mã hóa toàn bộ; không coi SQLite là kho mật khẩu. Chưa có auth/RBAC nên chưa dùng cho dữ liệu nhạy cảm production.

## Native SQLite

better-sqlite3 13.0.3 có prebuild Node-API Windows x64. pnpm không chạy implicit node-gyp cho package này vì máy test không có Visual Studio C++ Build Tools. Thay vào đó postinstall và beforePack bắt buộc load binary, mở SQLite và quick_check **bằng runtime Electron**, fail nếu không tương thích. Không phải bỏ qua kiểm tra native module.

`npmRebuild=false` là chủ ý cho prebuild Node-API đã kiểm chứng. Khi đổi phiên bản Electron/SQLite hoặc chuyển sang module dùng V8 ABI, chạy lại probe và test EXE; có lệnh `pnpm --filter @pvh/desktop native:rebuild` dùng electron-builder install-app-deps nếu cần rebuild và máy đã cài Desktop development with C++.

## Phạm vi xác minh

Xem `docs/PHASE-01-VALIDATION.md`. EXE chưa được ký bằng chứng thư tin cậy. Chưa xác minh SmartScreen, Windows 11, login sau reboot, giao diện toast Windows thực tế, phục hồi backup và benchmark trên đúng i7-5500U/12GB/930M. Không tuyên bố đã production-ready chỉ từ build frontend.
# PVH-Omnichannel-Manager
