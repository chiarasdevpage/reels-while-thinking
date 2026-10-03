import { loadConfig } from './config.js';
console.log(new URL(loadConfig().opencode.url).port || '80');
