# Triển khai website Locket Gold

Website gồm các trang tĩnh trên GitHub Pages và một Cloudflare Worker làm backend. Worker lưu đơn hàng trong D1, ảnh khung trong R2, nhận webhook thanh toán SePay và chỉ gọi Uplocket sau khi xác nhận tiền vào đúng mã đơn + đúng số tiền.

## 1. Những file chính

- `index.html`: trang chủ, chọn gói, tạo đơn VietQR, kiểm tra thanh toán và hiển thị thông báo mua hàng thật.
- `about.html`: trang giới thiệu riêng.
- `install.html`: hướng dẫn cài đặt riêng, tải video từ API.
- `frames.html`: thư viện khung widget, quản trị thêm/xóa khung.
- `config.js`: nơi duy nhất cấu hình URL Cloudflare Worker cho các trang.
- `worker.js`: backend đơn hàng, SePay, Uplocket, khung widget và video.
- `schema.sql`: cấu trúc D1 mới.
- `migrations/0002_uplocket_order_fields.sql`: bổ sung trường lưu kết quả kích hoạt cho D1 đã tạo trước đó.

## 2. Tạo Cloudflare D1

Trong Cloudflare Dashboard → Workers & Pages → D1 SQL Database, tạo database tên `locket-plus-orders`.

Hoặc dùng Wrangler:
```bash
npx wrangler d1 create locket-plus-orders
```

Sao chép `database_id` vào `wrangler.toml`.

Nếu đây là database mới:
```bash
npx wrangler d1 execute locket-plus-orders --remote --file=./schema.sql
```

Nếu database đã tồn tại từ phiên bản cũ, KHÔNG chạy lại migration 0002 nhiều lần. Chạy một lần:
```bash
npx wrangler d1 execute locket-plus-orders --remote --file=./migrations/0002_uplocket_order_fields.sql
```
Migration này thêm `provider_activation_id`, `activation_code`, `install_url`, `provider_error` vào bảng `orders`.

## 3. Tạo Cloudflare R2 cho ảnh khung

Tạo bucket có tên đúng như `bucket_name` trong `wrangler.toml`:
```bash
npx wrangler r2 bucket create locket-widget-frames
```

## 4. Cấu hình biến môi trường

Mở `wrangler.toml` và điền các giá trị:
- `database_id`: D1 ID của bạn.
- `ALLOWED_ORIGINS`: origin website, ví dụ `https://sweep207.github.io` (không thêm `/Profile`).
- `BANK_ID`: mã ngân hàng dùng cho VietQR.
- `BANK_ACCOUNT`: số tài khoản nhận tiền.
- `BANK_ACCOUNT_NAME`: tên chủ tài khoản đúng theo ngân hàng.

Không commit API key, token hay secret vào GitHub.

## 5. Tạo Worker Secrets

Chạy từng lệnh, dán giá trị khi terminal yêu cầu:
```bash
npx wrangler secret put SEPAY_API_KEY
npx wrangler secret put UPLOCKET_API_KEY
npx wrangler secret put FRAME_ADMIN_TOKEN
npx wrangler secret put INTERNAL_SECRET
```

- `SEPAY_API_KEY`: API Key webhook lấy từ SePay.
- `UPLOCKET_API_KEY`: API key reseller của Uplocket.
- `FRAME_ADMIN_TOKEN`: mật khẩu quản trị thư viện khung.
- `INTERNAL_SECRET`: secret dài, ngẫu nhiên để gọi endpoint xử lý lại đơn lỗi.

Nếu API key mẫu trong tài liệu PDF là key thật, hãy thu hồi key đó và tạo key mới vì tài liệu đã được chia sẻ. Chỉ lưu key mới trong Worker Secret.

## 6. Cấu hình SePay webhook

Trong SePay tạo webhook:
- URL: `https://<ten-worker>.<subdomain>.workers.dev/webhook/sepay`
- Sự kiện: tiền vào.
- Xác thực: API Key.
- Định dạng: JSON.

Worker kiểm tra header `Authorization: Apikey <SEPAY_API_KEY>`, mã đơn dạng `LOCKETXXXXXXXXXXXX`, số tiền và mã giao dịch. Giao dịch được ghi nhận chống lặp theo transaction ID. Giao dịch không khớp sẽ không kích hoạt dịch vụ.

## 7. Cách website kết nối Uplocket

Sau khi SePay xác nhận giao dịch hợp lệ, Worker gọi server-to-server:
`POST https://uplocket.io.vn/api/v1/dns/export`

Worker gửi username Locket, số ngày và tên gói. Thời hạn cấu hình hiện tại:
- Trial: 1 ngày.
- Pro: 180 ngày.
- Premium: 365 ngày.
- Forever: 9999 ngày (theo tài liệu Uplocket là trọn đời).

API key Uplocket không được gửi xuống trình duyệt. Khi Uplocket trả thành công, Worker lưu mã kích hoạt và link cài đặt; khách thấy nút mở link sau khi đơn hoàn tất. Lỗi như thiếu credit hoặc hồ sơ đang do reseller khác quản lý được lưu thành lỗi kích hoạt, không giả mạo trạng thái thành công.

## 8. Deploy Worker

```bash
npx wrangler deploy
```

Kiểm tra:
- `https://<worker-url>/health`
- `https://<worker-url>/plans`

## 9. Cấu hình URL Worker cho website

Mở duy nhất file `config.js` và thay:
```js
window.LOCKET_API_BASE = "https://YOUR-WORKER.workers.dev";
```
bằng URL Worker thực tế. Tất cả các trang đều dùng chung cấu hình này.

## 10. Deploy GitHub Pages

Trong GitHub repository → Settings → Pages:
1. Chọn Deploy from a branch.
2. Branch `main`, folder `/(root)`.
3. Save.

Website sẽ có địa chỉ dạng `https://sweep207.github.io/Profile/`.

## 11. Chỉnh giá và thời hạn

Giá bán và thời hạn được cấu hình trong mảng `PLANS` ở đầu `worker.js`. Sửa `price`, `duration`, `features` và mapping `durationDays` trong `activatePaidOrder` cho đồng bộ, sau đó deploy lại Worker.

## 12. Quản lý khung và video

- Mở `frames.html`, mở phần quản trị, nhập `FRAME_ADMIN_TOKEN`, thêm ảnh JPG/PNG/WEBP (tối đa 5 MB). Ảnh lưu trong R2, metadata lưu trong D1.
- Video hướng dẫn được lưu trong bảng `site_settings`. API quản trị là `POST /admin/install-video` với header `Authorization: Bearer <FRAME_ADMIN_TOKEN>` và JSON `{"video_url":"https://..."}`. Hỗ trợ YouTube, Vimeo hoặc MP4 HTTPS. Khách xem video từ `GET /install-video`.

## 13. Kiểm tra hoạt động trước khi mở bán

1. Mở trang chủ, kiểm tra bảng giá tải từ Worker.
2. Tạo một đơn thử với gói giá nhỏ.
3. Dùng webhook test của SePay; kiểm tra log Worker.
4. Chỉ khi SePay báo giao dịch tiền vào đúng số tiền và mã đơn thì Worker mới gọi Uplocket.
5. Xác nhận đơn chuyển sang `completed` và link cài đặt xuất hiện.
6. Kiểm tra thư viện khung, video và giao diện điện thoại.

Thông báo mua gần đây chỉ lấy đơn có trạng thái `completed` từ D1, không tạo dữ liệu giả.

## 14. Lưu ý

- Không có thao tác nào trong frontend có thể tự đánh dấu đơn đã thanh toán.
- Nếu Uplocket thiếu credit hoặc trả lỗi, đơn không được hiển thị là đã kích hoạt.
- Có thể xử lý lại đơn lỗi bằng endpoint nội bộ `POST /process-upgrade`, gửi `Authorization: Bearer <INTERNAL_SECRET>` và JSON `{"order_code":"LOCKET..."}`.
- Không gửi mật khẩu, OTP, API key hoặc secret trong chat.
