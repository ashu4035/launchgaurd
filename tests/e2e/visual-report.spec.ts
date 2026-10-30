import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {captureVisualEvidence} from '../../apps/api/src/visual-evidence.js';
import {exportVisualReport,reportArea} from '../../packages/ui/VisualReport';
import type {Finding} from '../../packages/ui/AuditApp';

const url='https://visual-fixture.example/';
const finding:Finding={id:'visual-fixture',ruleId:'image-alt',severity:'Medium',status:'Issue',source:'Page',page:'Team',url,resourceUrl:url+'logo.svg',title:'Image has no alt attribute',detail:'The published logo image has no alt attribute.',fix:'Add a meaningful alternative description or mark the image decorative.',environment:'Staging'};
const read=async(address:string)=>({verified:true,status:200,url:address,contentType:address.endsWith('.svg')?'image/svg+xml':'text/html',bytes:Buffer.from(address.endsWith('.svg')?'<svg xmlns="http://www.w3.org/2000/svg" width="170" height="54"><rect width="170" height="54" fill="#167e69"/><text x="12" y="34" fill="white" font-size="22">Fixture logo</text></svg>':'<html><head><title>Team</title></head><body style="font-family:Arial;padding:24px;background:white;color:#123"><img src="/logo.svg" width="170" height="54"><h1>Our team</h1><p>A controlled browser fixture, not a customer audit.</p><input value="Private field"><a href="/duplicate">One</a><a href="/duplicate">Two</a></body></html>')});

test('captures real desktop/mobile red annotations, rejects ambiguous targets, and exports inert HTML',async({page})=>{
 const evidence=await captureVisualEvidence(url,[finding,{...finding,id:'duplicate',ruleId:'internal-link',resourceUrl:url+'duplicate'}],{enabled:true,read});
 const captured=evidence.get(finding.id)!;
 expect(captured.status,captured.reason).toBe('Captured');expect(captured.captures).toHaveLength(2);
 expect(evidence.get('duplicate')!.captures).toHaveLength(0);
 expect(evidence.get('duplicate')!.reason).toContain('Multiple elements');
 finding.visualEvidence=captured;
 expect(reportArea(finding)).toBe('Accessibility');
 const html=exportVisualReport({siteName:'Fixture <script>window.injected=true</script>',environment:'Staging',status:'complete',createdAt:'2026-10-28T00:00:00Z',findings:[finding]});
 await page.setContent(html);
 await expect(page.getByRole('heading',{name:'Defects by area'})).toBeVisible();
 expect(await page.locator('script').count()).toBe(0);
 const image=page.getByAltText('Page viewport showing the affected element outlined in red').first();
 await expect(image).toBeVisible();
 const pixels=await image.evaluate(async(element:HTMLImageElement)=>{
  await element.decode();const canvas=document.createElement('canvas');canvas.width=element.naturalWidth;canvas.height=element.naturalHeight;
  const context=canvas.getContext('2d')!;context.drawImage(element,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;let red=0;
  for(let i=0;i<data.length;i+=4)if(data[i]>170&&data[i+1]<100&&data[i+2]<100)red++;
  return{red,width:canvas.width,height:canvas.height};
 });
 expect(pixels.width).toBe(1440);expect(pixels.height).toBe(900);expect(pixels.red).toBeGreaterThan(30);
 const preview=exportVisualReport({siteName:'Controlled test site (fixture)',environment:'Staging',status:'complete',createdAt:'2026-10-28T00:00:00Z',findings:[finding]});
 await writeFile('test-results/visual-report-fixture.html',preview);
 await page.setContent(preview);
 await page.screenshot({path:'test-results/visual-report-export.png',fullPage:true});
});

for(const width of [800,320])test('visual report view and self-contained download at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:900});
 const fixture={id:'report-fixture',siteId:'site-one',siteName:'Test site',environment:'Staging',status:'complete',createdAt:'2026-10-28T00:00:00Z',findings:[finding]};
 await page.route('**/api/scans',route=>route.fulfill({json:{scans:[{...fixture,issues:1}]}}));
 await page.route('**/api/scans/report-fixture',route=>route.fulfill({json:{scan:fixture}}));
 await page.goto('/');await page.getByRole('button',{name:'History',exact:true}).click();
 await page.locator('.audit-history').first().click();
 await page.getByRole('button',{name:'Visual report',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Defects by area'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'What is wrong'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Why it matters'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download visual HTML report'}).click();
 expect((await download).suggestedFilename()).toMatch(/\.html$/);
 await page.screenshot({path:'test-results/visual-report-'+width+'.png',fullPage:true});
});

test('disabled Chromium gives an explicit unavailable reason, never fake screenshots',async()=>{
 const result=await captureVisualEvidence(url,[finding],{enabled:false,read});
 expect(result.get(finding.id)!.captures).toHaveLength(0);
 expect(result.get(finding.id)!.reason).toContain('not enabled');
});
