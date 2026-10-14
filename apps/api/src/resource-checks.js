export function resourceStatus(response, kind, url = '') {
  if (!response.verified || !response.status) return 'Could not verify';
  if ([404, 410].includes(response.status)) return 'Issue';
  if (response.status < 200 || response.status >= 300) return 'Could not verify';
  const type = (response.contentType || '').split(';')[0].toLowerCase();
  const bytes = response.bytes || Buffer.alloc(0);
  if (kind === 'image') {
    if (!type.startsWith('image/')) return 'Issue';
    const matches = {
      'image/png': bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
      'image/jpeg': bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      'image/gif': /^GIF8[79]a/.test(bytes.subarray(0,6).toString()),
      'image/webp': bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP',
      'image/svg+xml': /<svg(?:\s|>)/i.test(bytes.toString()),
      'image/avif': bytes.subarray(4,8).toString() === 'ftyp' && /avif|avis/.test(bytes.subarray(8,32).toString()),
      'image/x-icon': bytes.subarray(0,4).equals(Buffer.from([0,0,1,0])),
    };
    return type in matches ? matches[type] ? 'Pass' : 'Issue' : 'Could not verify';
  }
  if (kind === 'download') {
    if (!type || /text\/html|application\/xhtml/.test(type) || !bytes.length) return 'Issue';
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.pdf')) return bytes.subarray(0,5).toString() === '%PDF-' ? 'Pass' : 'Issue';
    if (/\.(zip|docx|xlsx|pptx)$/.test(path)) return bytes[0] === 80 && bytes[1] === 75 ? 'Pass' : 'Issue';
    // A successful response alone cannot prove an unknown file's identity.
    return 'Could not verify';
  }
  return 'Pass';
}
