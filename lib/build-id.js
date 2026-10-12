// The id open pages compare against /api/version. A deploy sets BUILD_ID to
// the commit SHA. Local Node falls back to git, then to "dev".
function resolveBuildId(value, readGit) {
  const given = String(value || '').trim();
  if (given) return given;
  if (typeof readGit !== 'function') return 'dev';
  try {
    const sha = String(readGit() || '').trim();
    if (/^[0-9a-f]{7,64}$/i.test(sha)) return sha;
  } catch (error) { /* this process has no git metadata */ }
  return 'dev';
}

module.exports = { resolveBuildId };
