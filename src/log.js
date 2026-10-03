import fs from 'node:fs';
import path from 'node:path';
export function makeLogger(root) {
  const dir = path.join(root, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'reels.log');
  return (event, fields = {}) => {
    const line = JSON.stringify({ time: new Date().toISOString(), event, ...fields });
    console.log(line);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, `${line}\n`);
    } catch (error) { console.error(`Log write failed: ${error.message}`); }
  };
}
