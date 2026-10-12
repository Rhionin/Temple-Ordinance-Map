const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BIDI_CONTROLS = /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const LEADING_FORMULA = /^[+=@-]+/;

function plainLabel(value, maxLen = 160) {
  let text = String(value == null ? '' : value);
  text = text.replace(CONTROLS, '');
  text = text.replace(BIDI_CONTROLS, '');
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(LEADING_FORMULA, '').trim();
  if (text.length > maxLen) text = text.slice(0, maxLen).trim();
  return text;
}

module.exports = { plainLabel };
