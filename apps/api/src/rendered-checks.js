import {safeRead} from './safe-http.js';
import {existsSync} from 'node:fs';

if(process.env.RENDER==='true'&&!process.env.PLAYWRIGHT_BROWSERS_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH='0';
export async function browserStatus(){
  try{const {chromium}=await import('playwright');return {enabled:process.env.ENABLE_RENDERED_CHECKS==='true',installed:existsSync(chromium.executablePath())};}
  catch{return {enabled:process.env.ENABLE_RENDERED_CHECKS==='true',installed:false};}
}

export async function isolatedPage(url, {enabled = process.env.ENABLE_RENDERED_CHECKS === 'true', read = safeRead, viewport={width:1280,height:800}, deviceScaleFactor=1, task} = {}) {
  if (!enabled) return {verified:false,error:'Isolated Chromium checks are not enabled on this backend'};
  let browser;
  let watchdog;
  try {
    const {chromium} = await import('playwright');
    browser = await chromium.launch({headless:true,timeout:10000,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
    watchdog=setTimeout(()=>{void browser.close().catch(()=>{});},18000);
    const context = await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport,deviceScaleFactor,isMobile:viewport.width<600,hasTouch:viewport.width<600});
    await context.addInitScript(()=>{Object.defineProperty(window,'RTCPeerConnection',{value:undefined,configurable:false});Object.defineProperty(window,'webkitRTCPeerConnection',{value:undefined,configurable:false});});
    let requests = 0;
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*',async route=>{
      try{
      const request=route.request();
      if(!['GET','HEAD'].includes(request.method())||++requests>40){await route.abort();return;}
      const response=await read(request.url(),{maxBytes:1000000,timeout:5000});
      if(!response.verified||!response.status){await route.abort();return;}
      await route.fulfill({status:response.status,contentType:response.contentType||'application/octet-stream',body:response.bytes});
      }catch{await route.abort().catch(()=>{});}
    });
    const page=await context.newPage();
    page.on('popup',popup=>{void popup.close();});
    await page.goto(url,{waitUntil:'load',timeout:12000});
    const result=await task(page);
    if(requests>40)return{verified:false,error:'Rendered request limit reached'};
    return{verified:true,...result};
  }catch(error){return{verified:false,error:'Rendered page could not be verified: '+error.message.split('\n')[0]};}
  finally{if(watchdog)clearTimeout(watchdog);if(browser)await browser.close();}
}

export async function inspectRendered(url, options = {}) {
  return isolatedPage(url,{...options,task:page=>page.evaluate(()=>({
      title:document.title.trim(),
      description:document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim()||'',
      h1:document.querySelectorAll('h1').length,
      images:Array.from(document.images).map(image=>({url:image.currentSrc||image.src,missingAlt:!image.hasAttribute('alt')&&image.getAttribute('role')!=='presentation'&&image.getAttribute('aria-hidden')!=='true',loaded:image.complete&&image.naturalWidth>0})),
    }))});
}
