import {isolatedPage} from './rendered-checks.js';

export function visualTarget(finding) {
  if (['image-alt','image-loading','rendered-alt','rendered-image'].includes(finding.ruleId) && finding.resourceUrl) return {kind:'image',url:finding.resourceUrl,missingAlt:['image-alt','rendered-alt'].includes(finding.ruleId)};
  if (['internal-link','download-link'].includes(finding.ruleId) && finding.resourceUrl) return {kind:'link',url:finding.resourceUrl};
  if (['heading-h1','rendered-h1'].includes(finding.ruleId)) return {kind:'heading'};
  return null;
}

export async function captureVisualEvidence(url, findings, options = {}) {
  const results=new Map(findings.map(finding=>[finding.id,{captures:[],status:'Unavailable',reason:'No unique visible element can be mapped for this rule.'}]));
  const targets=findings.map(finding=>({id:finding.id,target:visualTarget(finding)})).filter(item=>item.target);
  if(!targets.length)return results;
  let bytes=0;
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    const rendered=await isolatedPage(url,{...options,viewport,task:async page=>{
      const captures=[];
      for(const {id,target} of targets){
        if(options.cancelled?.())break;
        const tag=target.kind==='image'?'img':target.kind==='link'?'a[href]':'h1';
        const indices=await page.locator(tag).evaluateAll((elements,target)=>elements.flatMap((element,index)=>{
          if(target.kind==='heading')return[index];
          const candidate=element.tagName==='IMG'?element.currentSrc||element.src:(element.tagName==='A'?element.href:'');
          if(candidate!==target.url)return[];
          if(target.missingAlt&&(element.hasAttribute('alt')||element.getAttribute('role')==='presentation'||element.getAttribute('aria-hidden')==='true'))return[];
          return[index];
        }),target);
        if(indices.length!==1){captures.push({id,reason:indices.length?'Multiple elements matched; no single location was assumed.':'The affected element was not found in the rendered page.'});continue;}
        const element=page.locator(tag).nth(indices[0]);
        if(!await element.isVisible()){captures.push({id,reason:'The element is not visible at this viewport.'});continue;}
        let previous;
        try{
          await element.scrollIntoViewIfNeeded({timeout:1500});
          const box=await element.boundingBox();
          if(!box||box.width<1||box.height<1)continue;
          previous=await element.getAttribute('style');
          await element.evaluate(el=>{el.style.setProperty('outline','3px solid #e02424','important');el.style.setProperty('outline-offset','3px','important');});
          const x=Math.max(0,Math.floor(box.x-24)),y=Math.max(0,Math.floor(box.y-24));
          const clip={x,y,width:Math.min(viewport.width-x,Math.ceil(box.width+48),700),height:Math.min(viewport.height-y,Math.ceil(box.height+48),400)};
          if(clip.width<1||clip.height<1)continue;
          const mask=[page.locator('input,textarea,[contenteditable="true"]')];
          const closeup=await page.screenshot({type:'jpeg',quality:55,clip,mask,timeout:2500});
          const context=await page.screenshot({type:'jpeg',quality:55,mask,timeout:2500});
          const size=closeup.length+context.length;
          if(size>400000||bytes+size>1000000){captures.push({id,reason:'Screenshot byte limit reached.'});continue;}
          bytes+=size;
          captures.push({id,capture:{viewport,capturedAt:new Date().toISOString(),pageUrl:url,closeup:'data:image/jpeg;base64,'+closeup.toString('base64'),context:'data:image/jpeg;base64,'+context.toString('base64'),bounds:{x:box.x,y:box.y,width:box.width,height:box.height}}});
        }catch{captures.push({id,reason:'The element moved or could not be captured within the time limit.'});}
        finally{if(previous!==undefined)await element.evaluate((el,style)=>{if(style===null)el.removeAttribute('style');else el.setAttribute('style',style);},previous).catch(()=>{});}
      }
      return {captures};
    }});
    if(!rendered.verified){for(const result of results.values())result.reason=rendered.error;continue;}
    for(const item of rendered.captures){const result=results.get(item.id);if(item.capture){result.captures.push(item.capture);result.status='Captured';delete result.reason;}else if(!result.captures.length)result.reason=item.reason;}
  }
  return results;
}
