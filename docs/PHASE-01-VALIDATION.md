# Phase 01 — Kết quả xác minh 18/10/2026

## Môi trường đã chạy

- Windows 10 build 19045 x64; Node 24.21.0; pnpm 10.34.7.
- Electron 44.9.0; native ABI 149; Node-API 10.
- better-sqlite3 13.0.3; SQLite 3.53.4; Windows x64 prebuild.
- Không có Visual Studio C++ Build Tools. Chưa xác minh đây chính là máy i7-5500U / 12 GB / 930M mô tả trong yêu cầu.

## PASS

| Kiểm tra | Kết quả |
| --- | --- |
| pnpm install sau cấu hình prebuild + runtime probe | PASS |
| pnpm typecheck (desktop, gateway, tests) | PASS |
| Vitest | 7/7 PASS |
| Build main/preload/worker/renderer | PASS |
| pnpm test:dev | PASS: pnpm dev mở Electron, React render, điều hướng, không lỗi console |
| E2E source Electron | 1 scenario PASS, bao gồm đóng/mở lại |
| electron-builder Windows x64 | PASS |
| NSIS installer build | PASS, 116138406 bytes ở lần build xác minh |
| E2E packaged Windows EXE | 1 scenario PASS, 18.5 giây |
| Native module trong EXE đóng gói | PASS: worker SQLite khởi động, quick_check=ok |
| Single-instance | PASS: process thứ hai thoát, chỉ một cửa sổ chính |
| Minimize-to-tray / close-to-background | PASS: cửa sổ ẩn, process và SQLite vẫn chạy |
| Menu và 10 mục điều hướng | PASS |
| SQLite persistence | PASS: theme, route, window width và audit vẫn còn sau restart |
| WAL / foreign keys / migration version / integrity | PASS |
| Foreign key rejection và transaction rollback | PASS unit |
| Backup thủ công + file backup thực | PASS |
| Renderer không có require/process; API bridge cố định | PASS |
| sandbox=true / contextIsolation=true / nodeIntegration=false | PASS runtime |
| IPC ngoài allowlist, payload sai kiểu/unknown field | PASS |
| Chặn popup / external navigation | PASS; xác nhận URL và DOM qua main webContents |
| Console React | Không có pageerror hoặc console.error trong luồng kiểm thử chính |
| Production CSP | Đã kiểm tra output: connect-src none; không có script unsafe-inline |

Playwright chỉ dùng để test Electron, không dùng để đăng nhập Facebook và không cần tải thêm browser để chạy các test này.

## FAIL được phát hiện và đã sửa

1. Icon Facebook không còn export trong phiên bản lucide sử dụng → thay icon chức năng.
2. pnpm implicit node-gyp không chạy được do thiếu Visual Studio → dùng prebuild Node-API, probe Electron bắt buộc trong install và beforePack.
3. Zod partial trên schema có default reset các tùy chọn không có trong patch → schema patch riêng không có default.
4. Shared TypeScript bị externalize, packaged runtime không khởi động → bundle shared vào main/worker.
5. Hook electron-builder trỏ ngoài app root bị từ chối → entry hook nằm trong desktop/build.
6. Dev smoke truyền dấu `--` sai tầng nên thiếu CDP port → sửa lệnh smoke.
7. Playwright chờ navigation bị cancel có trạng thái pending dù main đã chặn → kiểm chứng URL và DOM bằng webContents sau thao tác.

Không có test thất bại còn mở trong các bộ đã chạy lại. Đây không phải tuyên bố mọi yêu cầu vận hành đã được nghiệm thu.

## BLOCKED / CHƯA XÁC MINH

- Chứng thư ký mã chưa được cung cấp: Authenticode xác nhận `NotSigned` cho EXE/installer. Không xác nhận SmartScreen reputation.
- Chưa chạy wizard cài đặt/gỡ NSIS trên máy sạch; chỉ build installer và chạy EXE win-unpacked.
- Chưa reboot hoặc sign-out/sign-in để kiểm chứng Windows startup thật. Code đã nối `setLoginItemSettings`, nhưng không thay đổi startup của máy người dùng trong test tự động.
- Chưa xác minh trực quan toast Windows/Focus Assist; API và nút thử thông báo đã triển khai.
- Chưa nghiệm thu thao tác click icon tray bằng chuột ngoài hệ điều hành; đã kiểm tra ẩn/hiện BrowserWindow và tạo Tray trong runtime.
- Chưa chạy trên Windows 11 và đúng cấu hình i7-5500U; chưa có số đo RAM/CPU/SSD, sleep/resume hoặc nhiều màn hình/DPI thực.
- Backup được tạo thành công; chưa có restore UI, disaster recovery hoặc kiểm thử đủ 24 giờ/rotation 7 ngày.
- Không có kết nối Zalo/Facebook/Sheets/Auth/gateway production. Tất cả hiển thị chưa kết nối; repository chỉ là contract.
- Chưa có fuzz test IPC, penetration test, code signing pipeline hoặc auth/RBAC production.

## Bằng chứng trong workspace

- `install-verified.log`, `typecheck.log`, `unit.log`, `dev-smoke.log`, `e2e.log`, `packaged-e2e.log`, `installer.log` (log bị gitignore).
- `tests/unit/foundation.test.ts`, `tests/e2e/desktop.spec.ts`.
- `test-results/packaged-settings.png`; `playwright-report/index.html` sau lần test gần nhất.
- `apps/desktop/release/win-unpacked/PVH Omnichannel Manager.exe`.
- `apps/desktop/release/PVH-Omnichannel-0.1.0-x64-Setup.exe`.

## Cảnh báo không làm test thất bại

- Vitest/Vite cảnh báo tương lai về native config loader khi file config TS dùng ESM trong root CommonJS.
- electron-builder cảnh báo duplicate references của một số dependency React/Radix; packaged runtime test đã PASS.