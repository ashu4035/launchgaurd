import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {encrypt, decrypt} from '../apps/api/src/storage.js';

test('encrypted persisted data rejects a wrong key and tampering', () => {
  const key = Buffer.alloc(32, 1);
  const encrypted = encrypt({sessions: {test: {token: 'private-token'}}}, key);
  assert.equal(encrypted.includes('private-token'), false);
  assert.deepEqual(decrypt(encrypted, key), {sessions: {test: {token: 'private-token'}}});
  assert.throws(() => decrypt(encrypted, Buffer.alloc(32, 2)));
  const changed = Buffer.from(encrypted, 'base64'); changed[30] ^= 1;
  assert.throws(() => decrypt(changed.toString('base64'), key));
});

test('hosted dashboard and OAuth validate browser state, session isolation, replay and popup origin', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'launchguard-oauth-'));
  const base = 'http://127.0.0.1:18880';
  const child = spawn(process.execPath, ['--import', pathToFileURL(resolve('tests/webflow-mock.mjs')).href, 'apps/api/src/server.js'], {
    env: {...process.env, PORT: '18880', NODE_ENV: 'test', WEBFLOW_SITE_API_TOKEN: '', DATABASE_URL: '', PUBLIC_BASE_URL: base, FRONTEND_ORIGIN: base, WEBFLOW_CLIENT_ID: 'mock-client', WEBFLOW_CLIENT_SECRET: 'mock-secret', LAUNCHGUARD_DB: join(folder, 'db.json')}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let stderr = ''; child.stderr.on('data', value => {stderr += value;});
  try {
    await Promise.race([once(child.stdout, 'data'), exited.then(() => {throw Error(stderr);}), new Promise((_, reject) => setTimeout(() => reject(Error('startup timeout')), 5000).unref())]);
    const request = (path, cookie) => fetch(base + path, {redirect: 'manual', headers: cookie ? {Cookie: cookie} : {}});
    assert.equal((await request('/api/sites')).status, 401);
    const page = await request('/'); assert.equal(page.status, 200); assert.match(await page.text(), /src=|script/);
    const start = await request('/auth/start'); assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cookie = start.headers.getSetCookie()[0].split(';')[0];
    assert.equal((await request('/auth/callback?code=test')).status, 400);
    assert.equal((await request('/auth/callback?code=test&state=' + state)).status, 400);
    const success = await request('/auth/callback?code=test&state=' + state, cookie);
    assert.equal(success.status, 302); assert.equal(success.headers.get('location'), base);
    const session = success.headers.getSetCookie().find(value => value.startsWith('lg_session=')).split(';')[0];
    assert.equal((await request('/api/sites', session)).status, 200);
    assert.equal((await request('/auth/callback?code=test&state=' + state, cookie)).status, 400);
    assert.equal((await request('/auth/start?client_origin=https://untrusted.example')).status, 400);
    const popup = await request('/auth/start?client_origin=http://localhost:1337');
    const popupState = new URL(popup.headers.get('location')).searchParams.get('state');
    const popupCookie = popup.headers.getSetCookie()[0].split(';')[0];
    const complete = await request('/auth/callback?code=test&state=' + popupState, popupCookie);
    const html = await complete.text();
    assert.match(html, /postMessage/); assert.match(html, /http:\/\/localhost:1337/);
    assert.equal(html.includes('mock-webflow-token'), false);
    const sid = complete.headers.getSetCookie().find(value => value.startsWith('lg_session=')).split(';')[0].split('=')[1];
    const authorized = await fetch(base + '/api/sites', {headers: {Authorization: 'Bearer ' + sid, Origin: 'http://localhost:1337'}});
    assert.equal(authorized.status, 200);
    const logout = await fetch(base + '/api/disconnect', {method: 'POST', headers: {Authorization: 'Bearer ' + sid, Origin: 'http://localhost:1337'}});
    assert.equal(logout.status, 200);
    assert.equal((await fetch(base + '/api/sites', {headers: {Authorization: 'Bearer ' + sid}})).status, 401);
    const saved = JSON.parse(await readFile(join(folder, 'db.json'), 'utf8'));
    assert.equal(saved.states[state], undefined);
  } finally {
    if (child.exitCode === null) child.kill(); await exited;
    await rm(folder, {recursive: true, force: true});
  }
});
