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
    async update(slug, fields) {
      const current = await this.find(slug);
      if (!current || Number(current.deleted) || Number(current.disabled)) return null;
      current.title = fields.title;
      current.subtitle = fields.subtitle;
      current.months = fields.months;
      current.uploads_open = fields.uploadsOpen;
      current.uploads_close = fields.uploadsClose;
      if (save) save();
      return current;
    },
    async remove(slug) {
      const current = await this.find(slug);
      if (!current || Number(current.deleted)) return false;
      current.deleted = 1;
      if (save) save();
      return true;
    },
    async list() {
      return state
        .map(group => ({
          slug: group.slug,
          title: group.title || '',
          disabled: group.disabled ? 1 : 0,
          deleted: group.deleted ? 1 : 0,
          created: group.created,
        }))
        .sort((a, b) => (b.created - a.created) || (a.slug < b.slug ? -1 : 1));
    },
    async setDisabled(slug, disabled) {
      const current = await this.find(slug);
      if (!current) return null;
      current.disabled = disabled ? 1 : 0;
      if (save) save();
      return current;
    },
    async replaceToken(slug, tokenHash) {
      const current = await this.find(slug);
      if (!current || Number(current.deleted) || Number(current.disabled)) return false;
      current.admin_token_hash = tokenHash;
      if (save) save();
      return true;
    },
  };
}

module.exports = { localDirectory };
