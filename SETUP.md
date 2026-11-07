# Triển khai website Locket Gold

Website dùng GitHub Pages cho giao diện, Cloudflare Worker + D1 cho backend, SePay để nhận webhook và Uplocket API để kích hoạt. Không sử dụng Cloudflare R2.

## 1. File chính
- index.html: trang chủ và đặt đơn.
- about.html: giới thiệu.
- install.html: hướng dẫn cài đặt và video YouTube.
- frames.html: thư viện ảnh đọc từ frames.json.
- frames.json: danh sách ảnh khung.
- frames/: thư mục ảnh lưu trong GitHub.
- worker.js: backend.
- schema.sql: cấu trúc D1.

## 2. D1
Tạo D1 tên locket-plus-orders và cập nhật database_id trong wrangler.toml. Với database mới, chạy:
```powershell
npx wrangler d1 execute locket-plus-orders --remote --file=./schema.sql
```
Không chạy lại schema nếu đã khởi tạo thành công.

## 3. Không cần R2
Không tạo bucket R2, không cần R2 API token và không cần binding R2.

## 4. Cấu hình wrangler.toml
- database_id: D1 ID của bạn.
- ALLOWED_ORIGINS: https://sweep207.github.io (không thêm /Profile).
- BANK_ID, BANK_ACCOUNT, BANK_ACCOUNT_NAME: thông tin nhận tiền.

## 5. Worker Secrets
```powershell
npx wrangler secret put SEPAY_API_KEY
npx wrangler secret put UPLOCKET_API_KEY
npx wrangler secret put SITE_ADMIN_TOKEN
npx wrangler secret put INTERNAL_SECRET
```
Không commit các giá trị secret vào GitHub hoặc gửi qua chat.

## 6. Thêm ảnh khung bằng GitHub
1. Mở repository sweep207/Profile, vào thư mục frames/.
2. Chọn Add file → Upload files và tải ảnh JPG, PNG hoặc WEBP lên.
3. Mở frames.json và thêm object sau vào mảng frames:
```json
{
  "id": "khung-mau-01",
  "title": "Khung mẫu 01",
  "category": "Tối giản",
  "note": "Khung widget phong cách tối giản",
  "image": "./frames/khung-mau-01.png"
}
```
4. Commit changes. GitHub Pages tự cập nhật thư viện.

## 7. Video YouTube
Tải video lên YouTube, sao chép link, sau đó cấu hình qua endpoint POST /admin/install-video. Header Authorization: Bearer <SITE_ADMIN_TOKEN>. JSON body: {"video_url":"https://youtu.be/VIDEO_ID"}. Trang install.html sẽ nhúng video.

## 8. Deploy Worker
Trên Windows, cài Node.js LTS, mở PowerShell trong thư mục repo rồi chạy:
```powershell
npm install
npx wrangler login
npx wrangler deploy
```
Trước khi deploy lần đầu, đảm bảo đã chạy schema.sql lên D1. Nếu đã chạy ở bước 2 thì không chạy lại.

## 9. Frontend và GitHub Pages
Cập nhật URL Worker trong config.js. Vào Settings → Pages, chọn Deploy from a branch, branch main, folder /(root). Website dự kiến: https://sweep207.github.io/Profile/.

## 10. SePay và kiểm thử
Webhook URL: https://<worker-url>/webhook/sepay. API Key phía SePay phải khớp secret SEPAY_API_KEY. Chỉ kiểm thử đơn thật sau khi xác minh request/response Uplocket.

Thông báo mua gần đây chỉ lấy đơn có trạng thái completed trong D1. Không tạo dữ liệu giả.