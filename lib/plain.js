// Place and ordinance text is shown on the TV and may later be exported.
// Drop characters that reorder a line or start a spreadsheet formula.
function plainLabel(value, maxLen = 160) {
  let text = String(value == null ? '' : value);
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^[+=@-]+/, '').trim();
  if (text.length > maxLen) text = text.slice(0, maxLen).trim();
  return text;
}

module.exports = { plainLabel };
