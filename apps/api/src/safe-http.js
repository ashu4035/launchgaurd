import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import ipaddr from 'ipaddr.js';
import {Agent, fetch} from 'undici';

export function publicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === 'unicast';
  } catch {return false;}
}
export function normalizeUrl(input, base) {
  if (typeof input !== 'string' || !input.trim()) return null;
  try {
    const url = new URL(input, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return null;
    url.hash = '';
    return url.href;
  } catch {return null;}
}
export async function safeRead(input, {maxBytes = 2000000, timeout = 8000, method = 'GET', signal} = {}) {
  let current = normalizeUrl(input);
  if (!current) return {error: 'Unsupported or invalid URL', verified: false};
  try {
    for (let redirect = 0; redirect <= 5; redirect++) {
      signal?.throwIfAborted();
      const url = new URL(current);
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') && !isIP(host)) throw Error('Local destination blocked');
      const addresses = isIP(host) ? [{address: host, family: isIP(host)}] : await Promise.race([
        lookup(host, {all: true}),
        new Promise((_, reject) => {const timer = setTimeout(() => reject(Error('DNS lookup timed out')), timeout); timer.unref();}),
      ]);
      if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw Error('Private or reserved destination blocked');
      // Pin the validated DNS answer for this request, including every redirect.
      const pinned = addresses[0];
      const dispatcher = new Agent({connect: {lookup: (_host, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)}});
      try {
        const response = await fetch(current, {method, dispatcher, redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout), headers: {'User-Agent': 'LaunchGuard/0.4 (read-only website audit)', Accept: '*/*'}});
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const next = normalizeUrl(response.headers.get('location'), current);
          if (!next || redirect === 5) throw Error('Invalid redirect or redirect limit reached');
          current = next; continue;
        }
        const chunks = []; let size = 0;
        for await (const chunk of response.body || []) {
          size += chunk.length;
          if (size > maxBytes) throw Error('Response exceeds size limit');
          chunks.push(Buffer.from(chunk));
        }
        return {status: response.status, url: current, contentType: response.headers.get('content-type') || '', robotsHeader: response.headers.get('x-robots-tag') || '', bytes: Buffer.concat(chunks), verified: true};
      } finally {await dispatcher.destroy();}
    }
  } catch (error) {return {url: current, error: error.message, verified: false};}
}
