import type { APIRoute } from 'astro';
import { handle, json, body, fail } from '../../../lib/util';
import { first, run, audit } from '../../../lib/db';
import { sessionCookie, sha256 } from '../../../lib/auth';
// Temporary owner access before Google OAuth is configured. Requires the ADMIN_BOOTSTRAP_KEY secret.
export const POST: APIRoute = ({ request, locals }) => handle(async () => {
  const env = locals.runtime.env; const b = await body(request);
  if (!env.ADMIN_BOOTSTRAP_KEY || env.ADMIN_BOOTSTRAP_KEY.length < 12) fail(404, 'Không bật');
  if ((await sha256(String(b.key || ''))) !== (await sha256(env.ADMIN_BOOTSTRAP_KEY))) { await new Promise((r) => setTimeout(r, 800)); fail(401, 'Mã không đúng'); }
  const email = (env.OWNER_EMAIL || '').toLowerCase();
  let u: any = await first(env.DB, 'SELECT * FROM users WHERE email=?', email);
  if (!u) { await run(env.DB, "INSERT INTO users (email,name,role,ref_code) VALUES (?,?, 'owner', ?)", email, 'Owner', 'OWNER' + Math.floor(Math.random() * 900 + 100)); u = await first(env.DB, 'SELECT * FROM users WHERE email=?', email); }
  else await run(env.DB, "UPDATE users SET role='owner' WHERE id=?", u.id);
  await audit(env.DB, email, 'auth.bootstrap', '', { ip: request.headers.get('cf-connecting-ip') });
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, u.id) });
});
