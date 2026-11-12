import type { APIRoute } from 'astro';
import { handle, json, body, fail, cleanPhone, isPhone, randCode } from '../../lib/util';
import { first, run, track } from '../../lib/db';
import { createPayment } from '../../lib/sepay';

export const POST: APIRoute = ({ request, locals }) => handle(async () => {
  const env = locals.runtime.env; const b = await body(request); const u = locals.user;
  const phone = cleanPhone(b.phone);
  if (!isPhone(phone)) fail(400, 'Số điện thoại Zalo chưa đúng');
  if (!String(b.name || '').trim()) fail(400, 'Bạn nhập họ tên');
  for (const k of ['goal', 'budget', 'pain']) if (String(b[k] || '').trim().length < 5) fail(400, 'Bạn mô tả rõ hơn mục tiêu, ngân sách và vấn đề cần giải quyết');
  if (!b.consent) fail(400, 'Bạn cần đồng ý chính sách xử lý dữ liệu');
  let lead: any = await first(env.DB, 'SELECT * FROM leads WHERE phone=? ORDER BY id DESC LIMIT 1', phone);
  if (!lead) {
    await run(env.DB, 'INSERT INTO leads (phone,name,industry,company,email,user_id,vid,source) VALUES (?,?,?,?,?,?,?,?)', phone, b.name, b.industry || null, b.company || null, b.email || null, u?.id || null, locals.vid, 'consult');
    lead = await first(env.DB, 'SELECT * FROM leads WHERE phone=? ORDER BY id DESC LIMIT 1', phone);
  } else await run(env.DB, 'UPDATE leads SET vid=COALESCE(vid,?) WHERE id=?', locals.vid, lead.id);
  const price = Number(locals.settings.consult_price || 2000000);
  const code = randCode('TV', 6);
  await run(env.DB, 'INSERT INTO bookings (code,lead_id,user_id,goal,budget,pain,channels,current_tools,slots,detail,price) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    code, lead.id, u?.id || null, b.goal, b.budget, b.pain, b.channels || null, b.current_tools || null, b.slots || null, b.detail || null, price);
  const bk: any = await first(env.DB, 'SELECT id FROM bookings WHERE code=?', code);
  // keep the visitor link for booking payment access
  await run(env.DB, 'UPDATE leads SET vid=? WHERE id=?', locals.vid, lead.id);
  const pay = await createPayment(env, { amount: price, customer: `${b.name} ${phone}`, description: `Salefronts tu van ${code}`, booking_id: bk.id, user_id: u?.id, kind: 'booking' });
  await track(env.DB, { vid: locals.vid, user_id: u?.id, type: 'booking_create', data: { code } });
  return json({ ok: true, code, payment: pay });
});
