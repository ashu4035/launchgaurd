import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';

test('persisted jobs recover without duplicating findings and block duplicate active scans',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'launchguard-queue-'));
 const file=join(folder,'db.json'),base='http://127.0.0.1:18883';
 const scanId='11111111-1111-1111-1111-111111111111';
 await writeFile(file,JSON.stringify({sessions:{},states:{},scans:{[scanId]:{id:scanId,siteId:'site-one',sessionId:'local-development',environment:'Staging',createdAt:new Date().toISOString(),status:'running',attempts:1,rules:[{collectionId:'collection-one',fieldSlug:'summary',required:true}],checks:['SEO metadata'],findings:[{id:'obsolete'}]}}}));
 const child=spawn(process.execPath,['--import',pathToFileURL(resolve('tests/webflow-mock.mjs')).href,'apps/api/src/server.js'],{env:{...process.env,PORT:'18883',NODE_ENV:'test',WEBFLOW_SITE_API_TOKEN:'fixture',DATABASE_URL:'',PUBLIC_BASE_URL:base,FRONTEND_ORIGIN:base,LAUNCHGUARD_DB:file,MOCK_DELAY_MS:'40'},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let stderr='';child.stderr.on('data',data=>stderr+=data);
 try{
  await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error(stderr);}),new Promise((_,reject)=>setTimeout(()=>reject(Error('startup timeout')),5000).unref())]);
  const duplicate=await fetch(base+'/api/scans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId:'site-one',checks:['SEO metadata'],rules:[]})});assert.equal(duplicate.status,409);
  let scan;
  for(let attempt=0;attempt<80;attempt++){scan=(await(await fetch(base+'/api/scans/'+scanId)).json()).scan;if(scan.status==='complete')break;await new Promise(done=>setTimeout(done,20));}
  assert.equal(scan.status,'complete');assert.equal(scan.attempts,2);assert.equal(scan.findings.length,2);assert.equal(scan.findings.some(f=>f.id==='obsolete'),false);
 }finally{if(child.exitCode===null)child.kill();await exited;await rm(folder,{recursive:true,force:true});}
});
