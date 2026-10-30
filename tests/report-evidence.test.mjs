import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';

test('owner-only screenshots never leak through a shared report or another session',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'launchguard-evidence-'));
 const owner='a'.repeat(64),viewer='b'.repeat(64),shareId='c'.repeat(48),id='12345678-1234-1234-1234-123456789abc';
 const secret='data:image/jpeg;base64,cHJpdmF0ZS1zY3JlZW5zaG90';
 const state={states:{},sessions:{[owner]:{token:'mock-webflow-token',created:Date.now()},[viewer]:{token:'mock-webflow-token',created:Date.now()}},shares:{[shareId]:{scanId:id,expiresAt:Date.now()+60000}},scans:{[id]:{id,siteId:'site-one',sessionId:owner,status:'complete',findings:[{id:'finding',ruleId:'image-alt',status:'Issue',visualEvidence:{status:'Captured',captures:[{closeup:secret,context:secret}]}}]}}};
 await writeFile(join(folder,'db.json'),JSON.stringify(state));
 const child=spawn(process.execPath,['--import',pathToFileURL(resolve('tests/webflow-mock.mjs')).href,'apps/api/src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'18887',NODE_ENV:'test',DATABASE_URL:'',WEBFLOW_SITE_API_TOKEN:'',PUBLIC_BASE_URL:'http://127.0.0.1:18887',LAUNCHGUARD_DB:join(folder,'db.json')},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let stderr='';child.stderr.on('data',value=>{stderr+=value;});
 try{
  await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error(stderr);}),new Promise((_,reject)=>setTimeout(()=>reject(Error('startup timeout')),5000).unref())]);
  const request=(path,session)=>fetch('http://127.0.0.1:18887'+path,{headers:session?{Authorization:'Bearer '+session}:{}});
  const own=await request('/api/scans/'+id,owner);assert.equal(own.status,200);assert.equal((await own.text()).includes(secret),true);
  assert.equal((await request('/api/scans/'+id,viewer)).status,404);
  assert.equal((await request('/api/reports/'+shareId)).status,401);
  const shared=await request('/api/reports/'+shareId,viewer);assert.equal(shared.status,200);
  const body=await shared.text();assert.equal(body.includes(secret),false);assert.equal(body.includes('audit owner'),true);
 }finally{if(child.exitCode===null)child.kill();await exited;await rm(folder,{recursive:true,force:true});}
});
