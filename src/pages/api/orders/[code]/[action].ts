import { putFile } from '../../../../lib/storage';
import type { APIRoute } from 'astro';
import { handle, json, body, fail, parseJSON } from '../../../../lib/util';
import { all, first, run, track, getSettings } from '../../../../lib/db';
import { loadOrder } from '../../../../lib/access';
import { interview, missingRequired, priceFor, buildBriefMd, makeMockup, tplOptions, type ChatMsg, type MockAsset } from '../../../../lib/ai';
import { getFile } from '../../../../lib/storage';
import { addEvent, setStatus, promoDiscount, referralDiscount, expireStale, STATUS } from '../../../../lib/orders';
import { createPayment, payMode } from '../../../../lib/sepay';

function progressOf(tpl: any, fields: Record<string, string>) {
  const req = tplOptions(tpl).filter((x) => x.required); const miss = missingRequired(tpl, fields);
  return { filled: req.length - miss.length, total: req.length, missing: miss.map((m) => m.label) };
}
// Customer images (logo, product photos) embedded in the mockup as data URIs: small files only.
async function mockAssets(env: Env, order_id: number): Promise<MockAsset[]> {
  const rows = await all<any>(env.DB, "SELECT * FROM files WHERE order_id=? AND kind='upload' AND type LIKE 'image/%' AND size <= 450000 ORDER BY (name LIKE '%logo%') DESC, id LIMIT 6", order_id);
  const out: MockAsset[] = []; let total = 0;
  for (const f of rows) {
    if (total + f.size > 1_600_000) break;
    const body = await getFile(env, f.key); if (!body) continue;
    const buf = new Uint8Array(await new Response(body).arrayBuffer()); let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    out.push({ name: f.name, data: `data:${f.type};base64,${btoa(bin)}` }); total += f.size;
  }
  return out;
}

async function state(env: Env, o: any) {
  const [tpl, lead, msgs, files, pays, events] = await Promise.all([
    first<any>(env.DB, 'SELECT id,kind,slug,name,summary,options,base_price,days,accent,demo_url FROM templates WHERE id=?', o.template_id),
    first<any>(env.DB, 'SELECT name,phone,industry,company,email FROM leads WHERE id=?', o.lead_id),
    all<any>(env.DB, "SELECT role,content,created_at FROM messages WHERE order_id=? AND role!='system' ORDER BY id", o.id),
    all<any>(env.DB, "SELECT id,name,size,type,kind,created_at FROM files WHERE order_id=? ORDER BY id", o.id),
    all<any>(env.DB, 'SELECT code,amount,status,qr_url,kind,provider,created_at,paid_at FROM payments WHERE order_id=? ORDER BY id', o.id),
    all<any>(env.DB, 'SELECT status,note,created_at FROM order_events WHERE order_id=? ORDER BY id', o.id),
  ]);
  const fields = parseJSON<Record<string, string>>(o.fields, {});
  const options = tplOptions(tpl);
  const req = options.filter((x) => x.required);
  const filled = req.filter((x) => String(fields[x.key] || '').trim()).length;
  const locked = o.status === 'delivered' && o.paid_amount < o.total;
  return {
    order: {
      code: o.code, kind: o.kind, status: o.status, status_label: STATUS[o.status]?.label, brief_md: o.brief_md, mockup_html: o.mockup_html,
      revisions_used: o.revisions_used, price: o.price, custom_price: o.custom_price, discount: o.discount, promo_code: o.promo_code, total: o.total,
      paid_amount: o.paid_amount, out_of_template: !!o.out_of_template, out_of_template_note: o.out_of_template_note, reject_reason: o.reject_reason,
      deliverables: locked ? [] : parseJSON(o.deliverables, []), guide_md: locked ? null : o.guide_md, locked, created_at: o.created_at,
      submitted_at: o.submitted_at, pay_deadline: o.pay_deadline,
    },
    template: { ...tpl, options }, lead, messages: msgs, files, payments: pays, events,
    progress: { filled, total: req.length, missing: req.filter((x) => !String(fields[x.key] || '').trim()).map((x) => x.label) },
    fields: Object.fromEntries(Object.entries(fields).filter(([k]) => !k.startsWith('__'))),
    pay_mode: payMode(env),
    ...(await getSettings(env.DB).then((x) => ({ contact_hours: Number(x.contact_hours || 8), pay_days: Number(x.pay_days || 5), deposit_threshold: Number(x.deposit_threshold || 5e6), deposit_pct: Number(x.deposit_pct || 50) }))),
  };
}

export const GET: APIRoute = ({ params, locals }) => handle(async () => {
  const env = locals.runtime.env; const o = await loadOrder(env, params.code!, locals);
  if (params.action !== 'state') fail(404, 'Không có');
  return json({ ok: true, ...(await state(env, o)) });
});

export const POST: APIRoute = ({ params, request, locals }) => handle(async () => {
  const env = locals.runtime.env; const s = locals.settings; const u = locals.user;
  let o = await loadOrder(env, params.code!, locals);
  const tpl: any = await first(env.DB, 'SELECT * FROM templates WHERE id=?', o.template_id);
  const lead: any = await first(env.DB, 'SELECT * FROM leads WHERE id=?', o.lead_id);
  const fields = parseJSON<Record<string, string>>(o.fields, {});
  const maxRev = Number(s.max_revisions || 2);
  const act = params.action;

  if (act === 'chat') {
    if (!['chatting', 'mockup'].includes(o.status)) fail(400, 'Yêu cầu đã chốt, không chat thêm được');
    if (o.status === 'mockup') fail(400, 'Đã có mockup. Bạn dùng ô "Yêu cầu sửa" để chỉnh nhé.');
    const b = await body(request); const text = String(b.text || '').trim().slice(0, 3000);
    if (!text) fail(400, 'Tin nhắn trống');
    const count: any = await first(env.DB, "SELECT COUNT(*) n FROM messages WHERE order_id=? AND role='user'", o.id);
    if (count.n >= 40) fail(429, 'Phiên chat đã dài, bạn bấm "Tổng kết" hoặc nhắn Zalo để được hỗ trợ.');
    const history = await all<ChatMsg>(env.DB, "SELECT role,content FROM messages WHERE order_id=? AND role IN ('user','assistant') ORDER BY id", o.id);
    const isStart = text === '[Bắt đầu]';
    if (!isStart) await run(env.DB, 'INSERT INTO messages (order_id,role,content) VALUES (?,?,?)', o.id, 'user', text);
    const r = await interview(env, s, { lead, tpl, fields, history, userText: isStart ? '[Bắt đầu] Chào bạn, mình muốn bắt đầu.' : text });
    const merged = { ...fields, ...r.fields };
    await run(env.DB, 'INSERT INTO messages (order_id,role,content) VALUES (?,?,?)', o.id, 'assistant', r.reply);
    let oot = '';
    if (r.out_of_template && r.out_note) {
      oot = (o.out_of_template_note ? o.out_of_template_note + '\n' : '') + r.out_note;
      await run(env.DB, 'UPDATE orders SET out_of_template=1, out_of_template_note=? WHERE id=?', oot, o.id);
      const ex: any = await first(env.DB, "SELECT id FROM template_requests WHERE order_id=?", o.id);
      if (ex) await run(env.DB, 'UPDATE template_requests SET detail=? WHERE id=?', oot, ex.id);
      else await run(env.DB, 'INSERT INTO template_requests (kind,title,detail,order_id) VALUES (?,?,?,?)', tpl.kind, `${tpl.name}: ${r.out_note.slice(0, 80)}`, r.out_note, o.id);
    }
    await run(env.DB, "UPDATE orders SET fields=?, updated_at=datetime('now') WHERE id=?", JSON.stringify(merged), o.id);
    const miss = missingRequired(tpl, merged);
    return json({ ok: true, reply: r.reply, done: r.done || miss.length === 0, out_of_template: !!(oot || o.out_of_template), progress: progressOf(tpl, merged),
      fields: Object.fromEntries(Object.entries(merged).filter(([k]) => !k.startsWith('__'))) });
  }

  if (act === 'fields') {
    // customer edits the requirement form directly
    if (o.status !== 'chatting') fail(400, 'Phiếu đã chốt. Bạn dùng ô "Yêu cầu sửa" để chỉnh mockup nhé.');
    const b = await body(request); const allowed = new Set([...tplOptions(tpl).map((x) => x.key), 'notes']);
    for (const [k, v] of Object.entries(b.fields || {})) if (allowed.has(k)) fields[k] = String(v ?? '').slice(0, 2000).trim();
    if (fields.__asked && String(fields[fields.__asked] || '').trim()) fields.__asked = ''; // answered in the form, AI moves on
    await run(env.DB, "UPDATE orders SET fields=?, updated_at=datetime('now') WHERE id=?", JSON.stringify(fields), o.id);
    return json({ ok: true, progress: progressOf(tpl, fields), fields: Object.fromEntries(Object.entries(fields).filter(([k]) => !k.startsWith('__'))) });
  }

  if (act === 'upload') {
    const fd = await request.formData(); const f = fd.get('file') as File | null;
    if (!f || typeof f === 'string') fail(400, 'Chưa chọn tệp');
    if (['cancelled', 'rejected'].includes(o.status)) fail(400, 'Yêu cầu đã huỷ');
    if (f.size > 20 * 1024 * 1024) fail(400, 'Tệp tối đa 20MB');
    const n: any = await first(env.DB, 'SELECT COUNT(*) n FROM files WHERE order_id=?', o.id);
    if (n.n >= 30) fail(400, 'Tối đa 30 tệp mỗi yêu cầu');
    const key = `orders/${o.code}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, '_').slice(-80)}`;
    await putFile(env, key, f);
    await run(env.DB, 'INSERT INTO files (order_id,key,name,size,type,kind) VALUES (?,?,?,?,?,?)', o.id, key, f.name, f.size, f.type, 'upload');
    await run(env.DB, 'INSERT INTO messages (order_id,role,content) VALUES (?,?,?)', o.id, 'user', `[Đã tải tệp: ${f.name}]`);
    if (/logo/i.test(f.name) && /^image\//.test(f.type) && !String(fields.logo || '').trim()) {
      fields.logo = 'Đã tải lên: ' + f.name; if (fields.__asked === 'logo') fields.__asked = '';
      await run(env.DB, 'UPDATE orders SET fields=? WHERE id=?', JSON.stringify(fields), o.id);
    }
    return json({ ok: true, name: f.name });
  }

  if (act === 'mockup' || act === 'revise') {
    const b = await body(request);
    if (act === 'mockup') {
      if (o.status !== 'chatting') fail(400, 'Mockup đã được tạo');
      const miss = missingRequired(tpl, fields); if (miss.length) fail(400, 'Còn thiếu: ' + miss.map((m) => m.label).join(', '));
    } else {
      if (o.status !== 'mockup') fail(400, 'Chưa có mockup để sửa');
      if (o.revisions_used >= maxRev) fail(400, `Bạn đã dùng hết ${maxRev} lần sửa. Thanh toán để gửi yêu cầu nhé.`);
      if (!String(b.feedback || '').trim()) fail(400, 'Bạn ghi rõ muốn sửa gì');
    }
    const feedback = act === 'revise' ? String(b.feedback).slice(0, 2000) : undefined;
    if (feedback) {
      await run(env.DB, 'INSERT INTO messages (order_id,role,content) VALUES (?,?,?)', o.id, 'user', '[Yêu cầu sửa] ' + feedback);
      const prev = fields.__revisions ? fields.__revisions + '\n' : '';
      fields.__revisions = prev + `Lần ${o.revisions_used + 1}: ${feedback}`;
    }
    const assets = await mockAssets(env, o.id);
    const html = await makeMockup(env, s, { lead, tpl, fields, previous: o.mockup_html, feedback, assets });
    const price = priceFor(tpl, fields);
    const fileNames = (await all<any>(env.DB, "SELECT name FROM files WHERE order_id=? AND kind='upload' ORDER BY id", o.id)).map((f) => f.name);
    const brief = buildBriefMd(o, lead, tpl, fields, price, fileNames) + (fields.__revisions ? `\n### Góp ý đã sửa\n\n${fields.__revisions.split('\n').map((l) => '- ' + l).join('\n')}\n` : '');
    await run(env.DB, `UPDATE orders SET status='mockup', mockup_html=?, mockup_version=mockup_version+1, revisions_used=revisions_used+?, brief=?, brief_md=?, price=?, total=?, fields=?, updated_at=datetime('now') WHERE id=?`,
      html, act === 'revise' ? 1 : 0, JSON.stringify(price), brief, price.total, (o.custom_price || 0) + price.total, JSON.stringify(fields), o.id);
    await addEvent(env, o.id, 'mockup', act === 'revise' ? `Sửa mockup lần ${o.revisions_used + 1}` : 'Tạo phiếu yêu cầu và mockup', 'customer');
    await track(env.DB, { vid: locals.vid, user_id: u?.id, type: act === 'revise' ? 'mockup_revise' : 'mockup_view', data: { code: o.code } });
    o = await first(env.DB, 'SELECT * FROM orders WHERE id=?', o.id);
    return json({ ok: true, ...(await state(env, o)) });
  }

  if (act === 'quote') {
    if (o.status !== 'mockup' || !o.out_of_template) fail(400, 'Không cần báo giá');
    await setStatus(env, o, 'quote_pending', 'Khách gửi yêu cầu báo giá phần ngoài mẫu', 'customer');
    return json({ ok: true });
  }

  if (act === 'submit') {
    // Step "Gửi yêu cầu": lock the brief, apply promo, open a 5-day payment window. Staff contacts within 8h.
    if (!u) fail(401, 'Bạn cần tạo tài khoản trước khi gửi yêu cầu');
    if (o.status !== 'mockup') fail(400, 'Yêu cầu chưa sẵn sàng để gửi');
    if (o.out_of_template && o.custom_price === null) fail(400, 'Phần ngoài mẫu cần Salefronts báo giá trước');
    const b = await body(request);
    const subtotal = o.price + (o.custom_price || 0);
    const promo = await promoDiscount(env, b.promo || '', o.kind, subtotal);
    if (b.promo && promo.error) fail(400, promo.error);
    const refDisc = promo.discount ? 0 : await referralDiscount(env, u, subtotal);
    const discount = promo.discount + refDisc; const total = Math.max(0, subtotal - discount);
    const days = Number(s.pay_days || 5);
    await run(env.DB, `UPDATE orders SET discount=?, promo_code=?, total=?, user_id=?, submitted_at=datetime('now'), pay_deadline=datetime('now','+${days} days'), updated_at=datetime('now') WHERE id=?`, discount, promo.code, total, u.id, o.id);
    await setStatus(env, o, 'awaiting_payment', `Khách gửi yêu cầu. Hạn thanh toán ${days} ngày, nhân viên liên hệ trong ${s.contact_hours || 8} giờ.`, 'customer');
    await run(env.DB, "UPDATE leads SET stage=CASE WHEN stage IN ('new','contacted') THEN 'quoted' ELSE stage END, updated_at=datetime('now') WHERE id=?", o.lead_id);
    await track(env.DB, { vid: locals.vid, user_id: u.id, type: 'request_submit', data: { code: o.code, total } });
    o = await first(env.DB, 'SELECT * FROM orders WHERE id=?', o.id);
    return json({ ok: true, ...(await state(env, o)) });
  }

  if (act === 'checkout') {
    // Create (or reuse) the VietQR payment for a submitted request.
    if (!u) fail(401, 'Bạn cần đăng nhập');
    await expireStale(env, true);
    o = await first(env.DB, 'SELECT * FROM orders WHERE id=?', o.id);
    if (o.status !== 'awaiting_payment') fail(400, o.status === 'cancelled' ? 'Yêu cầu đã quá hạn thanh toán và bị huỷ. Bạn tạo yêu cầu mới nhé.' : 'Yêu cầu chưa ở bước thanh toán');
    const p: any = await first(env.DB, "SELECT * FROM payments WHERE order_id=? AND status='pending' ORDER BY id DESC LIMIT 1", o.id);
    const total = o.total;
    const deposit = total >= Number(s.deposit_threshold || 5e6) ? Math.round(total * Number(s.deposit_pct || 50) / 100) : total;
    if (p) return json({ ok: true, payment: p, total, deposit: p.amount });
    const pay = await createPayment(env, { amount: deposit, customer: `${lead.name} ${lead.phone}`, description: `Salefronts ${o.code}`, order_id: o.id, user_id: u.id, kind: deposit < total ? 'deposit' : 'full' });
    await addEvent(env, o.id, null, `Tạo mã QR thanh toán ${deposit.toLocaleString('vi-VN')}đ${deposit < total ? ' (cọc)' : ''}`, 'customer');
    await track(env.DB, { vid: locals.vid, user_id: u.id, type: 'checkout', data: { code: o.code, amount: deposit } });
    return json({ ok: true, payment: pay, total, deposit });
  }

  if (act === 'pay-balance') {
    if (!u) fail(401, 'Bạn cần đăng nhập');
    const remain = o.total - o.paid_amount; if (remain <= 0) fail(400, 'Đơn đã thanh toán đủ');
    if (!['in_progress', 'delivered'].includes(o.status)) fail(400, 'Chưa tới bước thanh toán phần còn lại');
    let p: any = await first(env.DB, "SELECT * FROM payments WHERE order_id=? AND status='pending' AND kind='balance'", o.id);
    if (!p) p = await createPayment(env, { amount: remain, customer: `${lead.name} ${lead.phone}`, description: `Salefronts ${o.code} con lai`, order_id: o.id, user_id: u.id, kind: 'balance' });
    return json({ ok: true, payment: p });
  }

  if (act === 'cancel') {
    if (!['chatting', 'mockup', 'quote_pending', 'awaiting_payment'].includes(o.status)) fail(400, 'Không huỷ được ở bước này');
    await run(env.DB, "UPDATE payments SET status='cancelled' WHERE order_id=? AND status='pending'", o.id);
    await setStatus(env, o, 'cancelled', 'Khách huỷ yêu cầu', 'customer');
    return json({ ok: true });
  }
  fail(404, 'Không có thao tác này');
  return json({});
});
