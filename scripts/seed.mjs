// Generates migrations/0002_seed.sql from the template catalogue below.
import fs from 'node:fs';
const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const T = [
 { kind:'web', slug:'web-ban-hang', name:'Website bán hàng theo ngành', industries:'Quà tặng, đặc sản, OCOP, cà phê', accent:'#ff7a45',
   summary:'Web bán hàng có giỏ hàng, COD, chuyển khoản VietQR tự xác nhận, phí ship, trang quản trị sản phẩm. Dựng trên Cloudflare, khách sở hữu mã nguồn.',
   demo_url:'https://dala-shop.sfportal.workers.dev', base_price:4900000, days:5,
   options:[
    {key:'brand',label:'Tên thương hiệu, logo, màu chủ đạo',question:'Tên cửa hàng, màu chủ đạo bạn muốn, và gửi logo (nếu có)?',required:true,price:0},
    {key:'products',label:'Danh sách sản phẩm (tối đa 30)',question:'Bạn có khoảng bao nhiêu sản phẩm, nhóm sản phẩm nào, giá khoảng bao nhiêu? Có file Excel hoặc ảnh không?',required:true,price:0},
    {key:'domain',label:'Tên miền',question:'Bạn đã có tên miền chưa? Nếu chưa, muốn dùng tên nào?',required:true,price:0},
    {key:'payment',label:'Tài khoản nhận tiền, cách giao hàng',question:'Số tài khoản ngân hàng nhận tiền, và bạn giao hàng bằng gì (tự giao, GoShip, COD)?',required:true,price:0},
    {key:'pages',label:'Trang nội dung thêm',question:'Ngoài trang sản phẩm, bạn cần thêm trang nào (giới thiệu, câu chuyện vùng trồng, chính sách đổi trả, blog)?',required:false,price:0},
    {key:'full',label:'Gói Đầy đủ: GoShip, flash sale, cộng tác viên, QR truy xuất',question:'Bạn có cần flash sale, cộng tác viên, báo giá quà doanh nghiệp, QR truy xuất lô hàng không?',required:false,price:5000000},
    {key:'inventory',label:'Nối tồn kho KiotViet/MISA',question:'Bạn có đang dùng KiotViet hoặc MISA và muốn nối tồn kho không?',required:false,price:1500000}],
   claude_notes:'Fork mẫu dala-shop. Chỉ đổi: config thương hiệu (tên, logo, màu), dữ liệu sản phẩm, trang nội dung, tài khoản VietQR, phí ship. Không đổi cấu trúc giỏ hàng/thanh toán. Bật module Đầy đủ khi option full=yes.',
   guide_md:'## Hướng dẫn sử dụng website\n\n1. **Đăng nhập quản trị:** mở `/admin` trên tên miền của bạn, đăng nhập bằng tài khoản đã gửi.\n2. **Thêm sản phẩm:** Quản trị → Sản phẩm → Thêm, nhập tên, giá, ảnh, tồn kho.\n3. **Xử lý đơn:** Quản trị → Đơn hàng. Đơn chuyển khoản tự chuyển sang "Đã thanh toán" khi tiền về.\n4. **Mã nguồn:** repo GitHub đã chuyển quyền cho bạn; mọi thay đổi đẩy lên nhánh main sẽ tự deploy.\n5. **Hỗ trợ:** nhắn Zalo 0938 266 958 kèm mã đơn.' },
 { kind:'web', slug:'landing-du-an', name:'Landing page dự án / chiến dịch', industries:'Bất động sản, sự kiện, khoá học', accent:'#3d8bfd',
   summary:'Một trang giới thiệu dự án hoặc chiến dịch: vị trí, bảng hàng, pháp lý, form nhận khách báo về Zalo.',
   demo_url:'', base_price:1500000, days:3,
   options:[
    {key:'brand',label:'Tên dự án, logo, màu',question:'Tên dự án/chiến dịch, logo và màu chủ đạo?',required:true,price:0},
    {key:'sections',label:'Các khối nội dung',question:'Trang cần những khối nào: vị trí, tiện ích, bảng hàng, pháp lý, lịch sự kiện, cảm nhận khách?',required:true,price:0},
    {key:'lead_form',label:'Form nhận khách',question:'Form cần hỏi những gì, và gửi thông tin khách về đâu (Zalo, email, Google Sheet)?',required:true,price:0},
    {key:'table',label:'Bảng hàng / bảng giá cập nhật được',question:'Có cần bảng hàng hoặc bảng giá tự cập nhật không?',required:false,price:500000}],
   claude_notes:'Dùng mẫu landing 1 trang. Đổi nội dung, màu, ảnh, khối hiển thị; form gửi về webhook của khách.',
   guide_md:'## Hướng dẫn sử dụng landing page\n\n1. Link trang đã chạy ở tên miền bạn chọn.\n2. Khách điền form sẽ báo về kênh bạn đã chọn.\n3. Sửa nội dung: gửi yêu cầu cập nhật trong cổng khách hàng (100.000đ/lần) hoặc sửa file `content.json` trong repo GitHub.' },
 { kind:'web', slug:'mini-shop-menu', name:'Mini-shop / Menu QR một trang', industries:'Shop nhỏ, quán cà phê, nhà hàng', accent:'#22c55e',
   summary:'Một trang gọn trên điện thoại: menu hoặc sản phẩm, đặt qua Zalo, mã VietQR, mã QR in đặt bàn.',
   demo_url:'', base_price:990000, days:2,
   options:[
    {key:'brand',label:'Tên quán/shop, logo, màu',question:'Tên quán hoặc shop, màu chủ đạo, logo?',required:true,price:0},
    {key:'items',label:'Danh sách món/sản phẩm (tối đa 15)',question:'Gửi danh sách món hoặc sản phẩm kèm giá (tối đa 15), có ảnh thì càng tốt.',required:true,price:0},
    {key:'zalo',label:'Số Zalo nhận đặt hàng',question:'Số Zalo nhận đặt hàng/đặt bàn là số nào?',required:true,price:0},
    {key:'qr_print',label:'File in mã QR để bàn',question:'Bạn có cần file in mã QR để trên bàn không?',required:false,price:0}],
   claude_notes:'Dùng mẫu mini-shop. Đổi dữ liệu món, màu, logo, số Zalo, tài khoản VietQR.',
   guide_md:'## Hướng dẫn sử dụng mini-shop\n\n1. Chia sẻ link hoặc in mã QR đặt trên bàn/quầy.\n2. Khách bấm "Đặt qua Zalo" sẽ mở chat với số Zalo của bạn kèm món đã chọn.\n3. Cập nhật món: gửi yêu cầu trong cổng khách hàng.' },
 { kind:'extension', slug:'ext-zalo-cham-khach', name:'Zalo Chăm Khách', industries:'Mọi ngành có tệp khách Zalo', accent:'#0ea5e9',
   summary:'Tiện ích Chrome chạy cùng Zalo Web: lọc khách trong nhóm, gắn nhãn, nhắc lịch, gửi tin chăm sóc kèm ảnh với nhịp an toàn.',
   demo_url:'', base_price:1900000, days:3,
   options:[
    {key:'brand',label:'Tên hiển thị, biểu tượng',question:'Tên tiện ích hiển thị và logo/biểu tượng muốn dùng?',required:true,price:0},
    {key:'labels',label:'Bộ nhãn khách hàng',question:'Bạn muốn phân loại khách theo nhãn nào (mới, đã mua, VIP, lâu chưa quay lại, ...)?',required:true,price:0},
    {key:'templates',label:'Mẫu tin chăm sóc',question:'Bạn cần mẫu tin cho những dịp nào (cảm ơn, nhắc mua lại, Tết, sinh nhật, khuyến mãi)?',required:true,price:0},
    {key:'pace',label:'Nhịp gửi an toàn',question:'Mỗi ngày bạn muốn gửi tối đa khoảng bao nhiêu tin?',required:false,price:0},
    {key:'sheet',label:'Đồng bộ Google Sheet',question:'Có cần đồng bộ danh sách khách ra Google Sheet không?',required:false,price:500000}],
   claude_notes:'Fork repo extension Zalo Chăm Khách. Đổi manifest (tên, icon), bộ nhãn mặc định, mẫu tin, giới hạn gửi. Không đổi lõi đọc DOM Zalo.',
   guide_md:'## Hướng dẫn cài và dùng extension\n\n1. Tải file `.zip` trong mục Kết quả, giải nén.\n2. Mở Chrome → `chrome://extensions` → bật **Chế độ nhà phát triển** → **Tải tiện ích đã giải nén** → chọn thư mục vừa giải nén.\n3. Mở `chat.zalo.me`, đăng nhập, bấm biểu tượng tiện ích trên thanh công cụ.\n4. Vào tab **Khách hàng** để gắn nhãn, tab **Chiến dịch** để gửi tin theo mẫu.\n5. Giữ nhịp gửi mặc định để tránh bị Zalo hạn chế.' },
 { kind:'extension', slug:'ext-collector', name:'Web & Fanpage Collector', industries:'Agency, bán hàng B2B', accent:'#a855f7',
   summary:'Tiện ích thu thập thông tin doanh nghiệp từ website và fanpage, chấm điểm kênh số, xuất danh sách khách tiềm năng.',
   demo_url:'', base_price:1500000, days:3,
   options:[
    {key:'brand',label:'Tên hiển thị, biểu tượng',question:'Tên tiện ích và logo muốn dùng?',required:true,price:0},
    {key:'fields',label:'Trường dữ liệu cần lấy',question:'Bạn cần lấy những thông tin gì (tên, SĐT, email, địa chỉ, số follow, có web bán hàng không...)?',required:true,price:0},
    {key:'export',label:'Nơi xuất dữ liệu',question:'Xuất ra đâu: file Excel, Google Sheet hay gửi vào CRM?',required:true,price:0},
    {key:'scoring',label:'Thang chấm điểm riêng',question:'Có cần thang chấm điểm kênh số theo tiêu chí riêng không?',required:false,price:500000}],
   claude_notes:'Fork repo Collector. Đổi manifest, danh sách trường, đích xuất dữ liệu, thang điểm.',
   guide_md:'## Hướng dẫn cài và dùng Collector\n\n1. Tải `.zip`, giải nén, cài như mục "Tải tiện ích đã giải nén" trong Chrome.\n2. Mở website hoặc fanpage cần lấy thông tin, bấm biểu tượng tiện ích → **Thu thập**.\n3. Mở tab **Danh sách** để xem và **Xuất** ra nơi đã chọn.' },
 { kind:'media', slug:'media-reels', name:'Video ngắn Reels / TikTok', industries:'Mọi ngành', accent:'#ec4899',
   summary:'Video 15 đến 30 giây khổ dọc 9:16 dựng từ ảnh có sẵn, có chữ, nhạc, lồng tiếng AI.',
   demo_url:'', base_price:350000, days:1,
   options:[
    {key:'count',label:'Số video',question:'Bạn cần bao nhiêu video?',required:true,price:0},
    {key:'message',label:'Thông điệp, sản phẩm',question:'Mỗi video giới thiệu sản phẩm nào, thông điệp chính và lời kêu gọi là gì?',required:true,price:0},
    {key:'voice',label:'Giọng đọc',question:'Giọng đọc nam hay nữ, miền nào? Hay chỉ cần chữ và nhạc?',required:true,price:0},
    {key:'assets',label:'Ảnh/clip thô',question:'Bạn gửi ảnh hoặc clip sản phẩm được không (tải lên ở đây)?',required:true,price:0},
    {key:'brand_kit',label:'Khuôn thương hiệu dùng lại',question:'Bạn có muốn làm khuôn thương hiệu (màu, font, logo, giọng) để dùng lại cho mọi video sau không?',required:false,price:1500000}],
   claude_notes:'Dùng bộ dựng video HTML → MP4 (render.js). Kịch bản 5-6 cảnh, chữ lớn, nhạc tự soạn, xuất 9:16.',
   guide_md:'## Hướng dẫn dùng video\n\n1. Tải video MP4 trong mục Kết quả.\n2. Đăng Reels/TikTok: chọn khổ 9:16, dán chú thích gợi ý kèm theo, gắn hashtag.\n3. Giờ đăng nên chọn 11h-13h hoặc 19h-22h.' },
 { kind:'media', slug:'media-tvc', name:'Video TVC 60 đến 90 giây', industries:'Thương hiệu, OCOP, sự kiện', accent:'#f59e0b',
   summary:'Video giới thiệu thương hiệu có kịch bản, lồng tiếng, nhạc tự soạn, xuất 16:9 và 9:16 kèm phụ đề.',
   demo_url:'', base_price:4000000, days:4,
   options:[
    {key:'goal',label:'Mục đích, người xem',question:'Video dùng để làm gì và người xem chính là ai?',required:true,price:0},
    {key:'points',label:'3 ý chính',question:'3 ý quan trọng nhất video phải nói là gì?',required:true,price:0},
    {key:'length',label:'Độ dài',question:'Bạn muốn 60 giây hay 90 giây?',required:true,price:0},
    {key:'assets',label:'Tư liệu',question:'Bạn có ảnh, clip, logo để gửi không?',required:true,price:0},
    {key:'long',label:'Bản 90 giây',question:'',required:false,price:3000000}],
   claude_notes:'Dùng pipeline TVC (kịch bản → ảnh xem trước từng cảnh → lồng tiếng → render 16:9 và 9:16 + SRT).',
   guide_md:'## Hướng dẫn dùng TVC\n\n1. Tải bản 16:9 cho YouTube/website, bản 9:16 cho Reels/TikTok, file phụ đề .srt.\n2. Khi đăng YouTube, tải phụ đề lên mục Phụ đề.\n3. Có thể cắt thành 3 video ngắn (600.000đ) qua cổng khách hàng.' },
 { kind:'media', slug:'media-anh-ai', name:'Ảnh sản phẩm AI', industries:'Shopee, TikTok Shop, Facebook', accent:'#14b8a6',
   summary:'Tách nền, ghép bối cảnh theo mùa, banner đúng kích thước từng sàn, từ ảnh chụp điện thoại.',
   demo_url:'', base_price:390000, days:1,
   options:[
    {key:'count',label:'Số ảnh',question:'Bạn cần bao nhiêu ảnh (gói 20 ảnh 390.000đ)?',required:true,price:0},
    {key:'scene',label:'Bối cảnh',question:'Bối cảnh mong muốn (Tết, Trung thu, tối giản, thiên nhiên...)?',required:true,price:0},
    {key:'channels',label:'Kênh đăng',question:'Ảnh dùng cho sàn/kênh nào để xuất đúng kích thước?',required:true,price:0},
    {key:'assets',label:'Ảnh gốc',question:'Tải lên ảnh sản phẩm chụp bằng điện thoại.',required:true,price:0}],
   claude_notes:'Tách nền, ghép bối cảnh, xuất theo kích thước kênh.',
   guide_md:'## Hướng dẫn dùng ảnh\n\nẢnh đã xuất đúng kích thước từng kênh trong thư mục cùng tên. Tải về và đăng trực tiếp.' },
 { kind:'media', slug:'media-catalogue', name:'Catalogue / bảng giá PDF', industries:'Quà tặng, B2B, đại lý', accent:'#8b5cf6',
   summary:'Catalogue sản phẩm, set quà dàn trang theo nhận diện, bản PDF gửi Zalo và bản in.',
   demo_url:'', base_price:1800000, days:3,
   options:[
    {key:'pages',label:'Số trang (tối thiểu 12)',question:'Catalogue khoảng bao nhiêu trang (tối thiểu 12, 150.000đ/trang)?',required:true,price:0},
    {key:'products',label:'Danh sách sản phẩm, giá',question:'Gửi danh sách sản phẩm kèm giá (Excel hoặc ảnh chụp).',required:true,price:0},
    {key:'bilingual',label:'Song ngữ',question:'Có cần song ngữ không?',required:false,price:600000},
    {key:'print',label:'Bản in',question:'Có cần file in (bleed, CMYK) không?',required:false,price:0}],
   claude_notes:'Dàn trang HTML → PDF theo bộ build catalogue TTN.',
   guide_md:'## Hướng dẫn dùng catalogue\n\n1. Bản PDF nhẹ để gửi Zalo, bản in gửi nhà in.\n2. Cập nhật mùa sau bằng 30% phí cũ qua cổng khách hàng.' },
];
let sql = '-- Seed templates, settings, promo\n';
T.forEach((t, i) => {
  sql += `INSERT INTO templates (kind,slug,name,industries,summary,demo_url,base_price,days,options,claude_notes,guide_md,accent,sort) VALUES (${[t.kind,t.slug,t.name,t.industries,t.summary,t.demo_url||null,t.base_price,t.days,JSON.stringify(t.options),t.claude_notes,t.guide_md,t.accent,i].map(q).join(',')});\n`;
});
const S = {
  ai_provider:'claude', ai_model:'claude-opus-5-5', support_provider:'claude', support_model:'claude-opus-5-5', deepseek_model:'deepseek-chat',
  max_revisions:'2', deposit_threshold:'5000000', deposit_pct:'50', consult_price:'2000000',
  aff_commission_pct:'10', aff_discount_pct:'5', ga4_id:'', hero_title:'Mô tả ý tưởng. AI chốt yêu cầu. Nhận sản phẩm số.',
  support_kb:'Salefronts làm 3 loại sản phẩm số cho SME: Media (video Reels, TVC, ảnh sản phẩm AI, catalogue), Extension Chrome (Zalo Chăm Khách, Collector) và Web (web bán hàng, landing page, mini-shop/menu QR). Quy trình: 1) điền SĐT Zalo, họ tên, ngành, công ty; 2) chọn loại và mẫu; 3) chat với AI để chốt yêu cầu; 4) xem mockup, sửa tối đa 2 lần; 5) đăng ký tài khoản và thanh toán VietQR; 6) Salefronts duyệt và thực hiện; 7) nhận kết quả kèm hướng dẫn trong mục Tài khoản > Đơn của tôi. Đơn từ 5 triệu cọc 50%. Tư vấn AI 60 phút giá 2.000.000đ, trừ vào đơn nếu đặt làm trong 14 ngày. Hotline/Zalo 0938 266 958, email admin@salefronts.com. Giới thiệu bạn bè: người giới thiệu nhận 10% đơn đã giao, người được giới thiệu giảm 5% đơn đầu.',
};
for (const [k, v] of Object.entries(S)) sql += `INSERT INTO settings (key,value) VALUES (${q(k)},${q(v)});\n`;
sql += `INSERT INTO promos (code,type,value,max_uses,note) VALUES ('TET2027','pct',10,200,'Khuyến mãi mùa Tết');\n`;
fs.writeFileSync(new URL('../migrations/0002_seed.sql', import.meta.url), sql);
console.log('ok', T.length);
