// Language-agnostic parser for FamilySearch "Completed ordinances" CSV exports.
// The site builds the CSV client-side with 6 columns in fixed order:
// personName, familyTreePersonId, qualifyingEvent ("type, date, place"), ordinanceType, localizedPerformedDate, templeName.
// Headers are translated, so we identify columns structurally and validate by content.
const PID_RE = /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/;
const COLS = { name: 0, id: 1, event: 2, ordinance: 3, date: 4, temple: 5 };

// ---------- CSV ----------
function detectDelimiter(text) {
  const line = text.split(/\r?\n/, 1)[0] || '';
  const count = ch => { let n = 0, q = false; for (const c of line) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  return [',', ';', '\t'].map(d => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
}
function parseCSV(text, delim) {
  text = String(text).replace(/^\uFEFF/, '');
  delim = delim || detectDelimiter(text);
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(Boolean));
}

// ---------- Dates ----------
const LOCALES = ['en','es','pt','fr','de','it','nl','da','sv','no','nb','fi','is','et','lv','lt','pl','cs','sk','sl','hr','sr','bg','mk','ro','hu','el','ru','uk','hy','ka','mn','tr','sq','id','ms','vi','th','km','tl','fil','ceb','to','sm','fj','ht','mg','sw','eo','ar','fa','ja','ko','zh','bi','gil','gn'];
const strip = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\.$/, '');
const MONTHS = (() => {
  const m = new Map(); // normalized name -> month index (0-11)
  for (const loc of LOCALES) for (const style of ['long', 'short']) for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2026, i, 15));
    try {
      const names = [new Intl.DateTimeFormat(loc, { month: style, timeZone: 'UTC' }).format(d),
        ...new Intl.DateTimeFormat(loc, { day: 'numeric', month: style, year: 'numeric', timeZone: 'UTC' }).formatToParts(d).filter(p => p.type === 'month').map(p => p.value)];
      for (const n of names) { const k = strip(n); if (k && !/^\d+$/.test(k) && !m.has(k)) m.set(k, i); }
    } catch {}
  }
  // FamilySearch/genealogy abbreviations not always produced by Intl
  [['sept', 8], ['set', 8], ['dic', 11], ['ago', 7], ['abr', 3], ['mai', 4], ['okt', 9], ['dez', 11], ['mrz', 2], ['maerz', 2]].forEach(([k, v]) => m.has(k) || m.set(k, v));
  return m;
})();
const monthOf = tok => MONTHS.has(strip(tok)) ? MONTHS.get(strip(tok)) : undefined;
const mk = (y, mo, d) => { const t = new Date(Date.UTC(y, mo, d || 1)); return (t.getUTCMonth() === mo && y > 1000) ? t : null; };

function parseDate(s) {
  s = String(s || '').trim(); if (!s) return null;
  let r;
  if ((r = s.match(/(\d{4})\s*[年년.\/-]\s*(\d{1,2})\s*[月월.\/-]\s*(\d{1,2})?/))) return mk(+r[1], +r[2] - 1, r[3] ? +r[3] : 1); // CJK / ISO / y.m.d
  if ((r = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/))) { // numeric; assume day-first unless impossible
    let a = +r[1], b = +r[2]; if (b > 12 && a <= 12) [a, b] = [b, a]; return mk(+r[3], b - 1, a);
  }
  const yr = s.match(/\b(\d{4})\b/); if (!yr) return null;
  const toks = s.replace(/\b\d{4}\b/, ' ').split(/[\s,.\/]+|(?<=\d)(?=\D)|(?<=\D)(?=\d)/).filter(Boolean);
  let mo, day;
  for (const t of toks) { const m = monthOf(t); if (m !== undefined && mo === undefined) mo = m; else if (/^\d{1,2}$/.test(t) && day === undefined) day = +t; }
  // try two-word month names (e.g. Tongan/Samoan "Sepitema")
  if (mo === undefined) for (const [k, v] of MONTHS) if (k.length > 3 && strip(s).includes(k)) { mo = v; break; }
  if (mo === undefined) return null;
  return mk(+yr[1], mo, day);
}
const isDateLike = tok => !!tok && (/\d{3,4}/.test(tok) || parseDate(tok) !== null || /^(abt|about|bef|before|aft|after|est|cal|circa|c\.)\b/i.test(tok));

// ---------- Qualifying event ----------
function extractPlace(ev) {
  const parts = String(ev || '').split(/[,，、]/).map(s => s.trim());
  parts.shift(); // translated event type
  while (parts.length && (parts[0] === '' || isDateLike(parts[0]))) parts.shift(); // date slot (may be empty)
  return parts.filter(Boolean).join(', ');
}

// ---------- Structure ----------
function analyze(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { ok: false, reason: 'empty file' };
  const width = Math.max(...rows.map(r => r.length));
  const sample = rows.slice(1, 60);
  const frac = (col, fn) => sample.length ? sample.filter(r => fn(r[col] || '')).length / sample.length : 0;
  // locate PID column (expected index 1)
  let id = COLS.id; let best = frac(id, v => PID_RE.test(v));
  for (let c = 0; c < width; c++) { const f = frac(c, v => PID_RE.test(v)); if (f > best + 0.2) { best = f; id = c; } }
  const off = id - COLS.id, col = k => COLS[k] + off;
  const hasHeader = !PID_RE.test(rows[0][id] || '');
  const data = hasHeader ? rows.slice(1) : rows;
  const checks = { pid: best, event: frac(col('event'), v => v.includes(',')), date: frac(col('date'), v => parseDate(v) !== null) };
  const ok = width >= 5 && checks.pid >= 0.5 && checks.event >= 0.3;
  const records = data.map(r => ({ name: r[col('name')], id: r[col('id')], event: r[col('event')], ordinance: r[col('ordinance')], dateText: r[col('date')], temple: r[col('temple')] }));
  return { ok, reason: ok ? '' : 'does not look like a FamilySearch Completed ordinances list', header: hasHeader ? rows[0] : null, checks, records };
}
module.exports = { PID_RE, parseCSV, detectDelimiter, parseDate, extractPlace, analyze, isDateLike, MONTHS };
