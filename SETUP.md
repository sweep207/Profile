# Locket Gold — triển khai với Uplocket Reseller API

Website sử dụng API gốc `https://uplocket.io.vn`. Cloudflare Worker đóng vai trò proxy bảo mật để API key không xuất hiện trong HTML hoặc trình duyệt.

## Chức năng đang được tích hợp

- Tra cứu hồ sơ Locket công khai: `POST /api/locket/lookup` (không cần API key theo tài liệu).
- Tra cứu DNS: `GET/POST /api/v1/dns/lookup`.
- Tạo/cập nhật hồ sơ DNS: `POST /api/v1/dns/export` (trừ 1 credit theo quy định API).
- Danh sách hồ sơ: `GET /api/v1/dns/activations`.
- Gia hạn: `POST /api/v1/dns/activations/{id}/renew` (trừ 1 credit).
- Bật/tắt DNS: `POST /api/v1/dns/activations/{id}/toggle` (không trừ credit).
- Số dư và credit: `GET /api/v1/credits`.

## 1. Cài Wrangler

Cài Node.js LTS, mở Terminal tại thư mục repo và chạy:

```bash
npm install -g wrangler
wrangler login
```

## 2. Cấu hình Worker

File `wrangler.toml` đã được tối giản, không cần D1, R2, SePay hoặc Firebase cho API Uplocket.

Đặt API key mới dưới dạng Cloudflare Worker Secret:

```bash
wrangler secret put UPLOCKET_API_KEY
```

Khi terminal yêu cầu, dán API key Uplocket mới. Không ghi key vào `index.html`, `wrangler.toml`, GitHub hoặc tin nhắn.

## 3. Deploy Worker

```bash
wrangler deploy
```

Sau khi deploy, bạn sẽ nhận được URL dạng:

```
https://locket-plus-api.<ten-tai-khoan>.workers.dev
```

Kiểm tra:

```
https://TEN-WORKER.workers.dev/health
```

Kết quả mong đợi có `ok: true` và `configured: true`.

## 4. Gắn URL Worker vào trang chủ

Mở `index.html`, tìm:

```js
const API_BASE="https://YOUR-WORKER.workers.dev";
```

Thay bằng URL Worker thật rồi commit lên GitHub.

Trong `wrangler.toml`, `ALLOWED_ORIGINS` phải là origin của website, không kèm đường dẫn `/Profile/`. Với GitHub Pages thường là:

```
https://sweep207.github.io
```

Nếu website dùng domain riêng, thay bằng domain đó.

## 5. Bật GitHub Pages

GitHub → repository `sweep207/Profile` → Settings → Pages:
1. Source: Deploy from a branch.
2. Branch: `main`.
3. Folder: `/(root)`.
4. Save.

Website dự kiến: `https://sweep207.github.io/Profile/`.

## 6. Kiểm tra sau deploy

- Mở trang chủ trên điện thoại và laptop.
- Kiểm tra thông tin credit.
- Tra cứu username Locket.
- Thử tra cứu DNS.
- Chỉ thử kích hoạt khi bạn hiểu thao tác sẽ trừ 1 credit.
- Kiểm tra danh sách hồ sơ, gia hạn và bật/tắt DNS.

## Lưu ý về tài liệu API và các tính năng cũ

- API Uplocket trong tài liệu không có endpoint thanh toán VietQR/SePay, quản lý giá, quản lý khung widget hoặc quản lý video hướng dẫn. Vì vậy website không được giả lập các chức năng này hoặc gọi endpoint tự đặt.
- Giá bán cho khách không thể tự đồng bộ từ API này vì tài liệu không cung cấp endpoint quản lý giá. API chỉ trả số credit và số dư hoa hồng.
- Khung widget và video hướng dẫn nếu vẫn cần thì phải dùng một hệ thống lưu trữ/quản trị riêng; không thể gắn vào API Uplocket bằng cách đoán endpoint.
- Thông báo mua hàng chỉ được hiển thị khi có nguồn giao dịch thật. Không tạo tên người mua hoặc thời gian mua giả.
- HTTP 402 là không đủ credit; HTTP 409 có thể là hồ sơ còn hạn đang thuộc CTV khác; HTTP 401 thường là API key thiếu hoặc sai; HTTP 502 là upstream không đồng bộ được.
- Nếu API key cũ từng xuất hiện trong ảnh/chia sẻ, hãy thu hồi và tạo key mới.
