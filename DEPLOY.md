# 🎮 VNCaro – Hướng dẫn cài đặt & triển khai

## Bước 1 — Mua hosting (VPS)

Tôi khuyên dùng **Hostinger VPS** (rẻ nhất, tốc độ ổn cho người chơi Việt Nam).

1. Vào https://www.hostinger.vn/vps-hosting
2. Chọn gói **KVM 1** (~120.000đ/tháng) — đủ cho vài trăm người online
3. Chọn **OS: Ubuntu 22.04**
4. Mua và **lưu lại địa chỉ IP** máy chủ (VD: `103.x.x.x`)

---

## Bước 2 — Kết nối vào máy chủ

Trên máy tính của bạn:
- **Windows**: Mở PowerShell hoặc cài PuTTY
- **Mac/Linux**: Mở Terminal

Gõ lệnh (thay `IP_MAY_CHU` bằng IP thật):
```
ssh root@IP_MAY_CHU
```

Nhập mật khẩu mà Hostinger gửi qua email. Bạn đã vào được máy chủ.

---

## Bước 3 — Cài Node.js trên máy chủ

Dán từng dòng lệnh sau vào terminal:

```bash
# Cập nhật hệ thống
apt update && apt upgrade -y

# Cài Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Kiểm tra cài thành công
node --version   # phải hiện v20.x.x
npm --version

# Cài PM2 (giữ game chạy liên tục)
npm install -g pm2

# Cài Nginx (web server chuyên dụng)
apt install -y nginx
```

---

## Bước 4 — Upload code game lên máy chủ

Trên máy tính CỦA BẠN, tải file zip từ link tôi cung cấp. Sau đó upload lên máy chủ:

```bash
# Tạo thư mục game trên máy chủ
mkdir -p /var/www/vncaro

# Upload từ máy tính của bạn (chạy lệnh này trên máy TÍNH, không phải máy chủ)
scp -r /đường/dẫn/vncaro/* root@IP_MAY_CHU:/var/www/vncaro/
```

Hoặc đơn giản hơn, dùng FileZilla (phần mềm kéo thả file):
1. Tải FileZilla tại https://filezilla-project.org
2. Kết nối tới máy chủ (SFTP, port 22)
3. Kéo toàn bộ thư mục `vncaro` lên `/var/www/vncaro`

---

## Bước 5 — Cấu hình & khởi chạy game

Trên terminal máy chủ:

```bash
cd /var/www/vncaro

# Cài thư viện
npm install --production

# Tạo file cấu hình môi trường
cp .env.example .env
nano .env
```

Trong file .env, thay đổi:
```
JWT_SECRET=<chuỗi ngẫu nhiên dài ít nhất 32 ký tự, VD: vncaro2024_abc123xyz789_super_secret>
PORT=3000
NODE_ENV=production
```

Lưu file (Ctrl+O, Enter, Ctrl+X).

```bash
# Khởi động game
pm2 start server.js --name vncaro

# Tự động chạy lại khi máy chủ khởi động lại
pm2 startup
pm2 save

# Kiểm tra đang chạy
pm2 status
pm2 logs vncaro
```

---

## Bước 6 — Cài Nginx làm proxy

```bash
nano /etc/nginx/sites-available/vncaro
```

Dán nội dung sau vào (thay `vncaro.com` bằng tên miền thật):

```nginx
server {
    listen 80;
    server_name vncaro.com www.vncaro.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Kích hoạt cấu hình
ln -s /etc/nginx/sites-available/vncaro /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

---

## Bước 7 — Trỏ tên miền vncaro.com

1. Đăng nhập vào nơi bạn mua tên miền (Tenten, Inet, Namecheap...)
2. Vào phần **Quản lý DNS**
3. Sửa bản ghi:
   - **A record** | Host: `@` | Value: `IP_MAY_CHU`
   - **A record** | Host: `www` | Value: `IP_MAY_CHU`
4. Đợi 5–30 phút để DNS cập nhật

---

## Bước 8 — Cài HTTPS miễn phí (bắt buộc)

```bash
# Cài Certbot
apt install -y certbot python3-certbot-nginx

# Lấy chứng chỉ SSL (thay email và tên miền)
certbot --nginx -d vncaro.com -d www.vncaro.com --email email@cua-ban.com --agree-tos

# Tự động gia hạn
certbot renew --dry-run
```

---

## ✅ Kiểm tra hoàn tất

Mở trình duyệt, vào https://vncaro.com — game đã online!

---

## Lệnh quản trị thường dùng

```bash
# Xem log game
pm2 logs vncaro

# Khởi động lại game (sau khi cập nhật code)
pm2 restart vncaro

# Xem game đang dùng bao nhiêu RAM/CPU
pm2 monit

# Backup database
cp /var/www/vncaro/vncaro.db /root/backup_$(date +%Y%m%d).db
```

---

## Nâng cấp khi có nhiều người chơi

| Số người online | Hosting cần thiết |
|---|---|
| < 100 | KVM 1 (hiện tại) |
| 100–500 | KVM 2 (~200k/tháng) |
| 500+ | KVM 4 + cân nhắc Redis |
