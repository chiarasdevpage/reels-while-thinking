import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function validateConfig(c) {
  const integer = (key, min, max) => {
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max)
      throw new Error(`${key} must be an integer between ${min} and ${max}`);
  };
  integer('popouts', 1, 3);
  integer('width', 240, 3840); integer('height', 320, 2160);
  integer('left', -16000, 16000); integer('top', -16000, 16000);
  integer('gap', 0, 1000); integer('autoScrollIntervalMs', 1000, 3600000);
  integer('autoCloseDelayMs', 0, 3600000); integer('controlPort', 1024, 65535);
  for (const key of ['autoScroll', 'autoClose'])
    if (typeof c[key] !== 'boolean') throw new Error(`${key} must be true or false`);
  if (typeof c.browserPath !== 'string') throw new Error('browserPath must be a string');
  if (!['http:', 'https:'].includes(new URL(c.targetUrl).protocol)) throw new Error('targetUrl must be an HTTP(S) URL');
  const url = new URL(c.opencode.url);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('opencode.url must be a local HTTP origin, e.g. http://127.0.0.1:4096');
  if (typeof c.opencode.directory !== 'string') throw new Error('opencode.directory must be a string');
  for (const key of ['reconnectMs', 'reconcileMs'])
    if (!Number.isInteger(c.opencode[key]) || c.opencode[key] < 500 || c.opencode[key] > 60000)
      throw new Error(`opencode.${key} must be 500–60000 milliseconds`);
  return c;
}
export function loadConfig() { return validateConfig(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8').replace(/^\uFEFF/, ''))); }
