import type { APIRoute } from 'astro';
import { first } from '../../../../lib/db';
import { getFile } from '../../../../lib/storage';
// Public studio template images (frame overlay, sample preview). Same-origin so canvases stay untainted.
export const GET: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime.env;
  const t: any = await first(env.DB, 'SELECT overlay_key, sample_key FROM studio_templates WHERE id=?', Number(params.id));
  const key = params.which === 'overlay' ? t?.overlay_key : params.which === 'sample' ? t?.sample_key : null;
  if (!key) return new Response('Không có', { status: 404 });
  const body = await getFile(env, key); if (!body) return new Response('Không có', { status: 404 });
  const ext = key.split('.').pop()?.toLowerCase();
  return new Response(body, { headers: { 'content-type': ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png', 'cache-control': 'public, max-age=300' } });
};
