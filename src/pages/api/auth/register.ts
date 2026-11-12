import type { APIRoute } from 'astro';
import { handle, json, body, fail, isEmail, cleanPhone } from '../../../lib/util';
import { first, run, track } from '../../../lib/db';
import { upsertUser, sessionCookie, readCookie } from '../../../lib/auth';

export const POST: APIRoute = ({ request, locals }) => handle(async () => {
  const env = locals.runtime.env; const b = await body(request);
  const email = String(b.email || '').trim().toLowerCase();
  if (!isEmail(email)) fail(400, 'Email chưa đúng');
  if (String(b.password || '').length < 8) fail(400, 'Mật khẩu tối thiểu 8 ký tự');
  if (!b.consent) fail(400, 'Bạn cần đồng ý điều khoản');
  if (email === (env.OWNER_EMAIL || '').toLowerCase()) fail(400, 'Email này chỉ đăng nhập bằng Google');
  if (await first(env.DB, 'SELECT 1 FROM users WHERE email=?', email)) fail(409, 'Email đã có tài khoản, bạn đăng nhập nhé');
  const u: any = await upsertUser(env, { email, name: String(b.name || '').trim(), phone: cleanPhone(b.phone || ''), password: b.password, ref: readCookie(request, 'ref') });
  await run(env.DB, 'UPDATE orders SET user_id=? WHERE vid=? AND user_id IS NULL', u.id, locals.vid);
  await run(env.DB, "UPDATE users SET last_login_at=datetime('now') WHERE id=?", u.id);
  await track(env.DB, { vid: locals.vid, user_id: u.id, type: 'sign_up', data: { method: 'password' }, ip: request.headers.get('cf-connecting-ip'), ua: request.headers.get('user-agent') });
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, u.id) });
});
