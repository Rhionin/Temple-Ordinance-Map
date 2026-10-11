import { handleApi } from '../lib/http.js';
import { d1Store } from './d1.js';
import { Geocoder } from './geocoder.js';

const PAGES = { '/': '/upload.html', '/tv': '/tv.html', '/tv/': '/tv.html' };

export { Geocoder };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, {
        store: d1Store(env.DB),
        resetToken: env.RESET_TOKEN || '',
        kick: () => env.GEOCODER.getByName('nominatim').kick(),
        ctx,
      });
    }
    const page = PAGES[url.pathname];
    if (page) return env.ASSETS.fetch(new URL(page, request.url));
    return env.ASSETS.fetch(request);
  },
};
