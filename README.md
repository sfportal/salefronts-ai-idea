# Salefronts AI

Website nhận yêu cầu sản phẩm số (Web, Extension, Media) cho SME: khách nhập thông tin, chat với AI để chốt phiếu yêu cầu trên mẫu có sẵn, xem bản mô phỏng (sửa tối đa 2 lần), thanh toán qua SePay, admin duyệt rồi chuyển gói việc cho Claude (project uyminh-6), sau đó giao kết quả kèm hướng dẫn sử dụng.

Astro 5 (SSR) chạy trên Cloudflare Workers, dữ liệu ở D1, tệp ở R2.

## Chạy thử trên máy

```bash
npm install
cp .dev.vars.example .dev.vars   # điền SESSION_SECRET, ADMIN_BOOTSTRAP_KEY (>= 12 ký tự)
npm run db:local                 # tạo bảng + dữ liệu mẫu (9 mẫu, cài đặt, mã TET2027)
npm run preview                  # http://localhost:8787
```

Khi chưa có khoá AI hoặc SePay, web tự chạy chế độ demo: AI phỏng vấn theo luật, mockup theo mẫu, thanh toán có nút "giả lập đã chuyển khoản".

Vào admin lần đầu: `/admin/login`, nhập `ADMIN_BOOTSTRAP_KEY` (cấp quyền owner cho `OWNER_EMAIL`). Khi Google OAuth đã cấu hình, đăng nhập bằng Google với minhducuy@gmail.com và xoá secret này.

## Triển khai Cloudflare

```bash
npx wrangler login
npx wrangler d1 create salefronts-ai        # chép database_id vào wrangler.jsonc
npx wrangler r2 bucket create salefronts-ai-files
npm run db:remote
npx wrangler secret put SESSION_SECRET       # chuỗi ngẫu nhiên dài
npx wrangler secret put ANTHROPIC_API_KEY    # hoặc DEEPSEEK_API_KEY
npx wrangler secret put SEPAY_API_KEY        # khoá API sepay-thuchi (quyền tạo payment request)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ADMIN_BOOTSTRAP_KEY  # tuỳ chọn, xoá sau khi Google chạy
npx wrangler secret put HANDOFF_WEBHOOK_URL  # tuỳ chọn
npm run deploy
```

Google OAuth: tạo OAuth Client (Web) ở Google Cloud Console, thêm Authorized redirect URI `https://<tên-miền>/api/auth/google/callback`.

GA4: nhập mã `G-XXXX` trong Admin → Thiết lập.

## Cấu trúc

- `src/pages/bat-dau.astro`: luồng 5 bước của khách (thông tin → chat AI → phiếu + mockup → thanh toán → hoàn tất).
- `src/pages/tai-khoan/`: khu khách hàng (đơn, kết quả, giao dịch, lịch sử, giới thiệu bạn bè).
- `src/pages/admin/`: tổng quan, duyệt đơn, kho mẫu, CRM, CSKH & lịch tư vấn, khuyến mãi, affiliate, giao dịch, thiết lập.
- `src/pages/api/`: API công khai và `api/admin/[...path].ts` cho quản trị.
- `src/lib/`: AI (Claude/DeepSeek/mock), SePay, đơn hàng, xác thực, DB.
- `migrations/`: schema D1; `scripts/seed.mjs` sinh `0002_seed.sql`.

## Kho mẫu

Mỗi mẫu có: loại, giá gốc, số ngày, link demo, repo GitHub gốc, danh sách "điểm chỉnh được" (AI chỉ hỏi những điểm này, mỗi điểm có thể cộng giá), chỉ dẫn cho Claude khi thực hiện, và hướng dẫn sử dụng soạn sẵn (tự ghép vào kết quả gửi khách). Yêu cầu khác hẳn mẫu được đánh dấu "ngoài mẫu": admin báo giá riêng, và ý tưởng được ghi vào tab "Đề xuất mẫu mới" để gom phiếu làm mẫu mới.
