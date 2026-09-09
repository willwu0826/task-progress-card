import { promises as fs } from 'node:fs';
import { readCard, createCard, updateCard } from './card.mjs';

const usage = `用法：
  node src/cli.mjs read <状态卡.md>
  node src/cli.mjs init <状态卡.md> <初始化数据.json>
  node src/cli.mjs update <状态卡.md> <expectedRevision> <动作.json>

所有路径可使用绝对路径。更新前读取最新 revision；冲突时重新读取再决定，禁止盲目重试覆盖。`;

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('输入文件不是有效 JSON。');
    throw error;
  }
}

try {
  const [command, file, third, fourth, ...extra] = process.argv.slice(2);
  let result;
  if (command === '--help' || command === '-h' || command === undefined) {
    process.stdout.write(`${usage}\n`);
  } else if (command === 'read' && file && third === undefined) {
    result = await readCard(file);
  } else if (command === 'init' && file && third && fourth === undefined) {
    result = await createCard(file, await readJson(third));
  } else if (command === 'update' && file && /^(0|[1-9]\d*)$/.test(third ?? '') && fourth && !extra.length) {
    result = await updateCard(file, Number(third), await readJson(fourth));
  } else {
    throw new Error(usage);
  }
  if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
  process.exitCode = 1;
}
