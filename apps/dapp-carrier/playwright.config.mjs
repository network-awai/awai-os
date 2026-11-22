import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'test/browser',use:{baseURL:'http://127.0.0.1:4179'},webServer:{command:'node scripts/serve-test.mjs',url:'http://127.0.0.1:4179/yataverse/',reuseExistingServer:false}});
