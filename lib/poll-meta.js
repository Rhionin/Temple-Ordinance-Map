let lastStale = false;

export function markPollStale(value) {
  lastStale = !!value;
}

export function takePollStale() {
  const value = lastStale;
  lastStale = false;
  return value;
}

export function resetPollStale() {
  lastStale = false;
}
