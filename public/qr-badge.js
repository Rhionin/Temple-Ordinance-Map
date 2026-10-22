// QR target for the TV map. Group maps link to that group's share page.
// The master map has no single upload page, so it links to /new, where a
// group is started and people then add their lists.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/qrcode'));
  else root.QrBadge = factory(root.qrcode);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (qrcode) {
  const CAPTION = 'Add your ancestors';
  const ECC = 'Q';
  const QUIET = 4;

  function enabled(search) {
    const raw = String(search || '');
    const params = new URLSearchParams(raw.charAt(0) === '?' ? raw.slice(1) : raw);
    return params.get('qr') !== '0';
  }

  function targetFor(loc) {
    const source = loc || {};
    const origin = String(source.origin || '').replace(/\/$/, '');
    let host = String(source.host || '');
    if (!host && origin) {
      try { host = new URL(origin).host; }
      catch (error) { host = origin.replace(/^https?:\/\//, ''); }
    }
    const pathname = String(source.pathname || '/');
    const match = pathname.match(/^\/g\/([^/]+)\/map\/?$/);
    let path = '/new';
    if (match) {
      let slug = match[1];
      try { slug = decodeURIComponent(slug); } catch (error) { /* keep the raw segment */ }
      path = '/g/' + encodeURIComponent(slug);
    }
    return {
      href: origin + path,
      label: host + path,
      caption: CAPTION,
    };
  }

  function encode(text) {
    const qr = qrcode(0, ECC);
    qr.addData(String(text));
    qr.make();
    return qr;
  }

  function matrix(text) {
    const qr = encode(text);
    const count = qr.getModuleCount();
    const rows = [];
    for (let row = 0; row < count; row += 1) {
      let bits = '';
      for (let col = 0; col < count; col += 1) bits += qr.isDark(row, col) ? '1' : '0';
      rows.push(bits);
    }
    return { count: count, quiet: QUIET, ecc: ECC, rows: rows };
  }

  function svg(text) {
    const drawn = encode(text).createSvgTag({
      cellSize: 1,
      margin: QUIET,
      scalable: true,
      alt: String(text),
      title: CAPTION,
    });
    return drawn.replace('<svg ', '<svg shape-rendering="crispEdges" ');
  }

  return { CAPTION: CAPTION, ECC: ECC, QUIET: QUIET, enabled: enabled, targetFor: targetFor, matrix: matrix, svg: svg };
});
