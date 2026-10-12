// Compare reset tokens without a direct string compare.
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return new Uint8Array(digest);
}

async function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  const [left, right] = await Promise.all([sha256(provided), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function bearerToken(header) {
  const match = String(header || '').match(/^Bearer\s+(\S.*)$/i);
  return match ? match[1].trim() : '';
}

module.exports = { sha256, tokensMatch, bearerToken };
