// Copy and counts for the upload page after a CSV is accepted.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UploadStatus = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function count(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function lightsPhrase(n, beingAdded) {
    if (n === 1) return beingAdded ? 'Your 1 light is being added to the map' : 'Your 1 light is on the map';
    return beingAdded
      ? 'Your ' + n + ' lights are being added to the map'
      : 'Your ' + n + ' lights are on the map';
  }

  function describeUpload(stats) {
    const pastYear = count(stats && stats.pastYear);
    const added = count(stats && stats.added);
    const queued = count(stats && stats.queued);
    const duplicate = count(stats && stats.duplicate);
    const arriving = added + queued;
    if (pastYear <= 0) {
      return {
        kind: 'empty',
        title: 'No lights from this past year',
        message: 'This list has no temple ordinances from the past year. Download a current Completed list and try again.',
      };
    }
    if (arriving === 0 && duplicate === 0) {
      return {
        kind: 'empty',
        title: 'No lights to add',
        message: 'Those past-year ordinances didn’t include a place we could map. Nothing new was added.',
      };
    }
    const beingAdded = queued > 0;
    return {
      kind: 'success',
      title: arriving > 0 ? lightsPhrase(arriving, beingAdded) : 'Your lights are already on the map',
      doneTitle: arriving > 0 ? lightsPhrase(arriving, false) : 'Your lights are already on the map',
      pastYear,
      added,
      duplicate,
      queued,
      arriving,
      mapHref: '/',
      mapLabel: 'See the map',
    };
  }

  function describeProgress(found, expected, stalled) {
    const have = count(found);
    const need = count(expected);
    if (!need) return '';
    if (have >= need) return need === 1 ? 'That light is on the map' : 'All ' + need + ' new lights are on the map';
    if (stalled) return 'Found ' + have + ' of ' + need + ' places. The rest appear on the map if they can be located.';
    return 'Finding places — ' + have + ' of ' + need;
  }

  function describeError(kind, detail) {
    if (kind === 'file') {
      return 'That file doesn’t look like a FamilySearch Completed list. Use the Download List file from step 2.';
    }
    if (kind === 'network') {
      return 'We couldn’t reach the map. Check your connection and try the upload again.';
    }
    if (kind === 'large') {
      return 'That file is too large. Use the Completed list from step 2.';
    }
    return 'We couldn’t add these lights. ' + (detail ? String(detail) : 'Try again.');
  }

  return { describeUpload, describeProgress, describeError };
});
