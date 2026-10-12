// In-memory groups for the local Node server. Same rules as the D1 directory.
const { normalizeSlug, cleanText, creationBlock, CREATE_WINDOW_MS } = require('./groups');

function localDirectory(state, save) {
  return {
    async find(slug) {
      const key = normalizeSlug(slug);
      if (!key) return null;
      return state.find(group => group.slug === key) || null;
    },
    async create({ slug, title, subtitle, tokenHash, now }) {
      const key = normalizeSlug(slug);
      if (!key) {
        const error = new Error('choose a short name using letters, numbers, and dashes');
        error.status = 400;
        throw error;
      }
      const at = Number(now) || Date.now();
      const block = creationBlock({
        existing: state.filter(group => !Number(group.deleted)).length,
        createdInWindow: state.filter(group => Number(group.created) > at - CREATE_WINDOW_MS).length,
      });
      if (block) {
        const error = new Error(block);
        error.status = 429;
        throw error;
      }
      if (state.some(group => group.slug === key)) {
        const error = new Error('that address is already taken');
        error.status = 409;
        throw error;
      }
      const row = {
        id: state.reduce((max, group) => Math.max(max, Number(group.id) || 0), 0) + 1,
        slug: key,
        title: cleanText(title, 80),
        subtitle: cleanText(subtitle, 160),
        months: 12,
        uploads_open: null,
        uploads_close: null,
        admin_token_hash: tokenHash || '',
        disabled: 0,
        deleted: 0,
        created: at,
      };
      state.push(row);
      if (save) save();
      return row;
    },
  };
}

module.exports = { localDirectory };
