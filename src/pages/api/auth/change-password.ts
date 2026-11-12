import type { APIRoute } from 'astro';
import { handle, json, body, fail } from '../../../lib/util';
import { first, run, audit } from '../../../lib/db';
import { verifyPassword, hashPassword } from '../../../lib/auth';

export const POST: APIRoute = ({ request, locals }) => handle(async () => {
  const env = locals.runtime.env; const u = locals.user; if (!u) fail(401, 'Bạn cần đăng nhập');
  const b = await body(request); const cur = String(b.current || ''); const pw = String(b.password || '');
  const row: any = await first(env.DB, 'SELECT password_hash FROM users WHERE id=?', u.id);
  if (row.password_hash && !(await verifyPassword(cur, row.password_hash))) fail(400, 'Mật khẩu hiện tại chưa đúng');
  if (pw.length < 10) fail(400, 'Mật khẩu mới cần ít nhất 10 ký tự');
  if (pw === cur || /^(\d)\1*$|^123123123/.test(pw)) fail(400, 'Chọn mật khẩu mới khác mật khẩu cũ và khó đoán hơn');
  if (pw !== String(b.confirm || '')) fail(400, 'Hai lần nhập mật khẩu mới chưa khớp');
  await run(env.DB, 'UPDATE users SET password_hash=?, must_change_pw=0 WHERE id=?', await hashPassword(pw), u.id);
  await audit(env.DB, u.email, 'auth.change_password', u.email, {});
  return json({ ok: true });
});
