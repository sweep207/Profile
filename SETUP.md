# Hướng dẫn triển khai Locket Plus

## 1. Chuẩn bị
- Tài khoản Cloudflare có quyền tạo Workers và D1.
- Tài khoản SePay đã liên kết tài khoản ngân hàng và bật webhook.
- GitHub Pages đã bật cho repository này.

## 2. Tạo D1
Trong thư mục dự án, chạy:
```bash
npx wrangler d1 create locket-plus-orders
```
Sao chép `database_id` Cloudflare trả về vào `wrangler.toml` tại trường `database_id`.

Tạo bảng:
```bash
npx wrangler d1 execute locket-plus-orders --remote --file=./schema.sql
```

## 3. Cấu hình Worker
Sửa `wrangler.toml`:
- `database_id`: ID D1 vừa tạo.
- `ALLOWED_ORIGINS`: origin GitHub Pages, ví dụ `https://sweep207.github.io` (không thêm đường dẫn `/Profile`).
- `BANK_ID`: mã ngân hàng theo VietQR, ví dụ `MB`.
- `BANK_ACCOUNT`: số tài khoản nhận tiền.
- `BANK_ACCOUNT_NAME`: tên chủ tài khoản viết đúng như ngân hàng.

Không đưa access token, API key hoặc secret vào `wrangler.toml`, HTML hay GitHub.

## 4. Thêm SePay API Key dưới dạng Secret
Worker hiện dùng kiểu xác thực webhook SePay **API Key**. Trong SePay, tạo webhook:
- URL: `https://locket-plus-api.<subdomain>.workers.dev/webhook/sepay`
- Sự kiện: chỉ tiền vào.
- Xác thực: API Key.
- Định dạng: JSON.
- Bật xác thực giao dịch nếu tài khoản SePay có tùy chọn này.

Sau đó đặt cùng API Key ở Cloudflare Worker:
```bash
npx wrangler secret put SEPAY_API_KEY
```
Dán giá trị API Key khi terminal yêu cầu. SePay gửi header `Authorization: Apikey <API_KEY>`; Worker xác thực header này trước khi đọc giao dịch.

## 5. Deploy Worker
```bash
npx wrangler deploy
```
Sau khi deploy, sao chép URL Worker và mở `index.html`, thay:
```js
const API_BASE = "https://YOUR-WORKER.workers.dev";
```
bằng URL thật, rồi commit thay đổi.

## 6. GitHub Pages
Trong GitHub:
1. Settings → Pages.
2. Chọn Deploy from a branch.
3. Branch `main`, folder `/ (root)`.
4. Save.

Website dự kiến: `https://sweep207.github.io/Profile/`.

## 7. Kiểm tra
- Mở `https://<worker-url>/health`, kết quả mong đợi: `{"ok":true}`.
- Mở `https://<worker-url>/plans`, kiểm tra danh sách giá.
- Dùng tính năng gửi thử webhook của SePay trước.
- Sau đó mới chuyển khoản thử số tiền nhỏ và kiểm tra log webhook + trạng thái đơn.

## Lưu ý quan trọng
- Mức giá nằm ở mảng `PLANS` đầu file `worker.js`. Sửa `price` rồi deploy lại Worker.
- Không đánh dấu đơn đã thanh toán bằng thao tác thủ công từ trình duyệt.
- Mỗi giao dịch được chống xử lý lặp theo `transaction_id`.
- Nếu chưa cấu hình API nâng cấp hợp pháp từ nhà cung cấp, đơn chỉ được ghi nhận thanh toán hoặc chờ xử lý; không có cơ chế tự nâng cấp Locket.
- Không gửi mật khẩu, OTP ngân hàng, token Cloudflare hay API key trong chat.
