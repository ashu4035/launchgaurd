import test from 'node:test';
import assert from 'node:assert/strict';
import {visualTarget,captureVisualEvidence} from '../apps/api/src/visual-evidence.js';
import {auditPublished} from '../apps/api/src/published-audit.js';

test('visual capture reaches later links and reuses duplicate target results within a bounded budget',async()=>{
 const job={checks:['Internal links','Visual evidence'],environment:'Staging',scope:{},limits:{pages:1},findings:[],progress:{}};
 const links=Array.from({length:14},(_,i)=>`<a href="/#section${i}">Link ${i}</a>`).join('');
 let selected=[];
 await auditPublished({site:{shortName:'fixture'},pages:[{id:'home',publishedPath:'/'}],job,persist:async()=>{},emit:(ruleId,props)=>job.findings.push({id:String(job.findings.length),ruleId,...props}),read:async url=>({verified:true,status:url.endsWith('robots.txt')||url.endsWith('sitemap.xml')?404:200,url,contentType:'text/html',bytes:Buffer.from(links+'<a href="/#section0">Link 0</a>')}),capture:async(url,findings)=>{
   selected=findings;return new Map(findings.map(f=>[f.id,{status:'Captured',captures:[{viewport:{width:1440}},{viewport:{width:390}}]}]));
 }});
 assert.equal(selected.length,12);
 assert.equal(job.findings[5].visualEvidence.status,'Captured');
 assert.equal(job.findings[11].visualEvidence.status,'Captured');
 assert.match(job.findings[12].visualEvidence.reason,/limit/);
 assert.equal(job.findings[14].visualEvidence,job.findings[0].visualEvidence);
 assert.equal(job.visualEvidencePartial,true);
});

test('a link audit without visual evidence explains how to obtain screenshots',async()=>{
 const job={checks:['Internal links'],environment:'Staging',scope:{},limits:{pages:1},findings:[],progress:{}};
 await auditPublished({site:{shortName:'fixture'},pages:[{id:'home',publishedPath:'/',title:'Home'}],job,persist:async()=>{},emit:(ruleId,props)=>job.findings.push({id:ruleId,ruleId,...props}),read:async url=>({verified:true,status:url.endsWith('robots.txt')||url.endsWith('sitemap.xml')?404:200,url,contentType:'text/html',bytes:Buffer.from('<a href="/#blog">Blog</a>')})});
 const finding=job.findings.find(f=>f.ruleId==='internal-link');
 assert.equal(finding.elementText,'Blog');
 assert.match(finding.visualEvidence.reason,/not selected/);
 assert.deepEqual(finding.visualEvidence.captures,[]);
 assert.equal(job.visualEvidencePartial,undefined);
});

test('visual evidence maps only supported findings and never invents metadata/CMS locations',async()=>{
 assert.equal(visualTarget({ruleId:'required-field',resourceUrl:'https://example.com'}),null);
 assert.equal(visualTarget({ruleId:'published-title'}),null);
 assert.deepEqual(visualTarget({ruleId:'image-alt',resourceUrl:'https://example.com/logo.png'}),{kind:'image',url:'https://example.com/logo.png',missingAlt:true});
 const result=await captureVisualEvidence('https://example.com',[{id:'metadata',ruleId:'published-title'}],{enabled:true,read:()=>{throw Error('should not request');}});
 assert.equal(result.get('metadata').status,'Unavailable');assert.deepEqual(result.get('metadata').captures,[]);
});
test('published visual evidence uses the safe request path and marks unavailable screenshots as partial',async()=>{
 const job={checks:['Image alt text','Visual evidence'],environment:'Staging',scope:{},limits:{pages:1},findings:[],progress:{}};
 await auditPublished({site:{shortName:'fixture'},pages:[{id:'home',publishedPath:'/',title:'Home'}],job,persist:async()=>{},emit:(ruleId,props)=>job.findings.push({id:ruleId,ruleId,...props}),read:async url=>({verified:true,status:url.endsWith('robots.txt')||url.endsWith('sitemap.xml')?404:200,url,contentType:'text/html',bytes:Buffer.from('<img src="https://fixture.webflow.io/logo.png">')})});
 const finding=job.findings.find(f=>f.ruleId==='image-alt');
 assert.equal(finding.visualEvidence.status,'Unavailable');assert.equal(job.visualEvidencePartial,true);
});
