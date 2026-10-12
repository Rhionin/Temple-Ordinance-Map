import { handleApi } from '../lib/http.js';
import { d1Store } from './d1.js';
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
      return handleApi(request, {
        store: d1Store(env.DB),
        resetToken: env.RESET_TOKEN || '',
        resetPin: env.RESET_PIN || '1337',
        buildId: env.BUILD_ID || '',
        kick: () => env.GEOCODER.getByName('nominatim').kick(),
        ctx,
      });
    }
    const page = PAGES[url.pathname];
    if (page) return fresh(await env.ASSETS.fetch(new URL(page, request.url)));
    if (url.pathname === '/version.js') return fresh(await env.ASSETS.fetch(request));
    return env.ASSETS.fetch(request);
  },
};
