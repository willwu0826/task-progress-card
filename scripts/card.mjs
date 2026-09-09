import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const STATUSES = new Set(['READY', 'RUNNING', 'REVIEW', 'BLOCKED', 'DONE']);
const JSON_BLOCK = /^```json[ \t]*\r?\n([\s\S]*?)^```[ \t]*(?:\r?\n|$)/gm;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('CARD_INVALID', `${name} 必须是非空文本。`);
  }
  return value.trim();
}

function textList(value, name) {
  if (!Array.isArray(value)) fail('CARD_INVALID', `${name} 必须是文本数组。`);
  value.forEach((item) => requiredText(item, name));
}

function validate(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    fail('CARD_INVALID', '状态卡必须是 JSON 对象。');
  }
  if (card.schemaVersion !== 1) fail('CARD_INVALID', '不支持的状态卡版本。');
  for (const key of ['id', 'title', 'threadId', 'goal', 'mainlineStepId']) {
    requiredText(card[key], key);
  }
  if (!STATUSES.has(card.status)) fail('CARD_INVALID', '状态值不在约定范围内。');
  if (!Number.isSafeInteger(card.revision) || card.revision < 0) {
    fail('CARD_INVALID', 'revision 必须是非负安全整数。');
  }
  if (typeof card.updatedAt !== 'string' || !Number.isFinite(Date.parse(card.updatedAt))) {
    fail('CARD_INVALID', 'updatedAt 必须是有效日期。');
  }
  if (!Array.isArray(card.steps) || !card.steps.length) {
    fail('CARD_INVALID', '至少需要一个主线步骤。');
  }
  const stepIds = new Set();
  for (const step of card.steps) {
    requiredText(step?.id, 'step.id');
    requiredText(step?.title, 'step.title');
    if (stepIds.has(step.id)) fail('CARD_INVALID', '主线步骤 id 不能重复。');
    stepIds.add(step.id);
    if (typeof step.done !== 'boolean') fail('CARD_INVALID', 'step.done 必须是布尔值。');
    if (step.evidence !== undefined) requiredText(step.evidence, 'step.evidence');
  }
  if (!stepIds.has(card.mainlineStepId)) fail('CARD_INVALID', '主线位置必须指向实际步骤。');
  if (card.steps.some((step) => !step.done)
    && card.steps.find((step) => step.id === card.mainlineStepId).done) {
    fail('CARD_INVALID', '尚有未完成步骤时，主线位置不能停在已完成步骤。');
  }
  if (typeof card.currentAction !== 'string' || typeof card.nextAction !== 'string') {
    fail('CARD_INVALID', 'currentAction 和 nextAction 必须是文本。');
  }
  if (!Array.isArray(card.detours)) fail('CARD_INVALID', 'detours 必须是数组。');
  const detourIds = new Set();
  for (let index = 0; index < card.detours.length; index += 1) {
    const detour = card.detours[index];
    for (const key of ['id', 'title', 'reason', 'doneWhen']) {
      requiredText(detour?.[key], `detour.${key}`);
    }
    if (detourIds.has(detour.id)) fail('CARD_INVALID', '当前回补 id 不能重复。');
    detourIds.add(detour.id);
    const expected = index === 0
      ? { kind: 'step', id: card.mainlineStepId }
      : { kind: 'detour', id: card.detours[index - 1].id };
    if (detour.returnTo?.kind !== expected.kind || detour.returnTo?.id !== expected.id) {
      fail('CARD_INVALID', '回补返回点与主线或上层回补不一致。');
    }
  }
  textList(card.acceptance, 'acceptance');
  textList(card.evidence, 'evidence');
  if (!Array.isArray(card.history)) fail('CARD_INVALID', 'history 必须是数组。');
  for (const event of card.history) {
    if (!event || typeof event !== 'object' || Array.isArray(event)
      || typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at))
      || !Number.isSafeInteger(event.revision) || event.revision < 0
      || event.revision > card.revision) {
      fail('CARD_INVALID', '历史事件格式无效。');
    }
    requiredText(event.action, 'history.action');
  }
  const budget = card.budget;
  if (!budget || !['total', 'used', 'remaining'].every((key) => Number.isSafeInteger(budget[key]) && budget[key] >= 0)
    || budget.total !== budget.used + budget.remaining) {
    fail('CARD_INVALID', 'Agent 预算必须是非负整数且总额等于已用加剩余。');
  }
  if (card.status === 'DONE'
    && (card.steps.some((step) => !step.done) || card.detours.length || !card.evidence.length)) {
    fail('CARD_INVALID', 'DONE 必须有完成证据、所有主线步骤完成且没有未解回补。');
  }
  return card;
}

function parseDocument(source) {
  const blocks = [...source.matchAll(JSON_BLOCK)];
  if (blocks.length !== 1) fail('CARD_INVALID', '状态卡必须恰有一个 json 代码块。');
  let card;
  try {
    card = JSON.parse(blocks[0][1]);
  } catch {
    fail('CARD_INVALID', '状态卡中的 JSON 无法解析；原文件未修改。');
  }
  validate(card);
  return { card, block: blocks[0] };
}

function renderBlock(card, newline = '\n') {
  return ['```json', JSON.stringify(card, null, 2).replaceAll('\n', newline), '```', ''].join(newline);
}

function replaceBlock(source, block, card) {
  const newline = block[0].includes('\r\n') ? '\r\n' : '\n';
  const end = block.index + block[0].length;
  const trailingNewline = /\r?\n$/.test(block[0]);
  let rendered = renderBlock(card, newline);
  if (!trailingNewline) rendered = rendered.slice(0, -newline.length);
  return source.slice(0, block.index) + rendered + source.slice(end);
}

async function withLock(file, callback) {
  const lockPath = `${file}.lock`;
  const token = randomUUID();
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      fail('CARD_LOCKED', '状态卡正在被另一写入操作使用。稍后重新读取版本再更新；持续存在时先核实锁的归属。');
    }
    throw error;
  }
  try {
    await lock.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }));
    return await callback();
  } finally {
    await lock.close();
    // 仅释放本次创建的锁，不清理其他进程新建的锁或遗留文件。
    try {
      const owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      if (owner.token === token) await fs.unlink(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function atomicWrite(file, source, original) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx');
  try {
    await handle.writeFile(source, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (original !== undefined) {
    const current = await fs.readFile(file, 'utf8');
    if (current !== original) {
      fail('CARD_CONFLICT', `状态卡被外部编辑，已保留原文及待写入文件 ${path.basename(temporary)}。请重新读取后处理。`);
    }
  }
  // 同目录原子替换；写入或替换失败时保留原文件和临时文件以便检查。
  await fs.rename(temporary, file);
}

/** 只读取单一 Markdown 状态卡的权威 JSON 块，不写入或修复。 */
export async function readCard(file) {
  return parseDocument(await fs.readFile(file, 'utf8')).card;
}

/** 初始化新卡；已有文件绝不覆盖。revision 从 0 开始。 */
export async function createCard(file, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('CARD_INVALID', '初始化数据必须是对象。');
  if (data.revision !== undefined && data.revision !== 0) fail('CARD_INVALID', '新卡 revision 必须从 0 开始。');
  const now = new Date().toISOString();
  const steps = structuredClone(data.steps ?? []);
  const card = validate({
    schemaVersion: 1,
    id: data.id ?? randomUUID(),
    title: data.title,
    threadId: data.threadId,
    goal: data.goal,
    status: data.status ?? 'READY',
    revision: 0,
    updatedAt: now,
    steps,
    mainlineStepId: data.mainlineStepId ?? steps.find((step) => !step.done)?.id ?? steps.at(-1)?.id,
    currentAction: data.currentAction ?? '',
    detours: structuredClone(data.detours ?? []),
    nextAction: data.nextAction ?? '',
    acceptance: structuredClone(data.acceptance ?? []),
    evidence: structuredClone(data.evidence ?? []),
    history: [{ at: now, action: 'create', revision: 0, details: { source: 'explicit-init' } }],
    budget: structuredClone(data.budget ?? { total: 0, used: 0, remaining: 0 }),
  });
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  return withLock(file, async () => {
    try {
      await fs.access(file);
      fail('CARD_EXISTS', '状态卡已存在，初始化不会覆盖它。');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const source = '# 唯一任务状态卡\n\n当前状态以本文件唯一 JSON 块为准。历史事件保留在同一卡内；其他界面只读取此处。\n\n' + renderBlock(card);
    // 用硬链接提交新文件，避免覆盖未采用本锁的外部新文件。
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, 'wx');
    try {
      await handle.writeFile(source, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, file);
    } catch (error) {
      if (error.code === 'EEXIST') fail('CARD_EXISTS', '另一操作已创建状态卡；未覆盖，临时文件保留。');
      throw error;
    }
    await fs.unlink(temporary);
    return card;
  });
}

/** 单次有版本约束的事务；拒绝陈旧版本、并发写入和无证据结案。 */
export async function updateCard(file, expectedRevision, action) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    fail('CARD_INVALID', 'expectedRevision 必须是非负安全整数。');
  }
  if (!action || typeof action !== 'object' || Array.isArray(action)) fail('CARD_INVALID', 'action 必须是对象。');
  return withLock(file, async () => {
    const source = await fs.readFile(file, 'utf8');
    const { card, block } = parseDocument(source);
    if (card.revision !== expectedRevision) {
      fail('CARD_CONFLICT', `版本冲突：请求 ${expectedRevision}，当前 ${card.revision}。请重新读取，不要覆盖新状态。`);
    }
    if (card.status === 'DONE') fail('CARD_CLOSED', '已完结卡保持原记录；后续新任务请使用新卡。');
    const originalAction = card.currentAction;
    const originalNextAction = card.nextAction;
    const originalStatus = card.status;
    let details;
    const addEvidence = (value) => {
      const evidence = requiredText(value, 'evidence');
      if (!card.evidence.includes(evidence)) card.evidence.push(evidence);
      return evidence;
    };
    switch (action.type) {
      case 'setAction': {
        card.currentAction = requiredText(action.text, 'text');
        if (action.nextAction !== undefined) card.nextAction = requiredText(action.nextAction, 'nextAction');
        if (card.status === 'READY') card.status = 'RUNNING';
        details = { text: card.currentAction, nextAction: card.nextAction };
        break;
      }
      case 'startDetour': {
        const id = requiredText(action.id, 'id');
        if (card.detours.some((detour) => detour.id === id)) fail('CARD_INVALID', '该回补 id 已在当前回补栈内。');
        const top = card.detours.at(-1);
        const detour = {
          id,
          title: requiredText(action.title, 'title'),
          reason: requiredText(action.reason, 'reason'),
          doneWhen: requiredText(action.doneWhen, 'doneWhen'),
          returnTo: top ? { kind: 'detour', id: top.id } : { kind: 'step', id: card.mainlineStepId },
        };
        card.detours.push(detour);
        card.currentAction = detour.title;
        card.nextAction = detour.doneWhen;
        card.status = 'RUNNING';
        details = { detour, previousAction: originalAction, previousNextAction: originalNextAction, previousStatus: originalStatus };
        break;
      }
      case 'reviseDetour': {
        const detour=card.detours.at(-1);
        if(!detour || detour.id!==action.id)fail('CARD_INVALID','只能纠正当前最内层回补，不能改变返回点。');
        const previous=structuredClone(detour);
        detour.title=requiredText(action.title,'title');
        detour.reason=requiredText(action.reason,'reason');
        detour.doneWhen=requiredText(action.doneWhen,'doneWhen');
        card.currentAction=detour.title;
        card.nextAction=detour.doneWhen;
        details={previous,detour:structuredClone(detour),reason:requiredText(action.correction,'correction')};
        break;
      }
      case 'finishDetour': {
        if (!card.detours.length) fail('CARD_INVALID', '没有可以结束的回补。');
        const evidence = addEvidence(action.evidence);
        const finished = card.detours.pop();
        const started = card.history.findLast((event) => event.action === 'startDetour' && event.details?.detour?.id === finished.id);
        const target = card.detours.at(-1) ?? card.steps.find((step) => step.id === card.mainlineStepId);
        card.currentAction = started?.details?.previousAction || target.title;
        card.nextAction = started?.details?.previousNextAction ?? '';
        card.status = started?.details?.previousStatus
          ?? (card.steps.every((step) => step.done) && !card.detours.length ? 'REVIEW' : 'RUNNING');
        details = { detourId: finished.id, evidence, returnedTo: finished.returnTo };
        break;
      }
      case 'advance': {
        if (card.detours.length) fail('CARD_INVALID', '请先有证据地结束当前回补，再推进主线。');
        const step = card.steps.find((item) => item.id === card.mainlineStepId);
        if (step.done) fail('CARD_INVALID', '全部主线已完成；核对验收后使用 complete 结案。');
        const evidence = addEvidence(action.evidence);
        step.done = true;
        step.evidence = evidence;
        const next = card.steps.find((item) => !item.done);
        if (next) {
          card.mainlineStepId = next.id;
          card.currentAction = next.title;
          card.nextAction = '';
          card.status = 'RUNNING';
        } else {
          card.currentAction = '全部主线步骤已完成，正在核对验收。';
          card.nextAction = '依据验收证据决定是否结案。';
          card.status = 'REVIEW';
        }
        details = { stepId: step.id, evidence, nextStepId: next?.id ?? null };
        break;
      }
      case 'invalidate': {
        if (card.detours.length) {
          fail('CARD_INVALID', '请先记录回补结论并结束当前回补，再明确重定受影响的主线。');
        }
        const stepId = requiredText(action.stepId, 'stepId');
        const reason = requiredText(action.reason, 'reason');
        const index = card.steps.findIndex((step) => step.id === stepId);
        if (index < 0) fail('CARD_INVALID', '撤销验收的目标步骤不存在。');
        const invalidatedSteps = structuredClone(card.steps.slice(index));
        const previousEvidence = new Set(invalidatedSteps.map((step) => step.evidence).filter(Boolean));
        const unaffectedEvidence = new Set(card.steps.slice(0, index).map((step) => step.evidence).filter(Boolean));
        const removedEvidence = card.evidence.filter((evidence) => previousEvidence.has(evidence) && !unaffectedEvidence.has(evidence));
        const removed = new Set(removedEvidence);
        card.evidence = card.evidence.filter((evidence) => !removed.has(evidence));
        for (const step of card.steps.slice(index)) {
          step.done = false;
          delete step.evidence;
        }
        details = { reason, fromStepId: card.mainlineStepId, stepId, invalidatedSteps, removedEvidence };
        card.mainlineStepId = stepId;
        card.status = 'RUNNING';
        card.currentAction = `重新验收“${card.steps[index].title}”：${reason}`;
        card.nextAction = '重新核对该步骤及后续受影响步骤，以新证据推进主线。';
        break;
      }
      case 'setStatus': {
        if (!STATUSES.has(action.status) || action.status === 'DONE') {
          fail('CARD_INVALID', 'setStatus 仅接受 READY / RUNNING / REVIEW / BLOCKED；结案必须使用 complete。');
        }
        details = { from: card.status, to: action.status };
        card.status = action.status;
        break;
      }
      case 'complete': {
        if (card.detours.length) fail('CARD_INVALID', '尚有未解回补，不能结案。');
        if (card.steps.some((step) => !step.done)) fail('CARD_INVALID', '尚有未完成主线步骤，不能结案。');
        const evidence = addEvidence(action.evidence);
        card.status = 'DONE';
        card.currentAction = '任务已完成。';
        card.nextAction = '无需你操作。';
        details = { evidence };
        break;
      }
      default:
        fail('CARD_INVALID', `未知 action.type：${String(action.type)}。`);
    }
    card.revision += 1;
    card.updatedAt = new Date().toISOString();
    card.history.push({ at: card.updatedAt, action: action.type, revision: card.revision, details });
    validate(card);
    await atomicWrite(file, replaceBlock(source, block, card), source);
    return card;
  });
}
