import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
await writeFile(new URL('../.env.render-key', import.meta.url), 'TOKEN_ENCRYPTION_KEY=' + randomBytes(32).toString('hex') + '\n', {flag: 'wx', mode: 0o600});
console.log('Created .env.render-key. Copy its value directly into Render and keep this file private.');
