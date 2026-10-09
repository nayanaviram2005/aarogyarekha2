import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

function securityPolicy(env: Record<string, string>): Plugin {
  const origin = (u: string) => { try { return new URL(u).origin; } catch { return ''; } };
  const api = origin(env.VITE_API_URL || 'http://127.0.0.1:8787'), sb = origin(env.SUPABASE_URL || '');
  const ws = sb ? sb.replace(/^http/, 'ws') : '';
  const connect = ["'self'", api, sb, ws].filter(Boolean).join(' ');
  const csp = ["default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", `connect-src ${connect}`, "media-src 'self' blob:", "worker-src 'self'", "manifest-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'"].join('; ');
  return { name: 'security-policy', apply: 'build', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }] };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  return {
    plugins: [react(), securityPolicy(env)],
    define: {
      __SUPABASE_URL__: JSON.stringify(env.SUPABASE_URL ?? ''),
      __SUPABASE_ANON_KEY__: JSON.stringify(env.SUPABASE_ANON_KEY ?? ''),
      __API_URL__: JSON.stringify(env.VITE_API_URL || 'http://127.0.0.1:8787'),
      __IDLE_MINUTES__: JSON.stringify(Number(env.SESSION_IDLE_LOCK_MINUTES || 10)),
    },
    server: { port: 5173, host: 'localhost', strictPort: true },
    test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], css: false, testTimeout: 20000 },
  };
});
