import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

// Keep local builds unchanged; opt in through the existing server setting.
if(process.env.ENABLE_RENDERED_CHECKS!=='true'){
  console.log('Chromium install skipped: ENABLE_RENDERED_CHECKS is not true.');
}else{
  if(process.env.RENDER==='true'&&!process.env.PLAYWRIGHT_BROWSERS_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH='0';
  const require=createRequire(import.meta.url);
  const manifest=require.resolve('playwright/package.json');
  const cli=resolve(dirname(manifest),JSON.parse(readFileSync(manifest,'utf8')).bin.playwright);
  const result=spawnSync(process.execPath,[cli,'install','chromium'],{stdio:'inherit',env:process.env,timeout:180000});
  if(result.error||result.status!==0){
    console.error('Chromium installation failed. Check the build network and browser runtime setup.');
    process.exitCode=1;
  }
}
