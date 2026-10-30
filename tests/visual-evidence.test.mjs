import test from 'node:test';
import assert from 'node:assert/strict';
import {visualTarget,captureVisualEvidence} from '../apps/api/src/visual-evidence.js';
import {auditPublished} from '../apps/api/src/published-audit.js';

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
