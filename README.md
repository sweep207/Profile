# Locket Gold

Website bán Locket Gold dùng GitHub Pages, Cloudflare Worker + D1, SePay và Uplocket Reseller API.

Phiên bản này không dùng Cloudflare R2:
- Ảnh khung widget lưu trong repository, khai báo tại frames.json.
- Video hướng dẫn lưu trên YouTube.
- Đơn hàng và cấu hình video lưu trong D1.

Xem SETUP.md để triển khai. Cập nhật URL Worker tại config.js.

## Các trang
- Trang chủ: index.html
- Giới thiệu: about.html
- Hướng dẫn: install.html
- Thư viện khung: frames.html

API key chỉ được lưu trong Cloudflare Worker Secrets.