import {test,expect} from '@playwright/test';
import {inspectRendered} from '../../apps/api/src/rendered-checks.js';
test('isolated rendered checks inspect dynamic DOM and disable network transports',async()=>{
 const result=await inspectRendered('https://fixture.example/',{enabled:true,read:async()=>({verified:true,status:200,contentType:'text/html',bytes:Buffer.from('<html><head><title>Dynamic</title><meta name="description" content="Description"></head><body><script>document.body.insertAdjacentHTML("beforeend","<h1>Dynamic heading</h1>");if(window.RTCPeerConnection)document.body.insertAdjacentHTML("beforeend","<h1>Unsafe transport</h1>");</script></body></html>')})});
 expect(result.verified).toBe(true);expect(result.h1).toBe(1);expect(result.title).toBe('Dynamic');
});
for(const viewport of [{width:800,height:600},{width:320,height:460}]) {
 test('audit, search, details and history at '+viewport.width+'px',async({page})=>{
  await page.setViewportSize(viewport);await page.goto('/');
  await expect(page.getByRole('button',{name:'Run audit',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Run audit',exact:true}).click();
  await expect(page.getByText('Partial coverage.',{exact:false})).toBeVisible({timeout:15000});
  await page.getByRole('textbox',{name:'Search findings'}).fill('Services');
  await expect(page.getByText('1 matching findings')).toBeVisible();
  await page.getByRole('button',{name:/Summary is empty/}).click();
  await expect(page.getByRole('dialog',{name:'Issue details'})).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Empty',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close issue details',exact:true}).click();
  await page.getByRole('button',{name:'History',exact:true}).click();
  await expect(page.locator('.audit-history').first()).toBeVisible();
  await page.locator('.audit-history').first().click();
  await expect(page.getByRole('heading',{name:'Test site',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/audit-'+viewport.width+'.png',fullPage:true});
 });
}
