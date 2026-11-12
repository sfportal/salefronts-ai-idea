import type { APIRoute } from 'astro';
import { handle, json, body, fail } from '../../../lib/util';
import { first, run, track } from '../../../lib/db';
import { verifyPassword, sessionCookie } from '../../../lib/auth';

export const POST: APIRoute = ({ request, locals }) => handle(async () => {
  const env = locals.runtime.env; const b = await body(request);
  const em = String(b.email || '').trim().toLowerCase();
  if (em === (env.OWNER_EMAIL || '').toLowerCase()) fail(400, 'Tài khoản owner đăng nhập bằng Google');
  const u: any = await first(env.DB, 'SELECT * FROM users WHERE email=? AND active=1', String(b.email || '').trim().toLowerCase());
  if (!u || !(await verifyPassword(String(b.password || ''), u.password_hash))) { await new Promise((r) => setTimeout(r, 400)); fail(401, 'Sai email hoặc mật khẩu'); }
  await run(env.DB, 'UPDATE orders SET user_id=? WHERE vid=? AND user_id IS NULL', u.id, locals.vid);
  await run(env.DB, "UPDATE users SET last_login_at=datetime('now') WHERE id=?", u.id);
  await track(env.DB, { vid: locals.vid, user_id: u.id, type: 'login', data: { method: 'password' }, ip: request.headers.get('cf-connecting-ip'), ua: request.headers.get('user-agent') });
  return json({ ok: true, role: u.role }, 200, { 'set-cookie': await sessionCookie(env, u.id) });
});
