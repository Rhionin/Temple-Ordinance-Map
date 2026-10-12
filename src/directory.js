// Group rows in D1. Lights stay in d1Store, one group at a time.
import { d1Store } from './d1.js';
import { normalizeSlug, cleanText, creationBlock, CREATE_WINDOW_MS } from '../lib/groups.js';

function taken() {
  const error = new Error('that address is already taken');
  error.status = 409;
  return error;
}

export function directory(db) {
  return {
    store(id) {
      return d1Store(db, id);
    },
    async find(slug) {
      const key = normalizeSlug(slug);
      if (!key) return null;
      return db.prepare(
        `SELECT id, slug, title, subtitle, months, uploads_open, uploads_close,
                admin_token_hash, disabled, deleted, created
         FROM groups WHERE slug = ?`
      ).bind(key).first();
    },
    async create({ slug, title, subtitle, tokenHash, now }) {
      const key = normalizeSlug(slug);
      if (!key) {
        const error = new Error('choose a short name using letters, numbers, and dashes');
        error.status = 400;
        throw error;
      }
      const at = Number(now) || Date.now();
      const existing = await db.prepare('SELECT COUNT(*) AS n FROM groups WHERE deleted = 0').first();
      const recent = await db.prepare('SELECT COUNT(*) AS n FROM groups WHERE created > ?').bind(at - CREATE_WINDOW_MS).first();
      const block = creationBlock({
        existing: Number(existing && existing.n) || 0,
        createdInWindow: Number(recent && recent.n) || 0,
      });
      if (block) {
        const error = new Error(block);
        error.status = 429;
        throw error;
      }
      try {
        await db.prepare(
          `INSERT INTO groups (slug, title, subtitle, months, admin_token_hash, disabled, deleted, created)
           VALUES (?, ?, ?, 12, ?, 0, 0, ?)`
        ).bind(key, cleanText(title, 80), cleanText(subtitle, 160), tokenHash || '', at).run();
      } catch (error) {
        if (/unique/i.test(String(error && error.message))) throw taken();
        throw error;
      }
      return this.find(key);
    },
    async update(slug, fields) {
      const current = await this.find(slug);
      if (!current || Number(current.deleted) || Number(current.disabled)) return null;
      await db.prepare(
        `UPDATE groups
         SET title = ?, subtitle = ?, months = ?, uploads_open = ?, uploads_close = ?
         WHERE id = ?`
      ).bind(fields.title, fields.subtitle, fields.months, fields.uploadsOpen, fields.uploadsClose, current.id).run();
      return this.find(slug);
    },
    async remove(slug) {
      const current = await this.find(slug);
      if (!current || Number(current.deleted)) return false;
      await db.prepare('UPDATE groups SET deleted = 1 WHERE id = ?').bind(current.id).run();
      return true;
    },
    async replaceToken(slug, tokenHash) {
      const current = await this.find(slug);
      if (!current || Number(current.deleted) || Number(current.disabled)) return false;
      await db.prepare('UPDATE groups SET admin_token_hash = ? WHERE id = ?').bind(tokenHash, current.id).run();
      return true;
    },
  };
}
