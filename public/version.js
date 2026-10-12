// Poll /api/version and reload when a deploy publishes a new id.
// The TV calls boundary() at the next spotlight or timeline transition.
// The upload page reloads only while idle; otherwise it asks for a refresh.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Version = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EVERY_MS = 60000;

  function blank() {
    return { current: '', next: '' };
  }

  function noteRemote(state, version) {
    const current = state || blank();
    const next = String(version || '').trim();
    if (!next) return { state: current, action: 'stay' };
    if (!current.current) return { state: { current: next, next: '' }, action: 'stay' };
    if (next === current.current) return { state: { current: current.current, next: '' }, action: 'stay' };
    if (next === current.next) return { state: current, action: 'wait' };
    return { state: { current: current.current, next }, action: 'wait' };
  }

  function releaseBoundary(state) {
    const current = state || blank();
    if (!current.next) return { state: current, action: 'stay' };
    return { state: { current: current.next, next: '' }, action: 'reload' };
  }

  function noteUpload(state, version, idle) {
    const marked = noteRemote(state, version);
    if (marked.action !== 'wait') return marked;
    if (!idle) return { state: marked.state, action: 'notice' };
    return releaseBoundary(marked.state);
  }

  function watch(options) {
    const settings = options || {};
    let state = blank();
    let stopped = false;

    async function poll() {
      if (stopped) return;
      let version = '';
      try {
        const response = await fetch('/api/version', { cache: 'no-store' });
        if (response.ok) {
          const body = await response.json();
          version = body && body.version;
        }
      } catch (error) { version = ''; }
      if (settings.mode === 'upload') {
        const step = noteUpload(state, version, !!settings.idle());
        state = step.state;
        if (step.action === 'reload') settings.reload();
        else if (step.action === 'notice' && settings.notice) settings.notice();
        return;
      }
      state = noteRemote(state, version).state;
    }

    poll();
    const timer = setInterval(poll, settings.every || EVERY_MS);
    return {
      boundary() {
        const step = releaseBoundary(state);
        state = step.state;
        if (step.action !== 'reload') return false;
        stopped = true;
        clearInterval(timer);
        settings.reload();
        return true;
      },
      stop() {
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  return { EVERY_MS, noteRemote, releaseBoundary, noteUpload, watch };
});
