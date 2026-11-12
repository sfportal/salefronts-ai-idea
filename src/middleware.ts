import { defineMiddleware } from 'astro:middleware';
import { currentUser, readCookie, cookie, ROLE_LEVEL } from './lib/auth';
import { getSettings } from './lib/db';

export const onRequest = defineMiddleware(async (ctx, next) => {
  const env = ctx.locals.runtime.env;
  const path = ctx.url.pathname;
  if (path.startsWith('/_astro') || path.startsWith('/favicon')) return next();
  let vid = readCookie(ctx.request, 'vid'); const newVid = !vid;
  if (!vid) vid = crypto.randomUUID();
  ctx.locals.vid = vid;
  ctx.locals.user = await currentUser(env, ctx.request);
  ctx.locals.settings = await getSettings(env.DB);
  const ref = ctx.url.searchParams.get('ref');

  const u = ctx.locals.user;
  if (path.startsWith('/admin') && path !== '/admin/login') {
    if (path === '/admin/doi-mat-khau' && u) { /* any signed-in user may change password */ } else if (!u || (ROLE_LEVEL[u.role] ?? 0) < ROLE_LEVEL.staff) return ctx.redirect('/admin/login');
  }
  // forced password change (e.g. default owner password)
  if (u?.must_change_pw && (path.startsWith('/admin') || path.startsWith('/tai-khoan') || path.startsWith('/api/admin')) && path !== '/admin/doi-mat-khau' && path !== '/admin/login') {
    if (path.startsWith('/api/')) return new Response(JSON.stringify({ ok: false, error: 'Bạn cần đổi mật khẩu trước' }), { status: 403, headers: { 'content-type': 'application/json' } });
    return ctx.redirect('/admin/doi-mat-khau');
  }
  if (path.startsWith('/tai-khoan') && !u) return ctx.redirect('/dang-nhap?next=' + encodeURIComponent(path));

  const res = await next();
  if (newVid) res.headers.append('set-cookie', cookie('vid', vid, 365 * 86400));
  if (ref && /^[A-Z0-9]{4,10}$/i.test(ref)) res.headers.append('set-cookie', cookie('ref', ref.toUpperCase(), 30 * 86400));
  res.headers.set('x-frame-options', 'SAMEORIGIN');
  res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return res;
});
