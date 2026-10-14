import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAddress, normalizeUrl, safeRead} from '../apps/api/src/safe-http.js';
import {inspectHtml, auditPublished} from '../apps/api/src/published-audit.js';
import {isEmpty, runAudit} from '../apps/api/src/audit-runner.js';
import {resourceStatus} from '../apps/api/src/resource-checks.js';

test('URL and IP safety block private, mapped, metadata and non-web targets', async () => {
  for (const address of ['127.0.0.1','10.1.1.1','169.254.169.254','192.168.0.1','172.16.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','0.0.0.0','224.0.0.1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(normalizeUrl(undefined,'https://example.com'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('https://user:pass@example.com'), null);
  assert.equal(normalizeUrl('/path#fragment','https://example.com'), 'https://example.com/path');
  assert.equal((await safeRead('http://127.0.0.1/')).verified, false);
  assert.equal((await safeRead('http://[::ffff:127.0.0.1]/')).verified, false);
});
test('HTML metadata, decorative alt, rich-text emptiness and file signatures', () => {
  const parsed=inspectHtml('<title>Template fallback</title><meta name="description" content="Dynamic description"><img src="/a.png" alt=""><img role="presentation" src="/b.png"><h1>Home</h1>','https://example.com/');
  assert.equal(parsed.title,'Template fallback'); assert.equal(parsed.description,'Dynamic description');
  assert.equal(parsed.images[0].alt,''); assert.equal(parsed.images[1].decorative,true);
  assert.equal(isEmpty('<p><br>&nbsp;</p>','RichText'),true);
  assert.equal(isEmpty('<p>Content</p>','RichText'),false);
  assert.equal(isEmpty(false,'Switch'),false); assert.equal(isEmpty(0,'Number'),false); assert.equal(isEmpty([],'MultiImage'),true);
  assert.equal(resourceStatus({verified:true,status:200,contentType:'text/html',bytes:Buffer.from('<html/>')},'download','https://example.com/file.pdf'),'Issue');
  assert.equal(resourceStatus({verified:true,status:200,contentType:'application/pdf',bytes:Buffer.from('not a PDF')},'download','https://example.com/file.pdf'),'Issue');
  assert.equal(resourceStatus({verified:true,status:200,contentType:'application/pdf',bytes:Buffer.from('%PDF-1.7')},'download','https://example.com/file.pdf'),'Pass');
  assert.equal(resourceStatus({verified:false,error:'timeout'},'image'),'Could not verify');
});
const fixtures={
 '/robots.txt':{status:200,type:'text/plain',body:'User-agent: *\nDisallow: /private'},
 '/sitemap.xml':{status:200,type:'application/xml',body:'<urlset><url><loc>https://fixture.webflow.io/</loc></url><url><loc>https://fixture.webflow.io/private</loc></url></urlset>'},
 '/':{status:200,type:'text/html',body:'<html><head><title>Home</title><meta name="description" content="Template fallback"></head><body><h1>Home</h1><a href="/missing">Missing</a><a href="/fake.pdf">Brochure</a><a href="/blocked">Blocked</a><img src="/bad.png"><img src="/decoration.svg" alt=""></body></html>'},
 '/missing':{status:404,type:'text/html',body:'missing'},
 '/fake.pdf':{status:200,type:'text/html',body:'<html>Login</html>'},
 '/blocked':{status:403,type:'text/html',body:'forbidden'},
 '/bad.png':{status:404,type:'text/html',body:'missing'},
 '/decoration.svg':{status:200,type:'image/svg+xml',body:'<svg></svg>'},
};
const fixtureRead=async url=>{const row=fixtures[new URL(url).pathname];return row?{verified:true,status:row.status,contentType:row.type,bytes:Buffer.from(row.body),url}:{verified:false,error:'timeout',url};};
test('published checks identify broken resources without confusing forbidden URLs with broken links',async()=>{
 const job={checks:['Published SEO','Internal links','Download links','Image loading','Image alt text'],environment:'Staging',findings:[],scope:{}};
 await auditPublished({site:{shortName:'fixture'},pages:[{id:'home',title:'Home',publishedPath:'/'}],job,emit:(ruleId,finding)=>job.findings.push({ruleId,...finding}),persist:async()=>{},read:fixtureRead});
 assert.equal(job.findings.some(f=>f.ruleId==='published-title'||f.ruleId==='published-description'),false);
 assert.equal(job.findings.find(f=>f.resourceUrl==='https://fixture.webflow.io/missing').status,'Issue');
 assert.equal(job.findings.find(f=>f.resourceUrl==='https://fixture.webflow.io/blocked').status,'Could not verify');
 assert.equal(job.findings.find(f=>f.ruleId==='download-link').status,'Issue');
 assert.equal(job.findings.filter(f=>f.ruleId==='image-alt').length,1);
 assert.equal(job.publishedResults.find(page=>page.url.endsWith('/private')).status,'Skipped');
});
test('missing live domain and bounded partial scans never produce a full pass',async()=>{
 const job={checks:['Published SEO'],environment:'Live',findings:[]};
 await auditPublished({site:{shortName:'fixture'},pages:[],job,emit:(ruleId,f)=>job.findings.push({ruleId,...f}),persist:async()=>{},read:fixtureRead});
 assert.equal(job.findings[0].status,'Could not verify');
 const limited={checks:['Published SEO'],environment:'Staging',findings:[],limits:{requests:1,pages:1}};
 await auditPublished({site:{shortName:'fixture'},pages:[{id:'home',publishedPath:'/',title:'Home'}],job:limited,emit:(ruleId,f)=>limited.findings.push({ruleId,...f}),persist:async()=>{},read:fixtureRead});
 assert.equal(limited.coverage.limited,true);
 assert.equal(limited.findings.some(f=>f.ruleId==='scan-limit'),true);
});
test('CMS scope rechecks only selected item and preserves stable finding identity',async()=>{
 const makeJob=()=>({id:'scan',siteId:'site',environment:'Staging',rules:[{collectionId:'services',fieldSlug:'summary',required:true}],checks:[],scope:{collectionIds:['services'],itemIds:['web-design'],skipPages:true},findings:[]});
 const all=async(path)=>path==='/sites'?[{id:'site'}]:path.includes('/collections')?[{id:'services',displayName:'Services'}]:[];
 const inventory=async(path,key)=>key==='items'?[{id:'web-design',fieldData:{name:'Web Design',summary:''}},{id:'branding',fieldData:{name:'Branding',summary:''}}]:all(path);
 const deps={all:inventory,api:async()=>({fields:[{slug:'summary',displayName:'Summary',type:'PlainText'}]}),persist:async()=>{},token:'test',read:fixtureRead};
 const first=makeJob();await runAudit(first,deps);assert.equal(first.progress.items,1);assert.equal(first.findings.length,1);
 const second=makeJob();second.id='new-scan';await runAudit(second,deps);assert.equal(first.findings[0].id,second.findings[0].id);
});
