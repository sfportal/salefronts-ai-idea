import { first, run } from './db';
import { fail } from './util';

// Credit or debit a wallet. `ref` makes the operation idempotent (same ref never applies twice).
export async function walletApply(env: Env, user_id: number, amount: number, kind: string, ref: string, note = '') {
  if (await first(env.DB, 'SELECT 1 FROM wallet_tx WHERE ref=?', ref)) return null;
  if (amount < 0) {
    // conditional debit: only succeeds when the balance covers it
    const r: any = await env.DB.prepare('UPDATE users SET wallet_balance=wallet_balance+? WHERE id=? AND wallet_balance>=?').bind(amount, user_id, -amount).run();
    if (!r.meta?.changes) fail(402, 'Số dư ví không đủ. Bạn nạp thêm để tiếp tục nhé.');
  } else {
    await run(env.DB, 'UPDATE users SET wallet_balance=wallet_balance+? WHERE id=?', amount, user_id);
  }
  const u: any = await first(env.DB, 'SELECT wallet_balance FROM users WHERE id=?', user_id);
  await run(env.DB, 'INSERT INTO wallet_tx (user_id,amount,kind,ref,note,balance_after) VALUES (?,?,?,?,?,?)', user_id, amount, kind, ref, note, u.wallet_balance);
  return u.wallet_balance as number;
}
export async function walletBalance(env: Env, user_id: number) {
  const u: any = await first(env.DB, 'SELECT wallet_balance FROM users WHERE id=?', user_id); return Number(u?.wallet_balance || 0);
}
