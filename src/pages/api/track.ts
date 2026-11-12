import type { APIRoute } from 'astro';
import { json, body } from '../../lib/util';
import { track } from '../../lib/db';
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await body(request); const type = String(b.type || '').slice(0, 40);
  if (!/^[a-z_]+$/.test(type)) return json({ ok: false }, 400);
  await track(locals.runtime.env.DB, { vid: locals.vid, user_id: locals.user?.id, type, data: b.data || null, ip: request.headers.get('cf-connecting-ip'), ua: request.headers.get('user-agent') });
  return json({ ok: true });
};
