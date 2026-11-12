import { putFile } from '../../../lib/storage';
import type { APIRoute } from 'astro';
import { handle, json, body, fail, parseJSON } from '../../../lib/util';
import { all, first, run, audit, setSetting } from '../../../lib/db';
import { need } from '../../../lib/auth';
import { setStatus, addEvent, sendHandoff } from '../../../lib/orders';
import { onPaymentPaid } from '../../../lib/orders';
import { walletApply } from '../../../lib/wallet';

const SETTINGS_KEYS = ['ai_provider', 'ai_model', 'support_provider', 'support_model', 'deepseek_model', 'max_revisions', 'deposit_threshold', 'deposit_pct', 'consult_price', 'aff_commission_pct', 'aff_discount_pct', 'ga4_id', 'hero_title', 'support_kb', 'wallet_min_topup', 'pay_days', 'contact_hours'];

export const ALL: APIRoute = ({ params, request, locals, url }) => handle(async () => {
  const env = locals.runtime.env; const u = locals.user; need(u, 'staff');
  const p = '/' + (params.path || ''); const m = request.method; const actor = u.email;
  const b = m === 'GET' ? {} : await body(request);
  let mm: RegExpMatchArray | null;

  // ---------------- orders
  if ((mm = p.match(/^\/orders\/(\d+)\/(approve|reject|status|quote|note|deliver|handoff|deliverable|deliverable-remove|guide)$/)) && m === 'POST') {
    const o: any = await first(env.DB, 'SELECT * FROM orders WHERE id=?', Number(mm[1])); if (!o) fail(404, 'Không có đơn');
    const a = mm[2];
    if (a === 'approve') {
      if (o.status !== 'paid') fail(400, 'Chỉ duyệt đơn đã thanh toán');
      await setStatus(env, o, 'in_progress', 'Salefronts đã duyệt, bắt đầu thực hiện' + (b.note ? ': ' + b.note : ''), actor, ", approved_at=datetime('now')");
      const tpl: any = await first(env.DB, 'SELECT guide_md FROM templates WHERE id=?', o.template_id);
      if (!o.guide_md && tpl?.guide_md) await run(env.DB, 'UPDATE orders SET guide_md=? WHERE id=?', tpl.guide_md, o.id);
      const h = await sendHandoff(env, { ...o, status: 'in_progress' }, url.origin);
      await audit(env.DB, actor, 'order.approve', o.code, { handoff: h.status });
      return json({ ok: true, handoff: h });
    }
    if (a === 'handoff') { const h = await sendHandoff(env, o, url.origin); return json({ ok: true, handoff: h }); }
    if (a === 'reject') {
      if (!String(b.reason || '').trim()) fail(400, 'Cần lý do');
      await run(env.DB, 'UPDATE orders SET reject_reason=? WHERE id=?', b.reason, o.id);
      await setStatus(env, o, 'rejected', 'Trả lại: ' + b.reason, actor);
      await audit(env.DB, actor, 'order.reject', o.code, { reason: b.reason });
      return json({ ok: true });
    }
    if (a === 'quote') {
      const price = Math.round(Number(b.custom_price)); if (!(price >= 0)) fail(400, 'Giá không hợp lệ');
      await run(env.DB, "UPDATE orders SET custom_price=?, total=price+?, updated_at=datetime('now') WHERE id=?", price, price, o.id);
      if (o.status === 'quote_pending') await setStatus(env, o, 'mockup', `Salefronts báo giá phần ngoài mẫu: ${price.toLocaleString('vi-VN')}đ`, actor);
      else await addEvent(env, o.id, null, `Báo giá phần ngoài mẫu: ${price.toLocaleString('vi-VN')}đ`, actor);
      await audit(env.DB, actor, 'order.quote', o.code, { price });
      return json({ ok: true });
    }
    if (a === 'note') { await run(env.DB, 'UPDATE orders SET admin_note=? WHERE id=?', b.note || '', o.id); return json({ ok: true }); }
    if (a === 'guide') { await run(env.DB, 'UPDATE orders SET guide_md=? WHERE id=?', b.guide_md || '', o.id); return json({ ok: true }); }
    if (a === 'deliverable') {
      const list = parseJSON<any[]>(o.deliverables, []);
      if (!b.title || (!b.url && !b.file_id)) fail(400, 'Cần tiêu đề và link hoặc tệp');
      if (b.url && !/^https?:\/\//.test(b.url)) fail(400, 'Link phải bắt đầu bằng http(s)://');
      list.push({ type: b.type || 'link', title: String(b.title).slice(0, 120), url: b.url || null, file_id: b.file_id ? Number(b.file_id) : null });
      await run(env.DB, 'UPDATE orders SET deliverables=? WHERE id=?', JSON.stringify(list), o.id);
      return json({ ok: true, deliverables: list });
    }
    if (a === 'deliverable-remove') {
      const list = parseJSON<any[]>(o.deliverables, []); list.splice(Number(b.index), 1);
      await run(env.DB, 'UPDATE orders SET deliverables=? WHERE id=?', JSON.stringify(list), o.id); return json({ ok: true });
    }
    if (a === 'deliver') {
      if (o.status !== 'in_progress') fail(400, 'Đơn chưa ở bước thực hiện');
      if (!parseJSON<any[]>(o.deliverables, []).length) fail(400, 'Thêm ít nhất một kết quả trước khi giao');
      if (!String(o.guide_md || '').trim()) fail(400, 'Cần có hướng dẫn sử dụng trước khi giao');
      await setStatus(env, o, 'delivered', o.paid_amount < o.total ? 'Đã giao kết quả. Thanh toán phần còn lại để tải về.' : 'Đã giao kết quả kèm hướng dẫn sử dụng', actor, ", delivered_at=datetime('now')");
      // affiliate commission
      const cu: any = o.user_id ? await first(env.DB, 'SELECT referred_by FROM users WHERE id=?', o.user_id) : null;
      if (cu?.referred_by && cu.referred_by !== o.user_id && !(await first(env.DB, 'SELECT 1 FROM commissions WHERE order_id=?', o.id))) {
        const pct = Number((await first<any>(env.DB, "SELECT value FROM settings WHERE key='aff_commission_pct'"))?.value || 0);
        if (pct > 0) await run(env.DB, 'INSERT INTO commissions (referrer_id,order_id,amount) VALUES (?,?,?)', cu.referred_by, o.id, Math.round(o.total * pct / 100));
      }
      await audit(env.DB, actor, 'order.deliver', o.code);
      return json({ ok: true });
    }
    if (a === 'status') {
      need(u, 'admin');
      if (!['chatting', 'mockup', 'awaiting_payment', 'paid', 'in_progress', 'delivered', 'cancelled', 'rejected'].includes(b.status)) fail(400, 'Trạng thái không hợp lệ');
      await setStatus(env, o, b.status, 'Quản trị đổi trạng thái' + (b.note ? ': ' + b.note : ''), actor);
      await audit(env.DB, actor, 'order.status', o.code, { status: b.status });
      return json({ ok: true });
    }
  }
  if ((mm = p.match(/^\/orders\/(\d+)\/upload$/)) && m === 'POST') {
    const o: any = await first(env.DB, 'SELECT * FROM orders WHERE id=?', Number(mm[1])); if (!o) fail(404, 'Không có đơn');
    const f = b.file as File | null; if (!f || typeof f === 'string') fail(400, 'Chưa chọn tệp');
    if (f.size > 95 * 1024 * 1024) fail(400, 'Tệp tối đa 95MB, tệp lớn hơn hãy dán link');
    const key = `deliveries/${o.code}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, '_').slice(-80)}`;
    await putFile(env, key, f);
    await run(env.DB, 'INSERT INTO files (order_id,key,name,size,type,kind) VALUES (?,?,?,?,?,?)', o.id, key, f.name, f.size, f.type, 'delivery');
    const row: any = await first(env.DB, 'SELECT id FROM files WHERE key=?', key);
    return json({ ok: true, file_id: row.id, name: f.name });
  }

  // ---------------- templates
  if (p === '/templates' && m === 'POST') {
    need(u, 'admin');
    const t = b; const opts = typeof t.options === 'string' ? parseJSON(t.options, null) : t.options;
    if (!Array.isArray(opts)) fail(400, 'Danh sách điểm chỉnh không hợp lệ');
    if (!t.name || !t.slug || !['web', 'extension', 'media'].includes(t.kind)) fail(400, 'Thiếu tên, slug hoặc loại');
    if (!/^[a-z0-9-]+$/.test(t.slug)) fail(400, 'Slug chỉ gồm chữ thường, số, gạch ngang');
    const vals = [t.kind, t.slug, t.name, t.industries || '', t.summary || '', t.preview_url || null, t.demo_url || null, t.repo_url || null, Number(t.base_price) || 0, Number(t.days) || 3, JSON.stringify(opts), t.claude_notes || '', t.guide_md || '', t.accent || '#7c5cff', t.active ? 1 : 0, Number(t.sort) || 0];
    if (t.id) await run(env.DB, "UPDATE templates SET kind=?,slug=?,name=?,industries=?,summary=?,preview_url=?,demo_url=?,repo_url=?,base_price=?,days=?,options=?,claude_notes=?,guide_md=?,accent=?,active=?,sort=?,updated_at=datetime('now') WHERE id=?", ...vals, Number(t.id));
    else await run(env.DB, 'INSERT INTO templates (kind,slug,name,industries,summary,preview_url,demo_url,repo_url,base_price,days,options,claude_notes,guide_md,accent,active,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ...vals);
    await audit(env.DB, actor, t.id ? 'template.update' : 'template.create', t.slug);
    return json({ ok: true });
  }
  if ((mm = p.match(/^\/templates\/(\d+)\/(duplicate|toggle)$/)) && m === 'POST') {
    need(u, 'admin'); const t: any = await first(env.DB, 'SELECT * FROM templates WHERE id=?', Number(mm[1])); if (!t) fail(404, 'Không có mẫu');
    if (mm[2] === 'toggle') await run(env.DB, 'UPDATE templates SET active=1-active WHERE id=?', t.id);
    else {
      const slug = t.slug + '-' + Math.random().toString(36).slice(2, 6);
      await run(env.DB, 'INSERT INTO templates (kind,slug,name,industries,summary,preview_url,demo_url,repo_url,base_price,days,options,claude_notes,guide_md,accent,active,sort) SELECT kind,?,name||\' (bản sao)\',industries,summary,preview_url,demo_url,repo_url,base_price,days,options,claude_notes,guide_md,accent,0,sort FROM templates WHERE id=?', slug, t.id);
    }
    await audit(env.DB, actor, 'template.' + mm[2], t.slug); return json({ ok: true });
  }
  if ((mm = p.match(/^\/template-requests\/(\d+)$/)) && m === 'POST') {
    await run(env.DB, 'UPDATE template_requests SET status=?, votes=COALESCE(?,votes), title=COALESCE(?,title) WHERE id=?', b.status || 'open', b.votes ?? null, b.title ?? null, Number(mm[1])); return json({ ok: true });
  }
  if (p === '/template-requests' && m === 'POST') {
    await run(env.DB, 'INSERT INTO template_requests (kind,title,detail) VALUES (?,?,?)', b.kind || 'web', b.title, b.detail || ''); return json({ ok: true });
  }

  // ---------------- CRM
  if ((mm = p.match(/^\/leads\/(\d+)$/)) && m === 'POST') {
    await run(env.DB, "UPDATE leads SET stage=COALESCE(?,stage), tags=COALESCE(?,tags), note=COALESCE(?,note), name=COALESCE(?,name), company=COALESCE(?,company), industry=COALESCE(?,industry), updated_at=datetime('now') WHERE id=?",
      b.stage ?? null, b.tags ?? null, b.note ?? null, b.name ?? null, b.company ?? null, b.industry ?? null, Number(mm[1]));
    return json({ ok: true });
  }
  if ((mm = p.match(/^\/leads\/(\d+)\/notes$/)) && m === 'POST') {
    if (!String(b.content || '').trim()) fail(400, 'Nội dung trống');
    await run(env.DB, 'INSERT INTO crm_notes (lead_id,author,content,due_at) VALUES (?,?,?,?)', Number(mm[1]), actor, b.content, b.due_at || null); return json({ ok: true });
  }
  if ((mm = p.match(/^\/notes\/(\d+)\/done$/)) && m === 'POST') { await run(env.DB, 'UPDATE crm_notes SET done=1-done WHERE id=?', Number(mm[1])); return json({ ok: true }); }

  // ---------------- CSKH
  if ((mm = p.match(/^\/support\/(\d+)$/)) && m === 'POST') {
    if (b.reply) await run(env.DB, 'INSERT INTO support_messages (session_id,role,content) VALUES (?,?,?)', Number(mm[1]), 'assistant', '[Nhân viên] ' + b.reply);
    if (b.status) await run(env.DB, "UPDATE support_sessions SET status=?, updated_at=datetime('now') WHERE id=?", b.status, Number(mm[1]));
    return json({ ok: true });
  }
  if ((mm = p.match(/^\/bookings\/(\d+)$/)) && m === 'POST') {
    await run(env.DB, 'UPDATE bookings SET status=COALESCE(?,status), scheduled_at=COALESCE(?,scheduled_at), meet_url=COALESCE(?,meet_url), admin_note=COALESCE(?,admin_note) WHERE id=?', b.status || null, b.scheduled_at || null, b.meet_url || null, b.admin_note ?? null, Number(mm[1]));
    await audit(env.DB, actor, 'booking.update', mm[1], b); return json({ ok: true });
  }

  // ---------------- promos
  if (p === '/promos' && m === 'POST') {
    need(u, 'admin'); const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) fail(400, 'Mã 3-30 ký tự chữ, số');
    const v = [code, b.type === 'amount' ? 'amount' : 'pct', Number(b.value) || 0, b.max_uses ? Number(b.max_uses) : null, Number(b.min_total) || 0, b.kinds || '', b.starts_at || null, b.ends_at || null, b.active ? 1 : 0, b.note || ''];
    if (b.id) await run(env.DB, 'UPDATE promos SET code=?,type=?,value=?,max_uses=?,min_total=?,kinds=?,starts_at=?,ends_at=?,active=?,note=? WHERE id=?', ...v, Number(b.id));
    else await run(env.DB, 'INSERT INTO promos (code,type,value,max_uses,min_total,kinds,starts_at,ends_at,active,note) VALUES (?,?,?,?,?,?,?,?,?,?)', ...v);
    await audit(env.DB, actor, 'promo.save', code); return json({ ok: true });
  }

  // ---------------- affiliate
  if ((mm = p.match(/^\/commissions\/(\d+)$/)) && m === 'POST') {
    need(u, 'admin'); if (!['pending', 'approved', 'paid', 'void'].includes(b.status)) fail(400, 'Trạng thái sai');
    await run(env.DB, `UPDATE commissions SET status=? ${b.status === 'paid' ? ", paid_at=datetime('now')" : ''} WHERE id=?`, b.status, Number(mm[1]));
    await audit(env.DB, actor, 'commission.' + b.status, mm[1]); return json({ ok: true });
  }

  // ---------------- payments
  if ((mm = p.match(/^\/payments\/(\d+)\/(confirm|refund|cancel)$/)) && m === 'POST') {
    need(u, 'admin'); const pay: any = await first(env.DB, 'SELECT * FROM payments WHERE id=?', Number(mm[1])); if (!pay) fail(404, 'Không có');
    if (mm[2] === 'confirm') { if (pay.status !== 'pending') fail(400, 'Không ở trạng thái chờ'); await run(env.DB, "UPDATE payments SET status='paid', paid_at=datetime('now') WHERE id=?", pay.id); await onPaymentPaid(env, { ...pay, status: 'paid' }); }
    if (mm[2] === 'refund') await run(env.DB, "UPDATE payments SET status='refunded' WHERE id=? AND status='paid'", pay.id);
    if (mm[2] === 'cancel') await run(env.DB, "UPDATE payments SET status='cancelled' WHERE id=? AND status='pending'", pay.id);
    await audit(env.DB, actor, 'payment.' + mm[2], pay.code); return json({ ok: true });
  }

  // ---------------- studio templates & wallets
  if (p === '/studio' && m === 'POST') {
    need(u, 'admin');
    const v = [String(b.name || '').trim(), b.kind === 'video' ? 'video' : 'image', ['promo', 'story', 'cover', 'reel'].includes(b.layout) ? b.layout : 'promo',
      Math.min(4000, Math.max(200, Number(b.width) || 1080)), Math.min(4000, Math.max(200, Number(b.height) || 1080)), Math.max(0, Number(b.price) || 0),
      String(b.accent || '#7c5cff'), String(b.description || ''), b.active ? 1 : 0, Number(b.sort) || 0];
    if (!v[0]) fail(400, 'Thiếu tên mẫu');
    if (b.id) await run(env.DB, 'UPDATE studio_templates SET name=?,kind=?,layout=?,width=?,height=?,price=?,accent=?,description=?,active=?,sort=? WHERE id=?', ...v, Number(b.id));
    else await run(env.DB, 'INSERT INTO studio_templates (name,kind,layout,width,height,price,accent,description,active,sort) VALUES (?,?,?,?,?,?,?,?,?,?)', ...v);
    await audit(env.DB, actor, 'studio.save', String(b.id || 'new'), { name: v[0] }); return json({ ok: true });
  }
  if ((mm = p.match(/^\/studio\/(\d+)\/(overlay|sample|remove-overlay)$/)) && m === 'POST') {
    need(u, 'admin'); const id = Number(mm[1]);
    if (mm[2] === 'remove-overlay') { await run(env.DB, 'UPDATE studio_templates SET overlay_key=NULL WHERE id=?', id); return json({ ok: true }); }
    const f = b.file as File | null; if (!f || typeof f === 'string') fail(400, 'Chưa chọn tệp');
    if (!/^image\//.test(f.type)) fail(400, 'Chỉ nhận ảnh (PNG nền trong suốt cho khung)');
    const key = `studio/${id}/${mm[2]}-${Date.now()}.${(f.name.split('.').pop() || 'png').slice(0, 5)}`;
    await putFile(env, key, f);
    await run(env.DB, `UPDATE studio_templates SET ${mm[2] === 'overlay' ? 'overlay_key' : 'sample_key'}=? WHERE id=?`, key, id);
    return json({ ok: true });
  }
  if (p === '/wallet/adjust' && m === 'POST') {
    need(u, 'admin');
    const target: any = await first(env.DB, 'SELECT id FROM users WHERE email=?', String(b.email || '').trim().toLowerCase()); if (!target) fail(404, 'Không có tài khoản này');
    const amount = Math.round(Number(b.amount) || 0); if (!amount) fail(400, 'Nhập số tiền (âm để trừ)');
    const bal = await walletApply(env, target.id, amount, 'adjust', `adj:${Date.now()}:${target.id}`, String(b.note || 'Điều chỉnh bởi ' + actor));
    await audit(env.DB, actor, 'wallet.adjust', String(b.email), { amount }); return json({ ok: true, balance: bal });
  }

  // ---------------- settings & users
  if (p === '/settings' && m === 'POST') {
    need(u, 'admin');
    for (const k of SETTINGS_KEYS) if (k in b) await setSetting(env.DB, k, String(b[k] ?? ''));
    await audit(env.DB, actor, 'settings.update', '', Object.keys(b)); return json({ ok: true });
  }
  if (p === '/users' && m === 'POST') {
    need(u, 'owner'); const email = String(b.email || '').trim().toLowerCase();
    if (!['customer', 'staff', 'admin'].includes(b.role)) fail(400, 'Vai trò sai');
    if (email === (env.OWNER_EMAIL || '').toLowerCase()) fail(400, 'Không đổi vai trò owner');
    const ex: any = await first(env.DB, 'SELECT id FROM users WHERE email=?', email);
    if (ex) await run(env.DB, 'UPDATE users SET role=? WHERE id=?', b.role, ex.id);
    else await run(env.DB, 'INSERT INTO users (email,name,role,ref_code) VALUES (?,?,?,?)', email, b.name || null, b.role, 'S' + Math.random().toString(36).slice(2, 8).toUpperCase());
    await audit(env.DB, actor, 'user.role', email, { role: b.role }); return json({ ok: true });
  }

  // ---------------- read helpers
  if (p === '/export/leads' && m === 'GET') {
    const rows = await all<any>(env.DB, 'SELECT id,name,phone,email,company,industry,stage,tags,source,created_at FROM leads ORDER BY id DESC');
    const csv = [Object.keys(rows[0] || { id: '' }).join(','), ...rows.map((r) => Object.values(r).map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    return new Response('﻿' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="leads.csv"' } });
  }
  fail(404, 'Không có API này');
  return json({});
});
