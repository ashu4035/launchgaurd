import http from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStorage} from './storage.js';
import {checkRequiredField} from '../../../packages/checks/src/rules.js';
const PORT=Number(process.env.PORT||8787), DB=resolve(process.env.LAUNCHGUARD_DB||'./data/launchguard.json');
const production=process.env.NODE_ENV==='production';
const CLIENT_ID=process.env.WEBFLOW_CLIENT_ID,CLIENT_SECRET=process.env.WEBFLOW_CLIENT_SECRET,BASE=(process.env.PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL||`http://localhost:${PORT}`).replace(/\/$/,'');
const storage=await openStorage({file:DB,databaseUrl:process.env.DATABASE_URL,encryptionKey:process.env.TOKEN_ENCRYPTION_KEY,production});
let db=storage.data;
const frontend=production?BASE:(process.env.FRONTEND_ORIGIN||'http://localhost:5173');
const publicDir=fileURLToPath(new URL('../../designer/dist/',import.meta.url));
let saving=Promise.resolve();
const persist=()=>{saving=saving.catch(()=>{}).then(async()=>{const sessions=Object.fromEntries(Object.entries(db.sessions).filter(([id])=>id!=='local-development'));await storage.save({...db,sessions})});return saving};
const origins=new Set((process.env.ALLOWED_ORIGINS||(production?'':'http://localhost:5173,http://localhost:5174,http://localhost:1337')).split(',').map(x=>x.trim()).filter(Boolean).concat(new URL(BASE).origin,new URL(frontend).origin));
const json=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...(res.allowedOrigin?{'Access-Control-Allow-Origin':res.allowedOrigin,'Vary':'Origin'}:{}),'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});res.end(JSON.stringify(obj))};
const readBody=async(req)=>{let s='';for await(const part of req){s+=part;if(s.length>100000)throw Error('Body too large')}return JSON.parse(s||'{}')};
const api=async(path,token)=>{const r=await fetch('https://api.webflow.com/v2'+path,{headers:{Authorization:`Bearer ${token}`,'accept-version':'2.0.0'}});if(!r.ok)throw Error(`Webflow API ${r.status} for ${path}`);return r.json()};
const all=async(path,key,token)=>{let offset=0,out=[];while(true){const join=path.includes('?')?'&':'?';const result=await api(`${path}${join}limit=100&offset=${offset}`,token);const rows=result[key]||[];out.push(...rows);if(rows.length<100||out.length>=10000)break;offset+=rows.length;}return out};
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
const localToken=process.env.NODE_ENV!=='production'&&process.env.WEBFLOW_SITE_API_TOKEN;
const sessionId=req=>localToken?'local-development':(req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]||cookies(req).lg_session);
delete db.sessions['local-development'];
if(localToken)db.sessions['local-development']={token:localToken,created:Date.now()};
const auth=req=>{const session=db.sessions[sessionId(req)];return session&&(sessionId(req)==='local-development'||Date.now()-session.created<604800000)?session:null};
const finding=(rule,props)=>({id:randomUUID(),ruleId:rule,status:'Issue',severity:'Medium',...props});
if(storage.ready){let recovered=false;for(const job of Object.values(db.scans)){if(['queued','running'].includes(job.status)){job.status='failed';job.error='The server restarted during this scan. Run a new audit.';recovered=true;}}if(recovered)await persist();}
async function scan(id){const job=db.scans[id],session=db.sessions[job.sessionId];if(!session){job.status='failed';job.error='Session expired';await persist();return}job.status='running';await persist();try{
const sites=await all('/sites','sites',session.token);if(!sites.some(s=>s.id===job.siteId))throw Error('Site access revoked');
const collections=await all(`/sites/${job.siteId}/collections`,'collections',session.token);job.progress={collections:collections.length,items:0,pages:0};await persist();
for(const col of collections){if(job.cancelled)break;const items=await all(`/collections/${col.id}/items`,'items',session.token);for(const item of items){job.progress.items++;for(const field of job.rules.filter(r=>r.collectionId===col.id&&r.required)){const result=checkRequiredField(item,field.fieldSlug,true);if(result.status==='issue')job.findings.push(finding('required-field',{source:'CMS',collection:col.displayName,item:item.fieldData?.name||item.slug,field:field.fieldSlug,itemId:item.id,collectionId:col.id,title:`Required ${field.fieldSlug} is empty`,detail:'Configured CMS field has no saved value',fix:`Open CMS → ${col.displayName} → ${item.fieldData?.name||item.slug}, complete ${field.fieldSlug}, and save.`}))}}await persist()}
const pages=await all(`/sites/${job.siteId}/pages`,'pages',session.token);
job.pageResults=[];
for(const page of pages){
if(job.cancelled)break;
job.progress.pages++;
const result={pageId:page.id,name:page.title||page.slug||'Untitled page',status:'skipped',issues:0,detail:''};
if(page.draft||page.archived)result.detail='Draft or archived page';
else if(!job.checks.includes('SEO metadata'))result.detail='Page SEO settings check was not selected';
else {
const before=job.findings.length;
if(!page.seo?.title)job.findings.push(finding('missing-title',{source:'Page',page:result.name,pageId:page.id,title:'Page SEO title is missing',detail:'Webflow page SEO title is empty (published fallback not verified)',fix:'Review page SEO settings and rendered title.'}));
if(!page.seo?.description)job.findings.push(finding('missing-description',{source:'Page',page:result.name,pageId:page.id,title:'Page SEO description is missing',detail:'Webflow page SEO description is empty (template fallback not verified)',fix:'Review page SEO settings and rendered description.'}));
result.issues=job.findings.length-before;
result.status=result.issues?'issues':'passed';
result.detail=result.issues?'Review the missing SEO settings below':'SEO title and description are present';
}
job.pageResults.push(result);
await persist();
}
job.status=job.cancelled?'cancelled':'complete';job.finishedAt=new Date().toISOString();await persist();
}catch(e){job.status='failed';job.error=String(e.message||e);await persist()}}
const server=http.createServer(async(req,res)=>{try{if(req.headers.origin){if(!origins.has(req.headers.origin))return json(res,403,{error:'Origin not allowed'});res.allowedOrigin=req.headers.origin;}const url=new URL(req.url,BASE),p=url.pathname;if(req.method==='OPTIONS')return json(res,204,{});
if(p==='/health')return json(res,200,{ok:true,version:'0.3.0',storageReady:storage.ready});
if(req.method==='GET'&&(p==='/'||p.startsWith('/assets/'))){
const path=resolve(publicDir,p==='/'?'index.html':'.'+p);
if(!path.startsWith(resolve(publicDir)+sep))return json(res,404,{error:'Not found'});
try{const content=await readFile(path);const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Cache-Control':p==='/'?'no-cache':'public, max-age=31536000, immutable'});return res.end(content)}catch{return json(res,404,{error:'Dashboard not built; run npm run build'})}
}
if(p==='/auth/start'&&req.method==='GET'){
if(!storage.ready)return json(res,503,{error:'Configure DATABASE_URL and TOKEN_ENCRYPTION_KEY in Render first'});
if(!CLIENT_ID||!CLIENT_SECRET)return json(res,503,{error:'OAuth environment variables are not configured'});
if(production&&!BASE.startsWith('https://'))return json(res,503,{error:'PUBLIC_BASE_URL must use HTTPS'});
const clientOrigin=url.searchParams.get('client_origin');
if(clientOrigin&&!origins.has(clientOrigin))return json(res,400,{error:'Extension origin is not allowed'});
const state=randomBytes(24).toString('hex');
for(const [key,value] of Object.entries(db.states))if(Date.now()-value.created>600000)delete db.states[key];
db.states[state]={created:Date.now(),browserHash:createHash('sha256').update(state).digest('hex'),clientOrigin};
await persist();
const params=new URLSearchParams({response_type:'code',client_id:CLIENT_ID,redirect_uri:BASE+'/auth/callback',state,scope:'sites:read cms:read pages:read'});
res.writeHead(302,{'Set-Cookie':'lg_oauth_state='+state+'; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600'+(BASE.startsWith('https:')?'; Secure':''),Location:'https://webflow.com/oauth/authorize?'+params});return res.end();
}
if(p==='/auth/callback'&&req.method==='GET'){
const state=url.searchParams.get('state'),saved=db.states[state];
if(!saved||Date.now()-saved.created>600000||saved.browserHash!==createHash('sha256').update(cookies(req).lg_oauth_state||'').digest('hex'))return json(res,400,{error:'Invalid OAuth state. Start a new connection from LaunchGuard.'});
delete db.states[state];await persist();
if(url.searchParams.has('error'))return json(res,400,{error:'Webflow authorization was declined. You can try connecting again.'});
const code=url.searchParams.get('code');if(!code)return json(res,400,{error:'Missing code'});
const response=await fetch('https://api.webflow.com/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:CLIENT_ID,client_secret:CLIENT_SECRET,code,grant_type:'authorization_code',redirect_uri:BASE+'/auth/callback'})});
if(!response.ok)throw Error('OAuth token exchange failed');
const data=await response.json();if(typeof data.access_token!=='string')throw Error('OAuth token exchange returned no token');
const sid=randomBytes(32).toString('hex');
db.sessions[sid]={token:data.access_token,created:Date.now()};await persist();
const cookie=`lg_session=${sid}; HttpOnly; SameSite=Lax; Path=/; ${BASE.startsWith('https:')?'Secure; ':''}Max-Age=604800`;
const clear='lg_oauth_state=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0'+(BASE.startsWith('https:')?'; Secure':'');
if(saved.clientOrigin){
const nonce=randomBytes(16).toString('hex');
const target=JSON.stringify(saved.clientOrigin).replace(/</g,'\\u003c');
res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':[cookie,clear],'Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`});
return res.end(`<!doctype html><html><head><title>LaunchGuard connected</title></head><body><h1>Webflow connected</h1><p>Return to LaunchGuard in Designer.</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage({type:'launchguard-connected',session:'${sid}'},${target});window.close();}</script></body></html>`);
}
res.writeHead(302,{'Set-Cookie':[cookie,clear],Location:frontend});return res.end();
}
if(p.startsWith('/api/')&&!storage.ready)return json(res,503,{error:'Persistent storage is not configured. Set DATABASE_URL and TOKEN_ENCRYPTION_KEY in Render.'});
const session=auth(req);if(!session)return json(res,401,{error:'Connect Webflow to continue'});
if(p==='/api/disconnect'&&req.method==='POST'){delete db.sessions[sessionId(req)];await persist();res.setHeader('Set-Cookie','lg_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');return json(res,200,{ok:true})}
if(p==='/api/sites'){return json(res,200,{sites:await all('/sites','sites',session.token)})}
if(p==='/api/collections'){const siteId=url.searchParams.get('siteId');if(!siteId)return json(res,400,{error:'siteId required'});const sites=await all('/sites','sites',session.token);if(!sites.some(s=>s.id===siteId))return json(res,403,{error:'Unauthorized site'});const collections=await all(`/sites/${siteId}/collections`,'collections',session.token);const detailed=[];for(const collection of collections)detailed.push(await api(`/collections/${collection.id}`,session.token));return json(res,200,{collections:detailed})}
if(p==='/api/scans'&&req.method==='GET')return json(res,200,{scans:Object.values(db.scans).filter(x=>x.sessionId===sessionId(req)).map(({id,siteId,status,createdAt,progress,findings,error})=>({id,siteId,status,createdAt,progress,issues:findings.length,error}))});
if(p==='/api/scans'&&req.method==='POST'){const body=await readBody(req);if(!body.siteId||typeof body.siteId!=='string')return json(res,400,{error:'siteId required'});const sites=await all('/sites','sites',session.token);if(!sites.some(s=>s.id===body.siteId))return json(res,403,{error:'Unauthorized site'});const id=randomUUID();db.scans[id]={id,sessionId:sessionId(req),siteId:body.siteId,environment:body.environment==='Live'?'Live':'Staging',rules:Array.isArray(body.rules)?body.rules.slice(0,100):[],checks:Array.isArray(body.checks)?body.checks:[],createdAt:new Date().toISOString(),status:'queued',progress:{},findings:[]};await persist();void scan(id);return json(res,202,{id,status:'queued'})}
const match=p.match(/^\/api\/scans\/([a-f0-9-]+)(\/cancel)?$/);if(match){const job=db.scans[match[1]];if(!job||job.sessionId!==sessionId(req))return json(res,404,{error:'Not found'});if(match[2]&&req.method==='POST'){job.cancelled=true;await persist();return json(res,200,{cancelled:true})}return json(res,200,{scan:job})}
return json(res,404,{error:'Not found'});
}catch(e){return json(res,500,{error:String(e.message||e)})}});
server.listen(PORT,process.env.HOST||'127.0.0.1',()=>console.log(`LaunchGuard API listening on ${PORT}`));
