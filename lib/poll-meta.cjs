let lastStale = false;

function markPollStale(value) {
  lastStale = !!value;
}

function takePollStale() {
  const value = lastStale;
  lastStale = false;
  return value;
}

function resetPollStale() {
  lastStale = false;
}

module.exports = { markPollStale, takePollStale, resetPollStale };
