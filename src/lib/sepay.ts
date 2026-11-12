// Payment via sepay-thuchi API v1 (/api/v1/payment-requests). Falls back to a demo mode without an API key.
import { first, run } from './db';
import { randCode } from './util';

export const payMode = (env: Env) => (env.SEPAY_API_KEY ? 'live' : 'demo');

export async function createPayment(env: Env, p: { amount: number; customer: string; description: string; order_id?: number; booking_id?: number; user_id?: number; kind: string }) {
  const code = randCode('SF', 6);
  let qr: string | null = null, acc: string | null = null, bank: string | null = null, finalCode = code;
  if (env.SEPAY_API_KEY) {
    const r = await fetch(env.SEPAY_BASE + '/api/v1/payment-requests', {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + env.SEPAY_API_KEY },
      body: JSON.stringify({ amount: p.amount, customer: p.customer, description: p.description, code }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok || d.status !== 'success') throw new Error('SePay: ' + (d.message || r.status));
    finalCode = d.data.code; qr = d.data.qr_image_url; acc = d.data.account_number; bank = d.data.bank;
  } else {
    qr = `https://vietqr.app/img?${new URLSearchParams({ acc: '0000000000', bank: 'TPBank', amount: String(p.amount), des: code, template: 'compact' })}`;
    acc = 'DEMO'; bank = 'DEMO';
  }
  await run(env.DB, 'INSERT INTO payments (order_id,booking_id,user_id,code,amount,qr_url,account_number,bank,kind,provider) VALUES (?,?,?,?,?,?,?,?,?,?)',
    p.order_id || null, p.booking_id || null, p.user_id || null, finalCode, p.amount, qr, acc, bank, p.kind, env.SEPAY_API_KEY ? 'sepay' : 'demo');
  return first<any>(env.DB, 'SELECT * FROM payments WHERE code=?', finalCode);
}

// Ask SePay for the latest status. Returns true when the payment just became paid.
export async function refreshPayment(env: Env, pay: any): Promise<boolean> {
  if (pay.status !== 'pending' || pay.provider !== 'sepay' || !env.SEPAY_API_KEY) return false;
  const r = await fetch(env.SEPAY_BASE + '/api/v1/payment-requests/' + pay.code, { headers: { Authorization: 'Bearer ' + env.SEPAY_API_KEY } });
  if (!r.ok) return false;
  const d: any = await r.json().catch(() => null);
  if (d?.data?.status === 'paid') {
    await run(env.DB, "UPDATE payments SET status='paid', paid_at=COALESCE(?,datetime('now')) WHERE id=? AND status='pending'", d.data.paid_at || null, pay.id);
    return true;
  }
  return false;
}
