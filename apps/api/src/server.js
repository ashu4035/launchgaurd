import http from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStorage} from './storage.js';
import {runAudit} from './audit-runner.js';
import {PUBLISHED_CHECKS} from './published-audit.js';
import {designerSession} from './designer-session.js';
import {browserStatus} from './rendered-checks.js';
const PORT=Number(process.env.PORT||8787), DB=resolve(process.env.LAUNCHGUARD_DB||'./data/launchguard.json');
const production=process.env.NODE_ENV==='production';
const browserRuntime=await browserStatus();
const CLIENT_ID=process.env.WEBFLOW_CLIENT_ID,CLIENT_SECRET=process.env.WEBFLOW_CLIENT_SECRET,BASE=(process.env.PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL||`http://localhost:${PORT}`).replace(/\/$/,'');
const storage=await openStorage({file:DB,databaseUrl:process.env.DATABASE_URL,encryptionKey:process.env.TOKEN_ENCRYPTION_KEY,production});
let db=storage.data;
const frontend=production?BASE:(process.env.FRONTEND_ORIGIN||'http://localhost:5173');
const publicDir=fileURLToPath(new URL('../../designer/dist/',import.meta.url));
let saving=Promise.resolve();
const persist=()=>{saving=saving.catch(()=>{}).then(async()=>{const sessions=Object.fromEntries(Object.entries(db.sessions).filter(([id])=>id!=='local-development'));await storage.save({...db,sessions})});return saving};
const origins=new Set((process.env.ALLOWED_ORIGINS||(production?'':'http://localhost:5173,http://localhost:5174,http://localhost:1337')).split(',').map(x=>x.trim()).filter(Boolean).concat(new URL(BASE).origin,new URL(frontend).origin));
const identityEnabled=process.env.WEBFLOW_IDENTITY_ENABLED==='true', identityRequests=new Map();
const json=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...(res.allowedOrigin?{'Access-Control-Allow-Origin':res.allowedOrigin,'Vary':'Origin'}:{}),'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});res.end(JSON.stringify(obj))};
const readBody=async(req)=>{let s='';for await(const part of req){s+=part;if(s.length>100000)throw Error('Body too large')}return JSON.parse(s||'{}')};
const api=async(path,token)=>{for(let attempt=0;attempt<3;attempt++){const r=await fetch('https://api.webflow.com/v2'+path,{signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'accept-version':'2.0.0'}});if(r.ok)return r.json();if((r.status===429||r.status>=500)&&attempt<2){const seconds=Math.min(10,Math.max(1,Number(r.headers.get('retry-after'))||2**attempt));await new Promise(done=>setTimeout(done,seconds*1000));continue;}throw Error(`Webflow API ${r.status} for ${path}`)}};
const all=async(path,key,token)=>{let offset=0,out=[];while(true){const join=path.includes('?')?'&':'?';const result=await api(`${path}${join}limit=100&offset=${offset}`,token);const rows=result[key]||[];out.push(...rows);if(out.length>=10000&&(rows.length===100||result.pagination?.total>out.length))throw Error('Inventory limit reached; this scan cannot claim full coverage');if(rows.length<100||(result.pagination?.total!==undefined&&out.length>=result.pagination.total))break;offset+=rows.length;}return out};
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
const localToken=process.env.NODE_ENV!=='production'&&process.env.WEBFLOW_SITE_API_TOKEN;
const sessionId=req=>localToken?'local-development':(req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]||cookies(req).lg_session);
delete db.sessions['local-development'];
if(localToken)db.sessions['local-development']={token:localToken,created:Date.now()};
const auth=req=>{const session=db.sessions[sessionId(req)];return session&&(sessionId(req)==='local-development'||Date.now()-session.created<604800000)?session:null};
if(storage.ready){let recovered=false;for(const job of Object.values(db.scans)){if(['queued','running'].includes(job.status)){job.status=job.cancelled?'cancelled':(job.attempts||0)>=3?'failed':'queued';job.error=job.status==='failed'?'Scan interrupted too many times; run a new audit.':undefined;recovered=true;}}if(recovered)await persist();}
let queueRunning=false;
async function scan(id){
const job=db.scans[id],session=db.sessions[job.sessionId];
if(!session){job.status='failed';job.error='Session expired';await persist();return;}
job.status='running';job.attempts=(job.attempts||0)+1;await persist();
try{
await runAudit(job,{api,all,persist,token:session.token});
job.status=job.cancelled?'cancelled':job.partial?'partial':'complete';
job.finishedAt=new Date().toISOString();await persist();
}catch(error){job.status='failed';job.error=String(error.message||error);await persist();}
}
async function drainQueue(){
if(queueRunning)return;queueRunning=true;
try{let next;while((next=Object.values(db.scans).find(job=>job.status==='queued')))await scan(next.id);}
catch(error){console.error('Audit queue stopped:',error.message);}
finally{queueRunning=false;}
}
const server=http.createServer(async(req,res)=>{try{if(req.headers.origin){if(!origins.has(req.headers.origin))return json(res,403,{error:'Origin not allowed'});res.allowedOrigin=req.headers.origin;}const url=new URL(req.url,BASE),p=url.pathname;if(req.method==='OPTIONS')return json(res,204,{});
if(p==='/health')return json(res,200,{ok:true,version:'0.4.1',storageReady:storage.ready,features:{visualEvidence:true,designerIdentity:identityEnabled},browser:browserRuntime,commit:process.env.RENDER_GIT_COMMIT?.slice(0,7)});
if(req.method==='GET'&&(p==='/'||p.startsWith('/assets/'))){
const path=resolve(publicDir,p==='/'?'index.html':'.'+p);
if(!path.startsWith(resolve(publicDir)+sep))return json(res,404,{error:'Not found'});
try{const content=await readFile(path);const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Cache-Control':p==='/'?'no-cache':'public, max-age=31536000, immutable'});return res.end(content)}catch{return json(res,404,{error:'Dashboard not built; run npm run build'})}
}
if(p==='/auth/designer'&&req.method==='POST'){
if(!storage.ready||!identityEnabled)return json(res,503,{error:'Automatic connection requires WEBFLOW_IDENTITY_ENABLED=true and Authorized User: Read permission.'});
if(!req.headers.origin||!origins.has(req.headers.origin))return json(res,403,{error:'Extension origin required'});
const now=Date.now();for(const [key,value]of identityRequests)if(now-value.started>60000)identityRequests.delete(key);
const address=req.socket.remoteAddress,rate=identityRequests.get(address)||{started:now,count:0};
if(rate.count>=30)return json(res,429,{error:'Too many connection attempts; try again in a minute.'});
rate.count++;identityRequests.set(address,rate);
const body=await readBody(req),sid=auth(req)?sessionId(req):undefined;
try{const restored=await designerSession({sessions:db.sessions,sid,idToken:body.idToken,siteId:body.siteId,sites:token=>all('/sites','sites',token),persist});
return restored?json(res,200,restored):json(res,401,{error:'Connect Webflow once to enable automatic connection for this user and site.'});
}catch{return json(res,401,{error:'Webflow identity verification failed. Enable Authorized User: Read and reconnect once.'});}
}
if(p==='/auth/start'&&req.method==='GET'){
if(!storage.ready)return json(res,503,{error:'Configure DATABASE_URL and TOKEN_ENCRYPTION_KEY in Render first'});
if(!CLIENT_ID||!CLIENT_SECRET)return json(res,503,{error:'OAuth environment variables are not configured'});
if(production&&!BASE.startsWith('https://'))return json(res,503,{error:'PUBLIC_BASE_URL must use HTTPS'});
const clientOrigin=url.searchParams.get('client_origin');
if(clientOrigin&&!origins.has(clientOrigin))return json(res,400,{error:'Extension origin is not allowed'});
const state=randomBytes(24).toString('hex');
for(const [key,value] of Object.entries(db.states))if(Date.now()-value.created>600000)delete db.states[key];
const returnTo=url.searchParams.get('return_to');
db.states[state]={created:Date.now(),browserHash:createHash('sha256').update(state).digest('hex'),clientOrigin,returnTo:/^\/\?report=[a-f0-9]{48}$/.test(returnTo||'')?returnTo:''};
await persist();
const params=new URLSearchParams({response_type:'code',client_id:CLIENT_ID,redirect_uri:BASE+'/auth/callback',state,scope:'sites:read cms:read pages:read'+(identityEnabled?' authorized_user:read':'')});
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
res.writeHead(302,{'Set-Cookie':[cookie,clear],Location:frontend+(saved.returnTo||'')});return res.end();
}
if(p.startsWith('/api/')&&!storage.ready)return json(res,503,{error:'Persistent storage is not configured. Set DATABASE_URL and TOKEN_ENCRYPTION_KEY in Render.'});
const session=auth(req);if(!session)return json(res,401,{error:'Connect Webflow to continue'});
if(p==='/api/session')return json(res,200,{local:!!localToken});
if(p==='/api/inventory'&&req.method==='GET'){
const siteId=url.searchParams.get('siteId');const sites=await all('/sites','sites',session.token);if(!sites.some(site=>site.id===siteId))return json(res,403,{error:'Unauthorized site'});
const pages=await all(`/sites/${siteId}/pages`,'pages',session.token);
const collections=await all(`/sites/${siteId}/collections`,'collections',session.token);const detailed=[];let itemCount=0;
for(const collection of collections){const detail=await api(`/collections/${collection.id}`,session.token);const items=await all(`/collections/${collection.id}/items`,'items',session.token);itemCount+=items.length;if(itemCount>2000)return json(res,413,{error:'Inventory contains over 2,000 CMS items; narrow the site inventory before using item selection'});detailed.push({...detail,items:items.map(item=>({id:item.id,name:item.fieldData?.name||item.fieldData?.slug||item.id,slug:item.fieldData?.slug,locale:item.cmsLocaleId,isDraft:item.isDraft,isArchived:item.isArchived}))});}
return json(res,200,{pages:pages.map(page=>({id:page.id,name:page.title||page.slug||'Home',locale:page.localeId,draft:page.draft,archived:page.archived,publishedPath:page.publishedPath,collectionId:page.collectionId})),collections:detailed});
}
const shareRead=p.match(/^\/api\/reports\/([a-f0-9]{48})$/);
if(shareRead&&req.method==='GET'){
const share=db.shares?.[shareRead[1]];if(!share||share.revoked||Date.now()>share.expiresAt)return json(res,404,{error:'Report link expired or was revoked'});
const job=db.scans[share.scanId];if(!job)return json(res,404,{error:'Report unavailable'});
const sites=await all('/sites','sites',session.token);if(!sites.some(site=>site.id===job.siteId))return json(res,403,{error:'Authorize this Webflow site to access the report'});
const {sessionId:privateSession,rules:privateRules,policy:privatePolicy,...report}=job;
const cleanUrl=value=>{if(!value)return value;try{const url=new URL(value);url.search='';url.hash='';return url.href;}catch{return undefined;}};
report.findings=job.findings.filter(f=>!f.isDraft&&!f.isArchived).map(({observed,expected,visualEvidence,...finding})=>({...finding,url:cleanUrl(finding.url),resourceUrl:cleanUrl(finding.resourceUrl),affectedUrls:finding.affectedUrls?.map(cleanUrl),...(visualEvidence?{visualEvidence:{status:'Unavailable',reason:'Screenshots are available only to the audit owner.',captures:[]}}:{})}));
return json(res,200,{scan:report,shared:true});
}
const shareManage=p.match(/^\/api\/scans\/([a-f0-9-]+)\/share$/);
if(shareManage&&req.method==='POST'){
const job=db.scans[shareManage[1]];if(!job||job.sessionId!==sessionId(req))return json(res,404,{error:'Not found'});
if(!['complete','partial','cancelled','failed'].includes(job.status))return json(res,409,{error:'Wait for this scan to finish before sharing'});
const body=await readBody(req);db.shares??={};
if(body.revoke){for(const share of Object.values(db.shares))if(share.scanId===job.id)share.revoked=true;await persist();return json(res,200,{revoked:true});}
const id=randomBytes(24).toString('hex');const expiresAt=Date.now()+Math.min(7,Math.max(1,Number(body.days)||7))*86400000;
db.shares[id]={scanId:job.id,expiresAt,createdAt:Date.now(),revoked:false};await persist();return json(res,201,{url:BASE+'/?report='+id,expiresAt});
}
if(p==='/api/disconnect'&&req.method==='POST'){delete db.sessions[sessionId(req)];await persist();res.setHeader('Set-Cookie','lg_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');return json(res,200,{ok:true})}
if(p==='/api/sites'){return json(res,200,{sites:await all('/sites','sites',session.token)})}
if(p==='/api/collections'){const siteId=url.searchParams.get('siteId');if(!siteId)return json(res,400,{error:'siteId required'});const sites=await all('/sites','sites',session.token);if(!sites.some(s=>s.id===siteId))return json(res,403,{error:'Unauthorized site'});const collections=await all(`/sites/${siteId}/collections`,'collections',session.token);const detailed=[];for(const collection of collections)detailed.push(await api(`/collections/${collection.id}`,session.token));return json(res,200,{collections:detailed})}
if(p==='/api/scans'&&req.method==='GET')return json(res,200,{scans:Object.values(db.scans).filter(x=>x.sessionId===sessionId(req)).map(({id,siteId,siteName,environment,status,createdAt,progress,findings,error,coverage,partial})=>({id,siteId,siteName,environment,status,createdAt,progress,issues:findings.filter(f=>f.status==='Issue').length,warnings:findings.filter(f=>f.status==='Warning').length,unverified:findings.filter(f=>f.status==='Could not verify').length,error,coverage,partial})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
if(p==='/api/scans'&&req.method==='POST'){
const body=await readBody(req);
if(body.recheckScanId){const previous=db.scans[body.recheckScanId];if(!previous||previous.sessionId!==sessionId(req))return json(res,404,{error:'Previous audit not found'});body.siteId=previous.siteId;body.environment=previous.environment;body.checks=previous.checks;body.rules=previous.rules;body.policy=previous.policy;body.scope=previous.scope;
if(body.findingId){const finding=previous.findings.find(f=>f.id===body.findingId);if(!finding)return json(res,404,{error:'Finding not found'});if(finding.itemId)body.scope={collectionIds:[finding.collectionId],itemIds:[finding.itemId],skipPages:true};else if(finding.pageId)body.scope={pageIds:[finding.pageId],skipCMS:true};else if(finding.url)body.scope={publishedUrls:[finding.url],skipCMS:true};}}
if(!body.siteId||typeof body.siteId!=='string')return json(res,400,{error:'siteId required'});
const sites=await all('/sites','sites',session.token);if(!sites.some(s=>s.id===body.siteId))return json(res,403,{error:'Unauthorized site'});
const active=Object.values(db.scans).find(job=>job.sessionId===sessionId(req)&&['queued','running'].includes(job.status));if(active)return json(res,409,{error:'An audit is already running',scanId:active.id});
const allowedChecks=new Set(['SEO metadata','CMS assets',...PUBLISHED_CHECKS]);
if(!Array.isArray(body.checks)||body.checks.some(check=>!allowedChecks.has(check)))return json(res,400,{error:'Unknown audit check'});
if(body.checks.includes('Visual evidence')&&!body.checks.some(check=>PUBLISHED_CHECKS.includes(check)&&check!=='Visual evidence'))return json(res,400,{error:'Select a published-content check along with Visual evidence.'});
if(body.environment!==undefined&&!['Live','Staging'].includes(body.environment))return json(res,400,{error:'Invalid environment'});
const validIds=value=>Array.isArray(value)&&value.length<=2000&&value.every(id=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(id));
const scope=body.scope||{};if(typeof scope!=='object'||Array.isArray(scope))return json(res,400,{error:'Invalid selected scope'});for(const key of ['pageIds','collectionIds','itemIds'])if(scope[key]!==undefined&&!validIds(scope[key]))return json(res,400,{error:'Invalid selected scope'});for(const key of ['skipPages','skipCMS'])if(scope[key]!==undefined&&typeof scope[key]!=='boolean')return json(res,400,{error:'Invalid selected scope'});
const rules=Array.isArray(body.rules)?body.rules:[];if(rules.length>100||rules.some(rule=>!rule||typeof rule.collectionId!=='string'||typeof rule.fieldSlug!=='string'||rule.fieldSlug.length>100))return json(res,400,{error:'Invalid CMS field rules'});
const policy={stagingNoindex:body.policy?.stagingNoindex!==false,contacts:Array.isArray(body.policy?.contacts)?body.policy.contacts.filter(value=>typeof value==='string'&&value.length<=200).slice(0,10):[]};
if(body.checks.includes('Contact details')&&!policy.contacts.length)return json(res,400,{error:'Configure at least one contact text value or deselect Contact details'});
if(!body.checks.length&&!rules.length)return json(res,400,{error:'Select at least one check or CMS field'});
const id=randomUUID();db.scans[id]={id,sessionId:sessionId(req),siteId:body.siteId,environment:body.environment==='Live'?'Live':'Staging',rules,checks:body.checks,scope,policy,limits:{pages:Math.min(100,Math.max(1,Number(body.limits?.pages)||50)),requests:300},createdAt:new Date().toISOString(),status:'queued',attempts:0,progress:{},findings:[]};await persist();void drainQueue();return json(res,202,{id,status:'queued'});
}
const match=p.match(/^\/api\/scans\/([a-f0-9-]+)(\/cancel)?$/);if(match){const job=db.scans[match[1]];if(!job||job.sessionId!==sessionId(req))return json(res,404,{error:'Not found'});if(match[2]&&req.method==='POST'){job.cancelled=true;if(job.status==='queued')job.status='cancelled';await persist();return json(res,200,{cancelled:true})}const {sessionId:privateSession,...report}=job;return json(res,200,{scan:report})}
return json(res,404,{error:'Not found'});
}catch(e){return json(res,500,{error:String(e.message||e)})}});
server.listen(PORT,process.env.HOST||'127.0.0.1',()=>{console.log(`LaunchGuard API listening on ${PORT}`);void drainQueue();});
