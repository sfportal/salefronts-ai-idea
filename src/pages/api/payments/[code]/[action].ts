import type { APIRoute } from 'astro';
import { handle, json, fail } from '../../../../lib/util';
import { first, run, audit } from '../../../../lib/db';
import { refreshPayment } from '../../../../lib/sepay';
import { onPaymentPaid } from '../../../../lib/orders';
import { isStaff } from '../../../../lib/access';

async function load(env: Env, code: string, locals: App.Locals) {
  const p: any = await first(env.DB, 'SELECT * FROM payments WHERE code=?', code.toUpperCase());
  if (!p) fail(404, 'Không có giao dịch');
  const u = locals.user;
  if (!isStaff(u) && !(u && p.user_id === u.id)) {
    // booking payments may be made before login: allow same browser via the booking's lead vid
    const b: any = p.booking_id ? await first(env.DB, 'SELECT l.vid FROM bookings b JOIN leads l ON l.id=b.lead_id WHERE b.id=?', p.booking_id) : null;
    if (!b || b.vid !== locals.vid) fail(403, 'Không có quyền');
  }
  return p;
}

export const GET: APIRoute = ({ params, locals }) => handle(async () => {
  const env = locals.runtime.env; let p = await load(env, params.code!, locals);
  if (params.action !== 'status') fail(404, 'Không có');
  if (await refreshPayment(env, p)) { p = await first(env.DB, 'SELECT * FROM payments WHERE id=?', p.id); await onPaymentPaid(env, p); }
  return json({ ok: true, status: p.status, amount: p.amount, paid_at: p.paid_at });
});

// Demo mode only: simulate a bank transfer (no SePay key configured). Staff can also confirm manual transfers.
export const POST: APIRoute = ({ params, locals }) => handle(async () => {
  const env = locals.runtime.env; const p = await load(env, params.code!, locals);
  if (params.action !== 'confirm') fail(404, 'Không có');
  if (p.status !== 'pending') return json({ ok: true, status: p.status });
  const staff = isStaff(locals.user);
  if (!(p.provider === 'demo' || staff)) fail(403, 'Chỉ quản trị viên xác nhận thủ công được');
  await run(env.DB, "UPDATE payments SET status='paid', paid_at=datetime('now') WHERE id=?", p.id);
  await audit(env.DB, locals.user?.email || 'demo', staff ? 'payment.manual_confirm' : 'payment.demo_confirm', p.code);
  await onPaymentPaid(env, { ...p, status: 'paid' });
  return json({ ok: true, status: 'paid' });
});
