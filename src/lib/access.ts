import { first, run } from './db';
import { fail } from './util';
import { ROLE_LEVEL } from './auth';

export const isStaff = (u: any) => !!u && (ROLE_LEVEL[u.role] ?? 0) >= ROLE_LEVEL.staff;

// Load an order the current visitor may see: same browser (vid), same account, or staff.
export async function loadOrder(env: Env, code: string, locals: App.Locals) {
  const o: any = await first(env.DB, 'SELECT * FROM orders WHERE code=?', String(code || '').toUpperCase());
  if (!o) fail(404, 'Không tìm thấy yêu cầu');
  const u = locals.user;
  const ok = isStaff(u) || (u && o.user_id === u.id) || (!o.user_id && o.vid === locals.vid);
  if (!ok) fail(403, u ? 'Yêu cầu này thuộc tài khoản khác' : 'Bạn cần đăng nhập để xem yêu cầu này');
  // attach to account once the visitor logs in
  if (u && !o.user_id && o.vid === locals.vid) { await run(env.DB, 'UPDATE orders SET user_id=? WHERE id=?', u.id, o.id); await run(env.DB, 'UPDATE leads SET user_id=COALESCE(user_id,?) WHERE id=?', u.id, o.lead_id); o.user_id = u.id; }
  return o;
}
