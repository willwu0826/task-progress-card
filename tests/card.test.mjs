import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readCard, createCard, updateCard } from '../scripts/card.mjs';

const testRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '.runs', `run-${Date.now()}-${process.pid}`);
await fs.mkdir(testRoot, { recursive: true });
const seed = (id = 'example') => ({
  id, title: '验证主线与回补', threadId: 'thread-example', goal: '第三步回补第一步后准确返回',
  steps: [{ id: 's1', title: '补齐材料', done: false }, { id: 's2', title: '形成方案', done: false }, { id: 's3', title: '执行与验收', done: false }],
  mainlineStepId: 's1', acceptance: ['主线位置不受临时回补覆盖'],
});
const rejectsCode = (code) => (error) => error.code === code;
const cardFile = (name) => path.join(testRoot, `${name}.md`);

test('第三步回补第一步，多层回补和进程重启均保持准确返回位置', async () => {
  const file = cardFile('detour-recovery');
  let card = await createCard(file, seed());
  card = await updateCard(file, card.revision, { type: 'advance', evidence: '第一步材料已核对' });
  card = await updateCard(file, card.revision, { type: 'advance', evidence: '第二步方案已通过' });
  card = await updateCard(file, card.revision, { type: 'setAction', text: '第三步正在执行渲染验收', nextAction: '核对实际输出' });
  const original = { action: card.currentAction, next: card.nextAction, steps: structuredClone(card.steps) };
  card = await updateCard(file, card.revision, { type: 'startDetour', id: 'fix-material', title: '回第一步补材料', reason: '第三步发现来源缺口', doneWhen: '缺失来源查证完毕' });
  assert.equal(card.mainlineStepId, 's3');
  assert.deepEqual(card.steps, original.steps);
  assert.deepEqual(card.detours[0].returnTo, { kind: 'step', id: 's3' });
  card = await updateCard(file, card.revision, { type: 'startDetour', id: 'fix-link', title: '修复引用地址', reason: '补材料时来源地址失效', doneWhen: '地址打开且证据一致' });
  assert.deepEqual(card.detours[1].returnTo, { kind: 'detour', id: 'fix-material' });
  const restarted = spawnSync(process.execPath, [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/cli.mjs'), 'read', file], { encoding: 'utf8' });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), card);
  card = await updateCard(file, card.revision, { type: 'finishDetour', evidence: '引用地址及原文一致' });
  assert.equal(card.currentAction, '回第一步补材料');
  assert.equal(card.detours.length, 1);
  card = await updateCard(file, card.revision, { type: 'finishDetour', evidence: '缺失材料已补齐，第三步可续接' });
  assert.equal(card.mainlineStepId, 's3');
  assert.equal(card.currentAction, original.action);
  assert.equal(card.nextAction, original.next);
  assert.deepEqual(card.steps, original.steps);
  assert.deepEqual((await readCard(file)).detours, []);
});

test('未完成、未解回补、没有证据、直接改 DONE 均不能误报结案', async () => {
  const file = cardFile('completion-gates');
  let card = await createCard(file, seed());
  await assert.rejects(updateCard(file, card.revision, { type: 'complete', evidence: 'AI 本轮停止输出' }), rejectsCode('CARD_INVALID'));
  await assert.rejects(updateCard(file, card.revision, { type: 'setStatus', status: 'DONE' }), rejectsCode('CARD_INVALID'));
  await assert.rejects(updateCard(file, card.revision, { type: 'advance', evidence: '' }), rejectsCode('CARD_INVALID'));
  for (const step of card.steps) card = await updateCard(file, card.revision, { type: 'advance', evidence: `${step.id} 验收通过` });
  assert.equal(card.status, 'REVIEW');
  await assert.rejects(updateCard(file, card.revision, { type: 'complete' }), rejectsCode('CARD_INVALID'));
  card = await updateCard(file, card.revision, { type: 'startDetour', id: 'quality-check', title: '补验收证据', reason: '最后核对发现证据不足', doneWhen: '补充可复核结果' });
  await assert.rejects(updateCard(file, card.revision, { type: 'advance', evidence: '跳过回补' }), rejectsCode('CARD_INVALID'));
  await assert.rejects(updateCard(file, card.revision, { type: 'complete', evidence: '尚未补齐' }), rejectsCode('CARD_INVALID'));
  await assert.rejects(updateCard(file, card.revision, { type: 'finishDetour', evidence: ' ' }), rejectsCode('CARD_INVALID'));
  card = await updateCard(file, card.revision, { type: 'finishDetour', evidence: '缺失验收记录已取得' });
  assert.equal(card.status, 'REVIEW');
  card = await updateCard(file, card.revision, { type: 'complete', evidence: '全部业务验收与交付路径已核对' });
  assert.equal(card.status, 'DONE');
  assert.equal(card.history.at(-1).action, 'complete');
  const original = await fs.readFile(file, 'utf8');
  await assert.rejects(updateCard(file, card.revision, { type: 'setAction', text: '把旧项目重新变为当前任务' }), rejectsCode('CARD_CLOSED'));
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('陈旧版本与真实并发写入不能覆盖另一操作', async () => {
  const file = cardFile('concurrent-writers');
  await createCard(file, seed());
  const results = await Promise.allSettled([
    updateCard(file, 0, { type: 'setAction', text: '写入者 A' }),
    updateCard(file, 0, { type: 'setAction', text: '写入者 B' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(['CARD_LOCKED', 'CARD_CONFLICT'].includes(rejected.reason.code));
  const committed = await fs.readFile(file, 'utf8');
  await assert.rejects(updateCard(file, 0, { type: 'setAction', text: '陈旧更新' }), rejectsCode('CARD_CONFLICT'));
  assert.equal(await fs.readFile(file, 'utf8'), committed);
  assert.equal((await readCard(file)).revision, 1);
  await assert.rejects(updateCard(file, '1', { type: 'setAction', text: '非法版本类型' }), rejectsCode('CARD_INVALID'));
});

test('更新保留 JSON 块外文档；无效输入与现存初始化不损坏原文', async () => {
  const file = cardFile('preserve-source');
  const card = await createCard(file, seed());
  const contents = (await fs.readFile(file, 'utf8')).replaceAll('\n', '\r\n');
  const prefix = '\ufeff---\r\nowner: 用户\r\n---\r\n';
  const suffix = '\r\n## 原始记录\r\n这一段独有原文必须保留。\r\n';
  await fs.writeFile(file, prefix + contents + suffix, 'utf8');
  await updateCard(file, card.revision, { type: 'setAction', text: '继续已授权工作' });
  const saved = await fs.readFile(file, 'utf8');
  assert.ok(saved.startsWith(prefix));
  assert.ok(saved.endsWith(suffix));
  assert.ok(!saved.replaceAll('\r\n', '').includes('\n'));
  await assert.rejects(createCard(file, seed('different')), rejectsCode('CARD_EXISTS'));
  await assert.rejects(updateCard(file, 1, { type: 'unrecognized' }), rejectsCode('CARD_INVALID'));
  assert.equal(await fs.readFile(file, 'utf8'), saved);
});

test('来源块歧义与回补返回点损坏会显式拒绝读取或更新', async () => {
  const file = cardFile('invalid-block');
  await createCard(file, seed());
  const source = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, source + '\n```json\n{}\n```\n', 'utf8');
  await assert.rejects(readCard(file), rejectsCode('CARD_INVALID'));
  const badSeed = { ...seed(), detours: [{ id: 'bad', title: '回补', reason: '校验失败情况', doneWhen: '核对完成', returnTo: { kind: 'step', id: 's2' } }] };
  await assert.rejects(createCard(cardFile('invalid-return'), badSeed), rejectsCode('CARD_INVALID'));
});

test('回补推翻旧验收时显式撤销受影响步骤，保留历史证据而不冒充现行证据', async () => {
  const file = cardFile('invalidate-accepted-steps');
  let card = await createCard(file, seed());
  card = await updateCard(file, card.revision, { type: 'advance', evidence: 's1 原验收证据' });
  card = await updateCard(file, card.revision, { type: 'advance', evidence: 's2 原验收证据' });
  card = await updateCard(file, card.revision, { type: 'startDetour', id: 'source-error', title: '复查第一步来源', reason: '来源可能错误', doneWhen: '确认来源是否影响结论' });
  await assert.rejects(updateCard(file, card.revision, { type: 'invalidate', stepId: 's1', reason: '旧来源失效' }), rejectsCode('CARD_INVALID'));
  card = await updateCard(file, card.revision, { type: 'finishDetour', evidence: '确认旧来源失效，影响第一步及后续结论' });
  assert.equal(card.mainlineStepId, 's3');
  card = await updateCard(file, card.revision, { type: 'invalidate', stepId: 's1', reason: '回补查明旧来源失效，原验收需要重做' });
  assert.equal(card.mainlineStepId, 's1');
  assert.equal(card.status, 'RUNNING');
  assert.ok(card.steps.every((step) => !step.done && step.evidence === undefined));
  assert.ok(!card.evidence.includes('s1 原验收证据'));
  assert.ok(!card.evidence.includes('s2 原验收证据'));
  const event = card.history.at(-1);
  assert.equal(event.action, 'invalidate');
  assert.equal(event.details.fromStepId, 's3');
  assert.equal(event.details.invalidatedSteps[0].evidence, 's1 原验收证据');
  assert.equal(event.details.invalidatedSteps[1].evidence, 's2 原验收证据');
  assert.deepEqual(event.details.removedEvidence, ['s1 原验收证据', 's2 原验收证据']);
  assert.ok(card.history.some((item) => item.action === 'advance' && item.details.evidence === 's1 原验收证据'));
  assert.deepEqual(await readCard(file), card);
});

test('CLI 初始化、带版本更新和只读恢复可单独进程执行', async () => {
  const file = cardFile('cli-flow');
  const seedFile = path.join(testRoot, 'cli-seed.json');
  const actionFile = path.join(testRoot, 'cli-action.json');
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/cli.mjs');
  await fs.writeFile(seedFile, JSON.stringify(seed('cli-flow')), 'utf8');
  await fs.writeFile(actionFile, JSON.stringify({ type: 'setAction', text: 'CLI 持久化动作' }), 'utf8');
  for (const args of [['init', file, seedFile], ['update', file, '0', actionFile], ['read', file]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).id, 'cli-flow');
  }
  assert.equal((await readCard(file)).currentAction, 'CLI 持久化动作');
  const stale = spawnSync(process.execPath, [cli, 'update', file, '0', actionFile], { encoding: 'utf8' });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /CARD_CONFLICT/);
});
