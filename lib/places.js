// Place-string fallbacks for Nominatim. Shared by the Node server and the Worker.
const NOISE = /\b(parish|sogn|sn|herred|amt|county|co\.|township|twp|district|hundred|municipality|kommune|socken|landsogn)\b/gi;

function candidates(place) {
  const out = [];
  const push = s => {
    s = String(s).replace(/\s+/g, ' ').replace(/^,|,$/g, '').trim();
    if (s && !out.includes(s)) out.push(s);
  };
  const p = String(place || '').split(',').map(s => s.trim()).filter(Boolean);
  push(p.join(', '));
  const clean = p.map(s => s.replace(NOISE, '').trim()).filter(Boolean);
  push(clean.join(', '));
  if (clean.length > 2) push(clean[0] + ', ' + clean[clean.length - 1]);
  for (let i = 1; i < clean.length; i++) push(clean.slice(i).join(', '));
  for (let i = clean.length - 1; i >= 2; i--) push([clean[0], ...clean.slice(1, i)].join(', '));
  return out;
}

module.exports = { candidates, NOISE };
