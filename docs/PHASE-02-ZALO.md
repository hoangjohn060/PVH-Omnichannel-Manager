# Phase 02 — Zalo QR connector Windows

## Source đã đọc trước khi triển khai

- RFS-ADRENO/zca-js: package.json, zalo.ts, loginQR.ts, listen.ts, sendMessage.ts và Message.ts.
- diendh/zca-bridge: package.json, zcaAdapter, qrLoginService, sessionManager, reconnectSupervisor.
- Package cài và pin: **zca-js 2.2.0**. Bridge tham khảo hiện pin **2.1.2**, không được cài làm dependency và không giả định hai API giống nhau.
- Đã đối chiếu khai báo và implementation trong node_modules của package cài thực tế, không chỉ dựa trên README/main branch.

SDK là API không chính thức; có rủi ro giới hạn/khóa tài khoản. Không có cơ chế bypass bảo vệ Zalo, nhập cookie từ bên ngoài hay fingerprint tùy chỉnh. PVH gọi QR login của SDK nguyên bản. SDK tự có các header/user-agent mặc định; PVH không tuyên bố đây là official API.

## Luồng và ranh giới bảo mật

Renderer -> preload fixed functions -> IPC sender/Zod -> ZaloSupervisor -> một worker_threads cho mỗi connector -> zca-js.

- QR Generated chỉ chuyển PNG đã kiểm tra magic bytes sang UI, không chuyển QR code/token/actions.
- Scan chuyển WAITING_CONFIRMATION, GotLoginInfo chuyển AUTHENTICATING. Không dùng GotLoginInfo làm bằng chứng CONNECTED.
- Cookie/imei/userAgent do QR SDK tạo được main mã hóa safeStorage, lưu BLOB trong SQLite. Worker chờ main xác nhận đã lưu rồi mới mở listener. Chỉ listener connected mới đánh dấu CONNECTED.
- Credential plaintext chỉ tồn tại trong bộ nhớ main/worker; không ghi file/log hay gửi renderer. SDK stdout/stderr bị tiêu thụ, không forward vào log.
- Profile name lấy từ SDK, avatar được tải trong worker qua HTTPS giới hạn host zdn.vn, không redirect, giới hạn size/timeout; UI chỉ nhận data image. Lỗi tải avatar không giả ảnh hoặc ảnh cá nhân.
- SDK không có expiresAt trong QR event. UI không bịa countdown; chờ QRCodeExpired thật. SDK 2.2.0 có timeout nội bộ 100 giây nhưng không coi đó là TTL server cung cấp.
- Hủy/đăng nhập lại/disconnect dừng worker cũ trước; late events bị chặn bằng epoch. Stop gọi abort, listener.stop và removeAllListeners, sau đó terminate có giới hạn thời gian.
- Mỗi connector chỉ một listener. Tắt retryOnClose của SDK, supervisor backoff 5/15/45/120/300 giây, tối đa 5 lần. Duplicate connection dừng lỗi; kick/expired xóa session và yêu cầu QR, không tranh listener.
- ownerId cục bộ, một UID chỉ có một connector trên máy, userData lock file chống cùng kho dữ liệu. **Không có distributed lease ở Phase 02**: không thể bảo đảm hai máy độc lập không quét cùng tài khoản. Không copy userData/session sang máy khác; nhân viên máy khác phải đợi Gateway Phase 06. Khi SDK báo duplicate, PVH dừng thay vì tự giành lại kết nối.

## Messages / persistence

Migration v2 bổ sung zalo_accounts, zalo_threads, zalo_messages, zalo_outbound, zalo_logs, zalo_gateway_outbox; không phá bảng Phase 01.

- Unique key inbound: platform + account_id + message_id; upsert trong transaction với thread.
- Chuẩn hóa text Unicode, message/thread ID, thread type, timestamp, self flag, image/file metadata.
- Tin self không enqueue lại gateway, không tự tạo outbound từ listener → tránh echo loop.
- agent_id=null khi không có auth nhân viên đáng tin cậy; không suy đoán nhân viên gửi từ Zalo chính thức.
- Outbound text gọi sendMessage thật, bắt buộc response.message.msgId. Chỉ lưu SENT khi có ID, không đánh đồng SENT với DELIVERED/SEEN. Hai trạng thái sau chỉ cập nhật khi listener có event tương ứng.
- requestId được claim bền vững trong SQLite. Một request chỉ có một lần phát SDK. Timeout/crash/restart thành UNKNOWN, không blind retry vì SDK chưa có end-to-end idempotency cho PVH. FAILED/UNKNOWN có danh sách trong UI; phải kiểm tra Zalo trước khi gửi tin mới.
- Chưa có cấu hình/auth Gateway khả dụng từ Phase 01. Inbound không-self được lưu vào outbox có unique key, **chưa gửi mạng và không báo đã sync**. Transport/lease/auth gateway là Phase 06.

## Giới hạn chưa hoàn thành

- Hiện gửi **văn bản**; nhận và lưu **metadata ảnh/file**. Chưa có nút chọn/gửi file, tải file, xem ảnh từ tin khách hoặc preview media. SDK có attachment API nhưng tính năng upload của PVH chưa triển khai; không coi yêu cầu media hoàn tất.
- Không backfill toàn bộ lịch sử, không cam kết nhận mọi tin do app Zalo chính thức gửi.
- Chưa có desktop employee auth/RBAC; chỉ owner local. Chưa có remote staff access hay distributed ownership enforcement.
- Gateway outbound transport chưa triển khai; dữ liệu được xếp outbox cục bộ.
- Chưa kiểm chứng session thật sau revoke/restart, inbound/outbound thật hoặc profile thật; tests fixture không thay thế live test.
- SQLite không mã hóa toàn bộ; cookie/session được mã hóa, nhưng message cache chứa nội dung tin nhắn. Không dùng tài khoản nhạy cảm trước khi nghiệm thu chính sách lưu trữ.

## Manual live test — bắt buộc tài khoản tự sở hữu

1. Đóng Zalo Web/listener SDK khác của chính tài khoản; không lấy cookie từ bên ngoài.
2. Chạy pnpm dev hoặc EXE v0.2.0, mở Zalo > Thêm Zalo.
3. Dùng điện thoại quét QR trong ứng dụng, kiểm tra tên và xác nhận. Không chia sẻ screenshot QR hoặc token.
4. Xác nhận UI chỉ CONNECTED khi listener sẵn sàng; profile đúng người dùng; SQLite không có session plaintext.
5. Từ tài khoản test thứ hai được đồng ý gửi text tiếng Việt, ảnh/file vào tài khoản này. Kiểm tra một bản ghi theo external ID và account isolation.
6. Trả lời text từ PVH, đối chiếu điện thoại người nhận và ID trả về; thử mất mạng để đảm bảo không báo SENT sai.
7. Gửi từ app Zalo chính thức: nếu SDK phát self message, kiểm tra agent_id=null, không forward echo. Không coi thiếu event là bằng chứng SDK đọc được mọi tin.
8. Restart app, reconnect từ session; thu hồi phiên trong Zalo, xác nhận EXPIRED và quét QR mới. Không tự thử gửi lại sau kết quả UNKNOWN.
9. Để QR hết hạn thật, dùng Tạo QR mới; hủy login và đảm bảo QR/listener cũ dừng.

## Lệnh

```powershell
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:zalo:qr
pnpm pack:win
pnpm test:packaged
pnpm test:zalo:qr:packaged
pnpm dist:win
```

QR network tests là opt-in; không quét hay gửi tin tự động. Không lưu screenshot QR trong báo cáo.