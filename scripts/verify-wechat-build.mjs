import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_BYTES = 3.5 * 1024 * 1024;

function sizeOf(root) {
  return readdirSync(root).reduce((total, name) => {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return total + sizeOf(path);
    return name.endsWith('.map') ? total : total + stat.size;
  }, 0);
}

export function verifyWechatBuild(root) {
  for (const name of ['game.json', 'project.config.json', 'game.js']) {
    if (!existsSync(join(root, name))) throw new Error(`missing ${name}`);
  }
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  const project = JSON.parse(readFileSync(join(root, 'project.config.json'), 'utf8'));
  if (game.deviceOrientation !== 'portrait') throw new Error('build must be portrait');
  if (typeof project.appid !== 'string' || project.appid.length === 0) {
    throw new Error('build must contain appid');
  }
  const packageBytes = sizeOf(root);
  if (packageBytes > TARGET_BYTES) throw new Error('build exceeds 3.5 MB target');
  return { packageBytes, appid: project.appid };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(verifyWechatBuild(process.argv[2] ?? 'build/wechatgame')));
}
