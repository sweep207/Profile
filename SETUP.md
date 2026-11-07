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


## 7. Thư viện Khung widget (tự thêm ảnh)
1. Tạo R2 bucket tên `locket-widget-frames` trong Cloudflare.
2. Trong Worker settings → Variables and Secrets, thêm secret `FRAME_ADMIN_TOKEN` với một mật khẩu dài, khó đoán. Không ghi token vào mã nguồn.
3. Chạy migration D1 sau khi cập nhật `schema.sql`:
```bash
npx wrangler d1 execute locket-plus-orders --remote --file=./schema.sql
```
4. Deploy Worker. Trang `frames.html` có nút **Quản lý khung**; nhập token, chọn ảnh JPG/PNG/WEBP (tối đa 5 MB), tên và danh mục rồi lưu. Ảnh được lưu trong R2, thông tin khung lưu trong D1.
5. Giá gói chỉnh trong mảng `PLANS` ở đầu `worker.js`, sau đó deploy Worker lại. Không cần sửa HTML.


## 8. Thư viện khung widget (quản trị viên)
Worker đã có API quản lý khung. Để bật tính năng tải ảnh khung:
1. Tạo R2 bucket đúng tên trong `wrangler.toml`:
   ```bash
   npx wrangler r2 bucket create locket-widget-frames
   ```
2. Đảm bảo D1 đã chạy `schema.sql` (bảng `frames` đã được khai báo trong file này).
3. Đặt mã quản lý bí mật dưới dạng Worker Secret, không ghi mã này vào HTML hoặc GitHub:
   ```bash
   npx wrangler secret put FRAME_ADMIN_TOKEN
   ```
4. Nhập một chuỗi dài, khó đoán khi terminal hỏi. Sau đó deploy:
   ```bash
   npx wrangler deploy
   ```
5. Mở `frames.html`, nhập mã quản lý trong mục “Thêm khung mới / Quản lý thư viện”. Ảnh JPG, PNG, WEBP tối đa 5 MB. Khung mới sẽ hiển thị công khai trong thư viện; chỉ người có mã quản lý mới được thêm/xoá.
6. Thay `API_BASE` trong cả `index.html` và `frames.html` bằng cùng URL Worker đã deploy.

## 9. Thay đổi giá
Sửa các trường `price`, `duration`, `features` trong mảng `PLANS` ở đầu `worker.js`, sau đó chạy `npx wrangler deploy`. Trang chủ lấy bảng giá trực tiếp từ `GET /plans`, không cần sửa HTML.


## 10. Cấu trúc website nhiều trang
- `index.html`: trang chủ đặt hàng, chọn gói, tạo đơn VietQR, xem thông báo mua hàng và mở hỗ trợ.
- `about.html`: trang giới thiệu riêng, quyền lợi, bảng giá lấy động từ `GET /plans`.
- `install.html`: trang hướng dẫn cài đặt DNS iPhone riêng, gồm 4 bước và FAQ.
- `frames.html`: thư viện khung widget và phần quản trị thêm/xoá khung.
- Menu đầu trang và chân trang liên kết qua lại giữa các trang.

Sau khi deploy Worker, thay `https://YOUR-WORKER.workers.dev` bằng URL Worker thật trong `index.html`, `about.html` và `frames.html`. Không cần API cho `install.html`.

**Lưu ý:** Nút trên trang chủ hiện kiểm tra định dạng và tên miền của link Locket ở trình duyệt; nó chưa gọi API xác minh tài khoản trực tiếp với Locket. Không hiển thị thông báo rằng tài khoản đã được xác minh thành công nếu chưa có endpoint xác minh thực tế.
