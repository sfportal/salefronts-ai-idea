import type { APIRoute } from 'astro';
import { handle, json, body, fail } from '../../../lib/util';
import { all, first, run, track } from '../../../lib/db';
import { createPayment } from '../../../lib/sepay';
import { walletApply, walletBalance } from '../../../lib/wallet';

export const GET: APIRoute = ({ params, locals }) => handle(async () => {
  const env = locals.runtime.env; const u = locals.user; if (!u) fail(401, 'Bạn cần đăng nhập');
  if (params.action !== 'balance') fail(404, 'Không có');
  const tx = await all(env.DB, 'SELECT amount,kind,note,balance_after,created_at FROM wallet_tx WHERE user_id=? ORDER BY id DESC LIMIT 50', u.id);
  return json({ ok: true, balance: await walletBalance(env, u.id), tx });
});

export const POST: APIRoute = ({ params, request, locals }) => handle(async () => {
  const env = locals.runtime.env; const u = locals.user; if (!u) fail(401, 'Bạn cần đăng nhập');
  const b = await body(request); const s = locals.settings;
  if (params.action === 'topup') {
    const amount = Math.round(Number(b.amount) || 0); const min = Number(s.wallet_min_topup || 50000);
    if (amount < min) fail(400, `Nạp tối thiểu ${min.toLocaleString('vi-VN')}đ`);
    if (amount > 50_000_000) fail(400, 'Mỗi lần nạp tối đa 50.000.000đ');
    const open: any = await first(env.DB, "SELECT COUNT(*) n FROM payments WHERE user_id=? AND kind='topup' AND status='pending' AND created_at > datetime('now','-1 day')", u.id);
    if (open.n >= 5) fail(429, 'Bạn có nhiều lệnh nạp chưa thanh toán, dùng lại lệnh cũ hoặc đợi ít phút nhé.');
    const pay = await createPayment(env, { amount, customer: `${u.name || ''} ${u.email}`.trim(), description: `Salefronts nap vi`, user_id: u.id, kind: 'topup' });
    await track(env.DB, { vid: locals.vid, user_id: u.id, type: 'wallet_topup_start', data: { amount } });
    return json({ ok: true, payment: pay });
  }
  if (params.action === 'studio-export') {
    // charge the wallet for one studio export (image or video)
    const t: any = await first(env.DB, 'SELECT * FROM studio_templates WHERE id=? AND active=1', Number(b.template_id));
    if (!t) fail(404, 'Mẫu không còn');
    await run(env.DB, 'INSERT INTO studio_exports (user_id,template_id,price,title) VALUES (?,?,?,?)', u.id, t.id, t.price, String(b.title || '').slice(0, 120));
    const ex: any = await first(env.DB, 'SELECT id FROM studio_exports WHERE user_id=? ORDER BY id DESC LIMIT 1', u.id);
    let balance: number | null = await walletBalance(env, u.id);
    if (t.price > 0) {
      try { balance = await walletApply(env, u.id, -t.price, 'spend', 'studio:' + ex.id, `Xuất ${t.kind === 'video' ? 'video' : 'ảnh'} "${t.name}"`); }
      catch (e) { await run(env.DB, 'DELETE FROM studio_exports WHERE id=?', ex.id); throw e; }
    }
    await track(env.DB, { vid: locals.vid, user_id: u.id, type: 'studio_export', data: { template: t.id, price: t.price } });
    return json({ ok: true, export_id: ex.id, balance });
  }
  fail(404, 'Không có thao tác này');
  return json({});
});
