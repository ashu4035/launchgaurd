import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomBytes, createCipheriv, createDecipheriv} from 'node:crypto';
import pg from 'pg';

export function encrypt(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
}
export function decrypt(value, key) {
  const bytes = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
}
export async function openStorage({file, databaseUrl, encryptionKey, production}) {
  const empty = () => ({sessions: {}, states: {}, scans: {}});
  if (!databaseUrl) {
    if (production) return {ready: false, data: empty(), save: async () => {throw Error('Configure DATABASE_URL and TOKEN_ENCRYPTION_KEY before using OAuth');}};
    let data = empty();
    try {data = JSON.parse(await readFile(file, 'utf8'));} catch (error) {if (error.code !== 'ENOENT') throw error;}
    return {ready: true, data, save: async value => {await mkdir(dirname(file), {recursive: true}); await writeFile(file + '.tmp', JSON.stringify(value)); await rename(file + '.tmp', file);}};
  }
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey || '')) throw Error('TOKEN_ENCRYPTION_KEY must contain 64 hexadecimal characters');
  const key = Buffer.from(encryptionKey, 'hex');
  const pool = new pg.Pool({connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 15000});
  await pool.query('CREATE TABLE IF NOT EXISTS launchguard_state (id integer PRIMARY KEY CHECK (id = 1), payload text NOT NULL, revision integer NOT NULL DEFAULT 0)');
  await pool.query('INSERT INTO launchguard_state (id, payload) VALUES (1, $1) ON CONFLICT DO NOTHING', [encrypt(empty(), key)]);
  const {rows} = await pool.query('SELECT payload, revision FROM launchguard_state WHERE id = 1');
  let revision = rows[0].revision;
  return {ready: true, data: decrypt(rows[0].payload, key), save: async value => {
    // Refuse stale snapshots if two server instances overlap during deployment.
    const result = await pool.query('UPDATE launchguard_state SET payload = $1, revision = revision + 1 WHERE id = 1 AND revision = $2', [encrypt(value, key), revision]);
    if (!result.rowCount) throw Error('Storage changed in another instance; restart this service');
    revision++;
  }};
}
