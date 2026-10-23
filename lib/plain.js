const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BIDI_CONTROLS = /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const LEADING_FORMULA = /^[+=@-]+/;
// A UTF-8 lead byte, when those bytes were decoded as Latin-1, lands in this range.
const MOJIBAKE_LEAD = /[\u00C2-\u00DF]/;
// Windows-1252 maps bytes 0x80-0x9F to these characters. Latin-1 leaves them as controls.
const CP1252 = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A],
  [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92],
  [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C],
  [0x017E, 0x9E], [0x0178, 0x9F],
]);

// Undo one pass of UTF-8 bytes read as Latin-1 or Windows-1252.
// "Nagyrábé" stored that way arrives as "NagyrÃ¡bÃ©". A string that is already
// Unicode, including "Åland" and "広島", is left alone.
function repairUtf8(value) {
  const text = String(value == null ? '' : value);
  if (!MOJIBAKE_LEAD.test(text)) return text;
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const mapped = CP1252.get(code);
    if (mapped != null) bytes.push(mapped);
    else if (code <= 0xFF) bytes.push(code);
    else return text;
  }
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch (error) {
    return text;
  }
  if (!decoded || decoded.length >= text.length) return text;
  return decoded;
}

function plainLabel(value, maxLen = 160) {
  let text = repairUtf8(value);
  text = text.replace(CONTROLS, '');
  text = text.replace(BIDI_CONTROLS, '');
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(LEADING_FORMULA, '').trim();
  if (text.length > maxLen) text = text.slice(0, maxLen).trim();
  return text;
}

module.exports = { plainLabel, repairUtf8 };
