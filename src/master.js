// The master map folds every group that is not disabled, including soft-deleted groups.
import { foldLights } from '../lib/fold.js';
import { masterPollBundle, groupLightsSince, invalidateMasterPoll } from '../lib/poll-cache.js';

function sinceFilter(rows, since) {
  return groupLightsSince({ lights: rows }, since);
}

export function masterStore(db) {
  return {
    async listLights(since) {
      const min = Number(since) || 0;
      const bundle = await masterPollBundle(db);
      if (min <= 0) return bundle.folded;
      return sinceFilter(bundle.folded, min);
    },
    async stats() {
      const bundle = await masterPollBundle(db);
      return bundle.stats;
    },
  };
}

export { invalidateMasterPoll };
