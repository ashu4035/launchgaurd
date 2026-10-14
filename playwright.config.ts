import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
  testDir:'tests/e2e', workers:1, fullyParallel:false,
  use:{baseURL:'http://127.0.0.1:18884',browserName:'chromium',trace:'retain-on-failure'},
  webServer:{command:'node --import ./tests/webflow-mock.mjs apps/api/src/server.js',url:'http://127.0.0.1:18884/health',reuseExistingServer:false,env:{PORT:'18884',HOST:'127.0.0.1',NODE_ENV:'test',DATABASE_URL:'',WEBFLOW_SITE_API_TOKEN:'e2e-fixture',PUBLIC_BASE_URL:'http://127.0.0.1:18884',FRONTEND_ORIGIN:'http://127.0.0.1:18884',LAUNCHGUARD_DB:resolve('test-results/e2e-state.json')}},
});
