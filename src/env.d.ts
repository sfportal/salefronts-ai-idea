/// <reference types="astro/client" />
type Runtime = import('@astrojs/cloudflare').Runtime<Env>;
interface Env {
  DB: D1Database; FILES?: R2Bucket; ASSETS: Fetcher;
  OWNER_EMAIL: string; SEPAY_BASE: string; SITE_NAME: string;
  SESSION_SECRET?: string; ANTHROPIC_API_KEY?: string; DEEPSEEK_API_KEY?: string; SEPAY_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; HANDOFF_WEBHOOK_URL?: string; HANDOFF_WEBHOOK_TOKEN?: string;
  DEMO_MODE?: string; ADMIN_BOOTSTRAP_KEY?: string;
}
declare namespace App {
  interface Locals extends Runtime {
    user: any | null; vid: string; settings: Record<string, string>;
  }
}
