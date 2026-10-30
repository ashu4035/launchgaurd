import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('Designer relaunch restores from verified identity without browser-stored credentials',async({context,page})=>{
 const sid='a'.repeat(64);let revoked=false,proof='fixture-proof',restores=0;
 await context.route('**/extension-test',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div><script src="/extension-bundle.js"></script></body></html>'}));
 const bundle=await readFile('apps/webflow-extension/public/bundle.js');
 await context.route('**/extension-bundle.js',route=>route.fulfill({contentType:'application/javascript',body:bundle}));
 await context.addInitScript(()=>{
  Object.assign(window,{webflow:{setExtensionSize:async()=>{},getSiteInfo:async()=>({siteId:'site-one',siteName:'Designer fixture'}),getIdToken:async()=> 'fixture-proof'}});
 });
 await context.route('https://launchgaurd.onrender.com/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const respond=(status:number,body:unknown)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/auth/designer'){
   restores++;expect(request.postDataJSON()).toEqual({idToken:'fixture-proof',siteId:'site-one'});
   return respond(!revoked&&proof==='fixture-proof'?200:401,!revoked&&proof==='fixture-proof'?{session:sid}:{error:'Connect Webflow'});
  }
  expect(request.headers().authorization).toBe('Bearer '+sid);
  if(path==='/api/disconnect'){revoked=true;return respond(200,{ok:true});}
  if(path==='/api/sites')return respond(200,{sites:[{id:'site-one',displayName:'Designer fixture'}]});
  if(path==='/api/scans')return respond(200,{scans:[]});
  if(path==='/api/session')return respond(200,{local:false});
  if(path==='/api/inventory')return respond(200,{pages:[],collections:[]});
  return respond(404,{error:'Unexpected fixture request'});
 });
 await page.goto('/extension-test');
 await expect(page.getByRole('button',{name:'Run audit',exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('button',{name:'Run audit',exact:true})).toBeVisible();
 const reopened=await context.newPage();await reopened.goto('/extension-test');
 await expect(reopened.getByRole('button',{name:'Run audit',exact:true})).toBeVisible();
 expect(restores).toBeGreaterThanOrEqual(3);
 expect(await reopened.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}))).toEqual({local:[],session:[]});
 await reopened.screenshot({path:'test-results/designer-session-restored.png'});
 await reopened.getByRole('button',{name:'Disconnect',exact:true}).click();
 await reopened.reload();
 await expect(reopened.getByRole('button',{name:'Connect Webflow',exact:true})).toBeVisible();
 revoked=false;proof='invalid';await page.reload();
 await expect(page.getByRole('button',{name:'Connect Webflow',exact:true})).toBeVisible();
});
