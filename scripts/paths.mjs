import fs from 'node:fs/promises';
import path from 'node:path';

export function dataHome(value=process.env.PROGRESS_CARD_HOME) {
  if(!value || !path.isAbsolute(value)) throw Error('Set PROGRESS_CARD_HOME to an authorized absolute data directory. No default project is inferred.');
  return path.resolve(value);
}
export function registryFile() { return path.join(dataHome(),'registry.json'); }
export function servicePort(value=process.env.PROGRESS_CARD_PORT || 43128) {
  const port=Number(value);
  if(!Number.isInteger(port)||port<1024||port>65535) throw Error('Invalid port: use 1024–65535.');
  return port;
}
export async function readRegistry(file=registryFile()) {
  const result=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
  if(!Array.isArray(result.entries)||!result.active||typeof result.active!=='object'||Array.isArray(result.active)) throw Error('Invalid registry.');
  if(new Set(result.entries.map(e=>e.id)).size!==result.entries.length) throw Error('登记表存在重复记录ID');
  return result;
}
