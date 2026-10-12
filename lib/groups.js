// Group rules shared by D1 and the local server.
// disabled removes a group from the master map.
// deleted hides its pages and frees a cap slot. Lights stay until disable.
const { plainLabel } = require('./plain');

const MAX_GROUPS = 50;
const MAX_CREATES_PER_HOUR = 10;
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_GROUP_PENDING = 400;
const RESERVED = new Set(['new', 'g', 'map', 'api', 'admin', 'vendor', 'tv']);

function flag(value) {
  return Number(value) ? 1 : 0;
}

function normalizeSlug(raw) {
  const slug = String(raw || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) return '';
  if (RESERVED.has(slug)) return '';
  return slug;
}

function cleanText(value, maxLen) {
  return plainLabel(value, maxLen);
}

function onMaster(group) {
  return !!(group && !flag(group.disabled));
}

function publicGroup(group) {
  return !!(group && !flag(group.disabled) && !flag(group.deleted));
}

function countsTowardCap(group) {
  return !!(group && !flag(group.deleted));
}

function creationBlock({ existing, createdInWindow }) {
  if (Number(existing) >= MAX_GROUPS) return 'the map already has as many groups as it can hold';
  if (Number(createdInWindow) >= MAX_CREATES_PER_HOUR) return 'too many new groups this hour, try again later';
  return '';
}

function uploadsAllowed(group, now) {
  if (!publicGroup(group)) return false;
  const at = Number(now) || 0;
  const open = group.uploads_open ? Date.parse(group.uploads_open) : NaN;
  const close = group.uploads_close ? Date.parse(group.uploads_close) : NaN;
  if (Number.isFinite(open) && at < open) return false;
  if (Number.isFinite(close) && at > close) return false;
  return true;
}

module.exports = {
  MAX_GROUPS,
  MAX_CREATES_PER_HOUR,
  CREATE_WINDOW_MS,
  MAX_GROUP_PENDING,
  RESERVED,
  normalizeSlug,
  cleanText,
  onMaster,
  publicGroup,
  countsTowardCap,
  creationBlock,
  uploadsAllowed,
};
