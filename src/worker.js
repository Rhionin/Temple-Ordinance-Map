import { handleApi } from '../lib/http.js';
import { withSecurityHeaders } from '../lib/headers.js';
import { d1Store, ensureParty } from './d1.js';
import { Geocoder } from './geocoder.js';

const PAGES = { '/': '/upload.html', '/tv': '/tv.html', '/tv/': '/tv.html' };

function fresh(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-cache');
  return new Response(response.body, { status: response.status, headers });
}

export { Geocoder };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const groupId = await ensureParty(env.DB);
      return withSecurityHeaders(await handleApi(request, {
        store: d1Store(env.DB, groupId),
        resetToken: env.RESET_TOKEN || '',
        resetPin: env.RESET_PIN || '1337',
        buildId: env.BUILD_ID || '',
        kick: () => env.GEOCODER.getByName('nominatim').kick(),
        ctx,
      }));
    }
    const page = PAGES[url.pathname];
    if (page) return withSecurityHeaders(fresh(await env.ASSETS.fetch(new URL(page, request.url))));
    if (url.pathname === '/version.js') return withSecurityHeaders(fresh(await env.ASSETS.fetch(request)));
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
