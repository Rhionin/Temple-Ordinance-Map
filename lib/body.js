async function readLimitedText(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    const error = new Error('file too large');
    error.status = 413;
    throw error;
  }
  if (request.body && typeof request.body.getReader === 'function') {
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        const error = new Error('file too large');
        error.status = 413;
        throw error;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8').decode(bytes);
  }
  const text = typeof request.text === 'function' ? await request.text() : '';
  if (Buffer.byteLength(text) > maxBytes) {
    const error = new Error('file too large');
    error.status = 413;
    throw error;
  }
  return text;
}

module.exports = { readLimitedText };
