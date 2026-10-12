const MAX_PEOPLE = 800;
const MAX_PAST_YEAR_ROWS = 3000;
const MAX_PENDING_JOBS = 4000;
const MAX_RECENT = 8000;
const RECENT_MS = 10 * 60 * 1000;
const BUSY = 'the map is still catching up, try again in a few minutes';

function planLimitReason(plan) {
  if (!plan || !plan.ok) return '';
  const people = (plan.immediate ? plan.immediate.length : 0) + (plan.pending ? plan.pending.length : 0);
  if (people > MAX_PEOPLE) return 'too many people in one file';
  const rows = plan.stats && plan.stats.pastYear ? plan.stats.pastYear : 0;
  if (rows > MAX_PAST_YEAR_ROWS) return 'too many rows in one file';
  return '';
}

function queueLimitReason(pendingNow, incoming) {
  if (!incoming) return '';
  if (Number(pendingNow) + incoming > MAX_PENDING_JOBS) return BUSY;
  return '';
}

function recentLimitReason(recentNow, incoming) {
  if (!incoming) return '';
  if (Number(recentNow) + incoming > MAX_RECENT) return BUSY;
  return '';
}

module.exports = {
  MAX_PEOPLE,
  MAX_PAST_YEAR_ROWS,
  MAX_PENDING_JOBS,
  MAX_RECENT,
  RECENT_MS,
  planLimitReason,
  queueLimitReason,
  recentLimitReason,
};
