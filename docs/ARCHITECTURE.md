# Kiến trúc Phase 01

```text
React renderer (sandbox)
  -> contextBridge DesktopApi (fixed method names)
  -> Electron IPC handlers (trusted sender + Zod)
  -> DatabaseClient request queue
  -> worker_threads / better-sqlite3 / userData
```

Main chịu trách nhiệm vòng đời Windows, tray/menu, notifications, startup và secrets. Renderer không import Electron hoặc Node; không truy vấn SQLite trực tiếp. Worker tuần tự hóa cả backup async để tránh đóng database khi backup chưa xong. Write settings + audit dùng cùng transaction.

Shared TypeScript được bundle vào main và worker; không dựa vào Node load TypeScript trong ASAR. Native `.node` được unpack ra `app.asar.unpacked`. Preload sandbox được bundle thành CJS chỉ require Electron.

`local_settings` chứa preferences và geometry. Các bảng cache/sync chưa có dữ liệu giả. Phase sau phải triển khai adapter hợp pháp qua gateway, auth/RBAC, token lifecycle, idempotency, retry/backoff và repository pagination. Không dùng Playwright hoặc Chromium để login Facebook.

Tên thư mục gốc đang là `PVH Omnichannel Manager` theo workspace có sẵn; bên trong giữ monorepo apps/packages/scripts/docs/tests như yêu cầu.