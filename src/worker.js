import { handleApi } from '../lib/http.js';
import { withSecurityHeaders } from '../lib/headers.js';
import { publicGroup } from '../lib/groups.js';
import { ensureParty } from './d1.js';
import { directory } from './directory.js';
import { masterStore } from './master.js';
import { Geocoder } from './geocoder.js';

const PAGES = { '/': '/tv.html' };

function fresh(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-cache');
  return new Response(response.body, { status: response.status, headers });
}

export { Geocoder };

function notFound() {
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function assetPage(request, env, file) {
  return withSecurityHeaders(fresh(await env.ASSETS.fetch(new URL(file, request.url))));
}

function groupSlug(raw) {
  try { return decodeURIComponent(raw); } catch (error) { return ''; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const groups = directory(env.DB);
    if (url.pathname.startsWith('/api/') || /^\/g\/[^/]+\/api\//.test(url.pathname)) {
      await ensureParty(env.DB);
      return withSecurityHeaders(await handleApi(request, {
        store: masterStore(env.DB),
        groups,
        resetToken: env.RESET_TOKEN || '',
        resetPin: env.RESET_PIN || '1337',
        buildId: env.BUILD_ID || '',
        kick: () => env.GEOCODER.getByName('nominatim').kick(),
        ctx,
      }));
    }
    if (url.pathname === '/new') return assetPage(request, env, '/new.html');
    const groupPath = url.pathname.match(/^\/g\/([^/]+)(\/map)?\/?$/);
    if (groupPath) {
      const group = await groups.find(groupSlug(groupPath[1]));
      if (!publicGroup(group)) return withSecurityHeaders(notFound());
      return assetPage(request, env, groupPath[2] ? '/tv.html' : '/upload.html');
    }
    const page = PAGES[url.pathname];
    if (page) return assetPage(request, env, page);
    if (url.pathname === '/version.js') return withSecurityHeaders(fresh(await env.ASSETS.fetch(request)));
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
