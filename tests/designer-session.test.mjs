import test from 'node:test';
import assert from 'node:assert/strict';
import {designerSession, sessionActive, resolveDesignerUser} from '../apps/api/src/designer-session.js';

const setup = () => {
 const session = {token:'server-only-token',created:Date.now()};
 const sessions = {owner:session};
 let writes = 0;
 return {sessions,options:{sessions,idToken:'verified-by-provider',siteId:'site-one',verify:async()=>({id:'user-one',siteId:'site-one'}),sites:async()=>[{id:'site-one'}],persist:async()=>{writes++;}},writes:()=>writes};
};
test('binds a verified Designer identity and restores the same session/history after relaunch',async()=>{
 const fixture=setup();
 assert.equal(await designerSession(fixture.options),null);
 const bound=await designerSession({...fixture.options,sid:'owner'});
 assert.equal(bound.session,'owner');assert.equal(fixture.writes(),1);
 const restored=await designerSession(fixture.options);
 assert.equal(restored.session,'owner');assert.equal(restored.expiresAt,bound.expiresAt);
 const reloaded=await designerSession({...fixture.options,sessions:JSON.parse(JSON.stringify(fixture.sessions))});
 assert.equal(reloaded.session,'owner');
 assert.equal(JSON.stringify(restored).includes('server-only-token'),false);
});
test('different Designer users and sites cannot recover an existing session',async()=>{
 const {options}=setup();await designerSession({...options,sid:'owner'});
 assert.equal(await designerSession({...options,verify:async()=>({id:'user-two',siteId:'site-one'})}),null);
 assert.equal(await designerSession({...options,siteId:'site-two'}),null);
 assert.equal(await designerSession({...options,sid:'owner',verify:async()=>({id:'user-two',siteId:'site-one'})}),null);
 assert.equal(await designerSession({...options,sid:'owner',verify:async()=>({id:'user-one',siteId:'site-two'})}),null);
});
test('rejects invalid identity tokens, missing site authorization, expired and revoked sessions',async()=>{
 const {options,sessions}=setup();await designerSession({...options,sid:'owner'});
 assert.equal(await designerSession({...options,idToken:''}),null);
 assert.equal(await designerSession({...options,verify:async()=>{throw Error('forged token');}}),null);
 assert.equal(await designerSession({...options,sites:async()=>[]}),null);
 sessions.owner.created=Date.now()-604800001;
 assert.equal(sessionActive(sessions.owner),false);assert.equal(await designerSession(options),null);
 delete sessions.owner;
 assert.equal(await designerSession(options),null);
});
test('revocation during provider verification cannot restore a disconnected session',async()=>{
 const {options,sessions}=setup();await designerSession({...options,sid:'owner'});
 assert.equal(await designerSession({...options,verify:async()=>{delete sessions.owner;return{id:'user-one',siteId:'site-one'};}}),null);
});
test('provider resolution uses a fixed endpoint and rejects unsuccessful or incomplete identity',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.webflow.com/beta/token/resolve');assert.equal(options.headers.Authorization,'Bearer server-token');assert.deepEqual(JSON.parse(options.body),{idToken:'designer-proof'});return new Response(JSON.stringify({id:'user',siteId:'site'}));};
  assert.deepEqual(await resolveDesignerUser('designer-proof','server-token'),{id:'user',siteId:'site'});
  globalThis.fetch=async()=>new Response('{}',{status:403});
  await assert.rejects(resolveDesignerUser('bad','server-token'));
  globalThis.fetch=async()=>new Response('{"id":"user"}');
  await assert.rejects(resolveDesignerUser('bad','server-token'));
 }finally{globalThis.fetch=original;}
});
