import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

test('shared API authorizes sites and saves a real scan flow against mocked Webflow', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'launchguard-test-'));
  const child = spawn(process.execPath, ['--import', pathToFileURL(resolve('tests/webflow-mock.mjs')).href, 'apps/api/src/server.js'], {
    env: {...process.env, PORT: '18879', WEBFLOW_SITE_API_TOKEN: 'test-only', NODE_ENV: 'test', LAUNCHGUARD_DB: join(folder, 'db.json')}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', data => {stderr += data;});
  try {
    await Promise.race([once(child.stdout, 'data'), exited.then(() => {throw Error(stderr || 'API exited before startup');}), new Promise((_, reject) => setTimeout(() => reject(Error('API startup timeout')), 5000).unref())]);
    const request = (path, body) => fetch('http://127.0.0.1:18879' + path, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {});
    assert.equal((await request('/api/sites')).status, 200);
    assert.equal((await request('/api/scans', {siteId: 'forbidden'})).status, 403);
    const collections = await (await request('/api/collections?siteId=site-one')).json();
    assert.equal(collections.collections[0].fields[0].slug, 'summary');
    const started = await (await request('/api/scans', {siteId: 'site-one', checks: ['SEO metadata'], rules: [{collectionId: 'collection-one', fieldSlug: 'summary', required: true}]})).json();
    let scan;
    for (let attempt = 0; attempt < 30; attempt++) {
      scan = (await (await request('/api/scans/' + started.id)).json()).scan;
      if (scan.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(scan.status, 'complete');
    assert.equal(scan.findings.length, 2);
    assert.deepEqual(scan.pageResults.map(page => [page.name, page.status, page.issues]), [['About', 'issues', 1], ['Home', 'passed', 0], ['Draft', 'skipped', 0]]);
    const history = await (await request('/api/scans')).json();
    assert.equal(history.scans[0].id, started.id);
    assert.equal(history.scans[0].issues, 2);
    const denied = await fetch('http://127.0.0.1:18879/api/sites', {headers: {Origin: 'https://untrusted.example'}});
    assert.equal(denied.status, 403);
  } finally {
    if (child.exitCode === null) child.kill(); await exited;
    await rm(folder, {recursive: true, force: true});
  }
});
