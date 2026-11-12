import type { APIRoute } from 'astro';
import { first } from '../../../lib/db';
import { isStaff } from '../../../lib/access';

export const GET: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime.env; const u = locals.user;
  const f: any = await first(env.DB, 'SELECT f.*, o.user_id, o.vid, o.total, o.paid_amount, o.status FROM files f LEFT JOIN orders o ON o.id=f.order_id WHERE f.id=?', Number(params.id));
  if (!f) return new Response('Không tìm thấy', { status: 404 });
  const owner = (u && f.user_id === u.id) || (!f.user_id && f.vid === locals.vid);
  if (!isStaff(u) && !owner) return new Response('Không có quyền', { status: 403 });
  if (!isStaff(u) && f.kind === 'delivery' && f.paid_amount < f.total) return new Response('Bạn cần thanh toán đủ để tải kết quả', { status: 402 });
  const obj = await env.FILES.get(f.key);
  if (!obj) return new Response('Tệp không còn', { status: 404 });
  return new Response(obj.body, { headers: { 'content-type': f.type || 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` } });
};
