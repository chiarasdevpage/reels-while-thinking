import fs from 'node:fs';
import path from 'node:path';
import { platforms } from './platforms.js';

export const defaults = Object.freeze({ platform: 'instagram', idleBehavior: 'pause' });
export function validateSettings(value, partial = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be an object');
  for (const key of Object.keys(value)) if (!Object.hasOwn(defaults, key)) throw new Error('Unknown setting: ' + key);
  if ((!partial || 'platform' in value) && !Object.hasOwn(platforms, value.platform)) throw new Error('Invalid platform');
  if ((!partial || 'idleBehavior' in value) && !['pause', 'close'].includes(value.idleBehavior)) throw new Error('Invalid idle behavior');
  return value;
}
export class SettingsStore {
  constructor(root, log = () => {}) {
    this.file = path.join(root, 'runtime', 'settings.json');
    this.log = log;
  }
  load() {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')); }
    catch (error) { this.log('settings.defaults', { message: error.message }); return { ...defaults }; }
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      try { validateSettings({ [key]: raw?.[key] }, true); result[key] = raw[key]; }
      catch { this.log('settings.default', { key }); }
    }
    return result;
  }
  save(settings) {
    validateSettings(settings);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      fs.renameSync(temporary, this.file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
}
