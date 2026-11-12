import type { APIRoute } from 'astro';
import { cookie } from '../../../lib/auth';
export const POST: APIRoute = () => new Response(null, { status: 303, headers: { location: '/', 'set-cookie': cookie('sid', '', 0) } });
export const GET = POST;
