# Phase 02 — Báo cáo kiểm thử, 18/10/2026

## Kết quả bắt buộc tách riêng

| Nhãn | Kết quả | Bằng chứng / giới hạn |
| --- | --- | --- |
| SDK_TESTED | PASS trong phạm vi API/load/QR flow | zca-js 2.2.0 import được, loginQR thật chạy trong Windows worker; không phải chứng nhận toàn SDK hoạt động |
| QR_DISPLAYED | PASS | QR PNG thật được tải, ảnh naturalWidth > 100 trong Electron source và EXE ASAR; state WAITING_SCAN; hủy xóa QR thành công |
| REAL_LOGIN_VERIFIED | BLOCKED | Chưa có tài khoản tự sở hữu được người dùng quét và xác nhận |
| INBOUND_VERIFIED | BLOCKED | Chưa có live login, chưa có người gửi tin thực nghiệm; unit normalization/dedup không tính là live |
| OUTBOUND_VERIFIED | BLOCKED | Chưa có live login/người nhận đối chiếu; không gửi tin thử tự động |

Không có session Zalo thực được tạo/lưu trong các test QR; không có dữ liệu khách giả trong app production. QR không được ghi log, không chụp ảnh; test Zalo tắt trace/video/screenshot để tránh lưu vật liệu đăng nhập khi thất bại.

## PASS tự động đã chạy

- pnpm install --frozen-lockfile và Electron native SQLite probe.
- pnpm typecheck: desktop, gateway, tests strict.
- Vitest **26/26**: nền tảng cũ + SDK exports, QR transitions/invalid transitions/cancel/expiry, backoff có giới hạn, error classification, message Unicode/IDs/timestamp/metadata, account isolation, duplicate inbound, self echo, delivery không lùi, send-result validation, durable idempotency/UNKNOWN recovery, IPC injection rejection, avatar URL restriction.
- Supervisor fixtures: late event sau cancel không phục hồi listener; crash error+exit chỉ một recovery; backoff không restart ngay; duplicate listener không tự tranh; revoked session xóa credentials; failed send không lưu SENT và không gửi lại cùng requestId.
- Fixture encryption trong unit chỉ phục vụ dependency seam, **không** là bằng chứng DPAPI. E2E Electron dùng safeStorage thật đã roundtrip tiếng Việt, ciphertext không chứa chuỗi plaintext mẫu.
- Source E2E **2 PASS**, **1 skipped** (live QR opt-in). Source QR opt-in chạy riêng **1 PASS**, khoảng 7.8 giây.
- Windows EXE v0.2.0 E2E **2 PASS**, **1 skipped** (QR opt-in); gồm regression single-instance/menu/SQLite restart/tray behavior và Zalo bridge/empty state/safeStorage.
- Packaged QR opt-in chạy riêng **1 PASS**, khoảng 3.6 giây. Chỉ QR generation/render/cancel, không có scan.
- Windows x64 NSIS v0.2.0 build thành công. Chưa chạy wizard install/uninstall và chưa có code-sign certificate.

## Các lỗi/race đã sửa khi rà soát

- Duplicate crash error + exit: epoch guard kiểm tra lại khi queued handler chạy.
- Stop/crash trong lúc claim outbound: kiểm tra worker/epoch lần nữa sau SQLite trước khi gửi.
- Duplicate requestId: dùng INSERT claim + changes từ SQLite, không phụ thuộc Set trong RAM.
- Cookie refresh khi stop: chỉ capture session từ worker đang dừng, mã hóa ngay rồi đợi persistence trước khi đóng database.
- Session đã thu hồi: xóa sau khi worker đã dừng để final refresh không ghi lại session cũ.
- Dashboard/topbar phản ánh trạng thái Zalo thật thay vì hardcode 0 kênh.

## BLOCKED / PARTIAL — không tính PASS

1. Manual owned-account login, phone confirmation, real profile/avatar, session restore/revoke, inbound/outbound/delivery thực: **BLOCKED**.
2. Gửi ảnh/file, tải file, preview media: **CHƯA TRIỂN KHAI**; hiện text send và inbound image/file metadata.
3. Gateway transport: **CHƯA TRIỂN KHAI**, chỉ durable outbox; không có endpoint/token hợp lệ từ Phase 01.
4. Chặn hai máy độc lập bằng distributed ownership lease: **CHƯA TRIỂN KHAI** trước Phase 06. Local owner/UID uniqueness/lock và duplicate-close handling không thay thế distributed lock.
5. SDK tự default browser-like headers; ứng dụng không thêm spoof/fingerprint options, không bypass Zalo. Chưa có đảm bảo nền tảng cho phép hoặc hoạt động lâu dài.
6. QR expiry UI/state có unit test; chưa đợi 100 giây để nghiệm thu một expiry thật. Reconnect/crash có fixture test, chưa có mạng lỗi/session thật.
7. Chưa thử long-running listener, tài khoản group thực, Windows 11, đúng CPU/RAM máy nêu, sleep/resume, proxy hoặc network flaky.
8. Không cam kết nhận đủ mọi self-message ngoài PVH; agent_id=null khi không có danh tính nhân viên xác minh.

## Files / bằng chứng

- SDK code: apps/desktop/electron/workers/zalo-worker.ts.
- Supervisor/state/mapping/security: apps/desktop/electron/zalo/.
- Migration/repository: apps/desktop/electron/database/.
- UI: apps/desktop/src/features/zalo/zalo.tsx.
- Tests: tests/unit/zalo.test.ts, tests/unit/zalo-supervisor.test.ts, tests/e2e/zalo.spec.ts.
- Logs local bị gitignore: phase02-typecheck.log, phase02-unit.log, phase02-e2e.log, phase02-live-qr.log, phase02-packaged-e2e.log, phase02-packaged-qr.log, phase02-installer.log.
- EXE: apps/desktop/release/win-unpacked/PVH Omnichannel Manager.exe (giữ nguyên toàn thư mục).
- Installer: apps/desktop/release/PVH-Omnichannel-0.2.0-x64-Setup.exe.

Kết luận: QR desktop đã hoạt động thật; live account/message chưa nghiệm thu. **Không kết luận Phase 02 hoàn thành đầy đủ.**