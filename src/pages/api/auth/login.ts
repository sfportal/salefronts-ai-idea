import type { APIRoute } from 'astro';
import { handle, json, body, fail } from '../../../lib/util';
import { first, run, track } from '../../../lib/db';
import { verifyPassword, sessionCookie } from '../../../lib/auth';

export const POST: APIRoute = ({ request, locals }) => handle(async () => {
  const env = locals.runtime.env; const b = await body(request);
  const em = String(b.email || '').trim().toLowerCase();
  // brute-force guard: max 8 failed attempts per email per 15 minutes
  const f: any = await first(env.DB, "SELECT COUNT(*) n FROM audit WHERE action='auth.fail' AND target=? AND created_at > datetime('now','-15 minutes')", em);
  if (f.n >= 8) fail(429, 'Sai quá nhiều lần, thử lại sau 15 phút');
  const u: any = await first(env.DB, 'SELECT * FROM users WHERE email=? AND active=1', em);
  if (!u || !(await verifyPassword(String(b.password || ''), u.password_hash))) {
    await run(env.DB, 'INSERT INTO audit (actor,action,target) VALUES (?,?,?)', 'anon', 'auth.fail', em);
    await new Promise((r) => setTimeout(r, 400)); fail(401, 'Sai email hoặc mật khẩu');
  }
  await run(env.DB, 'UPDATE orders SET user_id=? WHERE vid=? AND user_id IS NULL', u.id, locals.vid);
  await run(env.DB, "UPDATE users SET last_login_at=datetime('now') WHERE id=?", u.id);
  await track(env.DB, { vid: locals.vid, user_id: u.id, type: 'login', data: { method: 'password' }, ip: request.headers.get('cf-connecting-ip'), ua: request.headers.get('user-agent') });
  return json({ ok: true, role: u.role, must_change_pw: !!u.must_change_pw }, 200, { 'set-cookie': await sessionCookie(env, u.id) });
});
