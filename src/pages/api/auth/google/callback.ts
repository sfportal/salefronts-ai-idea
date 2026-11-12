import type { APIRoute } from 'astro';
import { googleExchange, verify, readCookie, upsertUser, sessionCookie, cookie } from '../../../../lib/auth';
import { run, track } from '../../../../lib/db';
export const GET: APIRoute = async ({ url, request, locals }) => {
  const env = locals.runtime.env;
  try {
    const st = await verify(env, readCookie(request, 'gstate'));
    if (!st || st.n !== url.searchParams.get('state')) throw new Error('Phiên đăng nhập hết hạn, thử lại nhé');
    const info = await googleExchange(env, url.origin, url.searchParams.get('code') || '');
    const u: any = await upsertUser(env, { email: info.email, name: info.name, google_sub: info.sub, avatar: info.picture, ref: readCookie(request, 'ref') });
    await run(env.DB, 'UPDATE orders SET user_id=? WHERE vid=? AND user_id IS NULL', u.id, locals.vid);
    await run(env.DB, "UPDATE users SET last_login_at=datetime('now') WHERE id=?", u.id);
    await track(env.DB, { vid: locals.vid, user_id: u.id, type: 'login', data: { method: 'google' }, ip: request.headers.get('cf-connecting-ip'), ua: request.headers.get('user-agent') });
    const h = new Headers({ location: st.next || '/tai-khoan' });
    h.append('set-cookie', await sessionCookie(env, u.id)); h.append('set-cookie', cookie('gstate', '', 0));
    return new Response(null, { status: 302, headers: h });
  } catch (e: any) {
    return new Response(null, { status: 302, headers: { location: '/dang-nhap?error=' + encodeURIComponent(e.message) } });
  }
};
