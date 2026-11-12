import type { APIRoute } from 'astro';
import { googleAuthUrl, sign, cookie } from '../../../../lib/auth';
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const env = locals.runtime.env;
  if (!env.GOOGLE_CLIENT_ID) return new Response('Đăng nhập Google chưa được cấu hình (thiếu GOOGLE_CLIENT_ID).', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const next = url.searchParams.get('next') || '/tai-khoan';
  const nonce = crypto.randomUUID();
  const state = await sign(env, { n: nonce, next: next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/', exp: Date.now() + 600000 });
  return new Response(null, { status: 302, headers: { location: googleAuthUrl(env, url.origin, nonce), 'set-cookie': cookie('gstate', state, 600) } });
};
