# Locket Gold

Website bán Locket Gold với giao diện nhiều trang, thanh toán VietQR qua SePay và tự động kích hoạt DNS qua Uplocket Reseller API.

## Triển khai nhanh

Xem [SETUP.md](./SETUP.md) để tạo D1/R2, cấu hình Worker Secrets, deploy Cloudflare Worker và bật GitHub Pages.

Sau khi deploy Worker, cập nhật URL duy nhất tại [config.js](./config.js).

## Các trang

- Trang chủ: `index.html`
- Giới thiệu: `about.html`
- Hướng dẫn cài đặt: `install.html`
- Thư viện khung: `frames.html`

API key chỉ được lưu trong Cloudflare Worker Secrets, không đặt trong HTML hoặc GitHub.
