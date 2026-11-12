import type { APIRoute } from 'astro';
import { handle, json, body, fail, cleanPhone, isPhone, randCode, isEmail } from '../../../lib/util';
import { first, run, track } from '../../../lib/db';
import { readCookie } from '../../../lib/auth';
import { addEvent } from '../../../lib/orders';

// Create lead + order (step 1 of the request flow)
export const POST: APIRoute = ({ request, locals }) => handle(async () => {
  const env = locals.runtime.env; const b = await body(request);
  const phone = cleanPhone(b.phone); const name = String(b.name || '').trim();
  if (!isPhone(phone)) fail(400, 'Số điện thoại Zalo chưa đúng');
  if (name.length < 2) fail(400, 'Bạn nhập họ tên giúp mình nhé');
  if (b.email && !isEmail(b.email)) fail(400, 'Email chưa đúng');
  if (!b.consent) fail(400, 'Bạn cần đồng ý chính sách xử lý dữ liệu');
  const tpl: any = await first(env.DB, 'SELECT * FROM templates WHERE slug=? AND active=1', b.template);
  if (!tpl) fail(400, 'Bạn chọn một mẫu giúp mình');
  // rate limit: max 5 unpaid orders per phone per day
  const recent: any = await first(env.DB, "SELECT COUNT(*) n FROM orders o JOIN leads l ON l.id=o.lead_id WHERE l.phone=? AND o.created_at > datetime('now','-1 day') AND o.status IN ('chatting','mockup')", phone);
  if (recent.n >= 5) fail(429, 'Số này đã tạo nhiều yêu cầu hôm nay. Bạn tiếp tục yêu cầu cũ trong Tài khoản nhé.');
  const u = locals.user; const ref = readCookie(request, 'ref');
  let lead: any = await first(env.DB, 'SELECT * FROM leads WHERE phone=? ORDER BY id DESC LIMIT 1', phone);
  if (lead) {
    await run(env.DB, "UPDATE leads SET name=?, industry=COALESCE(?,industry), company=COALESCE(?,company), email=COALESCE(?,email), user_id=COALESCE(user_id,?), updated_at=datetime('now') WHERE id=?",
      name, b.industry || null, b.company || null, b.email || null, u?.id || null, lead.id);
  } else {
    await run(env.DB, 'INSERT INTO leads (phone,name,industry,company,email,user_id,vid,source,utm,ref_code) VALUES (?,?,?,?,?,?,?,?,?,?)',
      phone, name, b.industry || null, b.company || null, b.email || null, u?.id || null, locals.vid, 'web_request', b.utm || null, ref);
    lead = await first(env.DB, 'SELECT * FROM leads WHERE phone=? ORDER BY id DESC LIMIT 1', phone);
  }
  const code = randCode('YC', 6);
  await run(env.DB, 'INSERT INTO orders (code,lead_id,user_id,vid,kind,template_id,ref_code,price,total) VALUES (?,?,?,?,?,?,?,?,?)',
    code, lead.id, u?.id || null, locals.vid, tpl.kind, tpl.id, ref, tpl.base_price, tpl.base_price);
  const o: any = await first(env.DB, 'SELECT id FROM orders WHERE code=?', code);
  await addEvent(env, o.id, 'chatting', `Tạo yêu cầu, mẫu "${tpl.name}"`, 'customer');
  await track(env.DB, { vid: locals.vid, user_id: u?.id, type: 'request_start', data: { code, template: tpl.slug }, ip: request.headers.get('cf-connecting-ip'), ua: request.headers.get('user-agent') });
  return json({ ok: true, code });
});
