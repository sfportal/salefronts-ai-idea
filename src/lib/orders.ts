import { all, first, run, getSettings } from './db';
import { handoffMd } from './ai';
import { parseJSON } from './util';

export const STATUS: Record<string, { label: string; tone: string; step: number }> = {
  chatting: { label: 'Đang chốt yêu cầu', tone: 'info', step: 1 },
  mockup: { label: 'Đã có mockup', tone: 'info', step: 2 },
  quote_pending: { label: 'Chờ báo giá ngoài mẫu', tone: 'warn', step: 2 },
  awaiting_payment: { label: 'Chờ thanh toán', tone: 'warn', step: 3 },
  paid: { label: 'Đã thanh toán, chờ duyệt', tone: 'warn', step: 4 },
  in_progress: { label: 'Đang thực hiện', tone: 'info', step: 5 },
  delivered: { label: 'Đã giao kết quả', tone: 'good', step: 6 },
  rejected: { label: 'Bị trả lại', tone: 'bad', step: 0 },
  cancelled: { label: 'Đã huỷ', tone: 'bad', step: 0 },
};
export const STEPS = ['Chốt yêu cầu', 'Mockup', 'Thanh toán', 'Duyệt', 'Thực hiện', 'Nhận kết quả'];
export const KIND_LABEL: Record<string, string> = { web: 'Web', extension: 'Extension', media: 'Media' };

export async function addEvent(env: Env, order_id: number, status: string | null, note: string, actor = 'system') {
  await run(env.DB, 'INSERT INTO order_events (order_id,status,note,actor) VALUES (?,?,?,?)', order_id, status, note, actor);
}
export async function setStatus(env: Env, order: any, status: string, note: string, actor = 'system', extra = '') {
  await run(env.DB, `UPDATE orders SET status=?, updated_at=datetime('now') ${extra} WHERE id=?`, status, order.id);
  await addEvent(env, order.id, status, note, actor);
}

// Called once a payment is confirmed (live or demo).
// Requests submitted but not paid within the deadline are cancelled automatically.
let lastSweep = 0;
export async function expireStale(env: Env, force = false) {
  if (!force && Date.now() - lastSweep < 60_000) return; lastSweep = Date.now();
  const rows = await all<any>(env.DB, "SELECT * FROM orders WHERE status='awaiting_payment' AND pay_deadline IS NOT NULL AND pay_deadline < datetime('now') LIMIT 50");
  for (const o of rows) {
    await run(env.DB, "UPDATE payments SET status='cancelled' WHERE order_id=? AND status='pending'", o.id);
    await setStatus(env, o, 'cancelled', 'Quá hạn thanh toán, yêu cầu tự huỷ', 'system');
  }
}

export async function onPaymentPaid(env: Env, pay: any) {
  if (pay.kind === 'topup' && pay.user_id) {
    const { walletApply } = await import('./wallet');
    await walletApply(env, pay.user_id, pay.amount, 'topup', 'pay:' + pay.code, 'Nạp ví qua chuyển khoản ' + pay.code);
    return;
  }
  if (pay.order_id) {
    const o: any = await first(env.DB, 'SELECT * FROM orders WHERE id=?', pay.order_id);
    if (!o) return;
    const paid = (await first<any>(env.DB, "SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id=? AND status='paid'", o.id)).s;
    await run(env.DB, "UPDATE orders SET paid_amount=?, updated_at=datetime('now') WHERE id=?", paid, o.id);
    if (o.status === 'awaiting_payment') {
      await setStatus(env, o, 'paid', `Đã nhận ${pay.amount.toLocaleString('vi-VN')}đ (${pay.code}). Chờ Salefronts duyệt.`, 'sepay', ", paid_at=datetime('now')");
      if (o.promo_code) await run(env.DB, 'UPDATE promos SET used=used+1 WHERE code=?', o.promo_code);
      await run(env.DB, "UPDATE leads SET stage='won', updated_at=datetime('now') WHERE id=?", o.lead_id);
    } else if (pay.kind === 'balance') {
      await addEvent(env, o.id, null, `Đã nhận phần còn lại ${pay.amount.toLocaleString('vi-VN')}đ. Kết quả đã mở khoá.`, 'sepay');
    }
  }
  if (pay.booking_id) {
    await run(env.DB, "UPDATE bookings SET status='paid' WHERE id=? AND status='awaiting_payment'", pay.booking_id);
  }
}

export async function sendHandoff(env: Env, order: any, origin: string) {
  const [lead, tpl, files] = await Promise.all([
    first<any>(env.DB, 'SELECT * FROM leads WHERE id=?', order.lead_id),
    first<any>(env.DB, 'SELECT * FROM templates WHERE id=?', order.template_id),
    all<any>(env.DB, "SELECT * FROM files WHERE order_id=? AND kind='upload'", order.id),
  ]);
  const md = handoffMd(order, lead, tpl, parseJSON(order.fields, {}), files, origin);
  let status = 'ready';
  if (env.HANDOFF_WEBHOOK_URL) {
    try {
      const r = await fetch(env.HANDOFF_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(env.HANDOFF_WEBHOOK_TOKEN ? { Authorization: 'Bearer ' + env.HANDOFF_WEBHOOK_TOKEN } : {}) },
        body: JSON.stringify({ project: 'uyminh-6', order_code: order.code, text: md }),
      });
      status = r.ok ? 'sent' : 'failed:' + r.status;
    } catch (e: any) { status = 'failed:' + e.message; }
  }
  await run(env.DB, 'UPDATE orders SET handoff_md=?, handoff_status=? WHERE id=?', md, status, order.id);
  return { md, status };
}

export async function referralDiscount(env: Env, user: any, orderTotal: number) {
  if (!user?.referred_by) return 0;
  const s = await getSettings(env.DB);
  const prev = await first<any>(env.DB, "SELECT COUNT(*) n FROM orders WHERE user_id=? AND status IN ('paid','in_progress','delivered')", user.id);
  if (prev.n > 0) return 0;
  return Math.round(orderTotal * Number(s.aff_discount_pct || 0) / 100);
}

export async function promoDiscount(env: Env, code: string, kind: string, total: number) {
  if (!code) return { discount: 0, code: null as string | null, error: '' };
  const p: any = await first(env.DB, 'SELECT * FROM promos WHERE code=? AND active=1', code.trim().toUpperCase());
  if (!p) return { discount: 0, code: null, error: 'Mã khuyến mãi không tồn tại' };
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if ((p.starts_at && p.starts_at > now) || (p.ends_at && p.ends_at < now)) return { discount: 0, code: null, error: 'Mã đã hết hạn' };
  if (p.max_uses && p.used >= p.max_uses) return { discount: 0, code: null, error: 'Mã đã hết lượt' };
  if (p.kinds && !p.kinds.split(',').includes(kind)) return { discount: 0, code: null, error: 'Mã không áp dụng cho loại này' };
  if (total < p.min_total) return { discount: 0, code: null, error: 'Đơn chưa đạt giá trị tối thiểu' };
  return { discount: p.type === 'pct' ? Math.round(total * p.value / 100) : Math.min(total, p.value), code: p.code, error: '' };
}
