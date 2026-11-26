// Fake runners only: no model calls, real chats, or user workspace mutations.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { WorkflowManager } from '../workflows.mjs';

const root = fs.mkdtempSync('D:/ChatGPT-Temp/ccboard-workflows-20261125/engine-tests-');
const operator = { outcome: 'completed', summary: '已完成假任务', evidence: ['fixture check passed'], blockers: [] };
const reviewer = { verdict: 'pass', summary: '独立检查通过', evidence: ['independent fixture check'], findings: [] };
const changes = { verdict: 'changes_requested', summary: '需要修正', evidence: ['fixture check failed'], findings: ['修正假边界条件'] };
const summarizer = { summary: '最终汇总', evidence: ['操作与检查记录'], limitations: [] };
const planner = { summary: '先比较方案再操作', questions: ['偏好哪个方案？'], steps: ['只读检查', '等待确认'], risks: ['有待验证的假设'] };
const facts = [{ kind: 'real_environment', detail: 'Synthetic runner evidence for engine tests only', reference: null }];
const lead = { outcome: 'completed', summary: '假专业阶段完成', evidence: facts, blockers: [] };
const delegate = role => ({ decision: 'delegate', role, task: '假委派任务', summary: '委派', evidence: [], blockers: [] });
const complete = { decision: 'complete', role: null, task: '', summary: '假任务已验收', evidence: facts, blockers: [] };
let passed = 0;
function manager(name, implementation, options = {}) {
  return new WorkflowManager({ file: path.join(root, name + '.json'), runStage: async args => {
    const identity = { threadId: args.resumeThreadId || crypto.randomUUID(), turnId: crypto.randomUUID(), model: args.model || 'fixture-default' };
    args.onIdentity(identity); args.fixtureIdentity = identity;
    return implementation ? implementation(args) : ({ operator, reviewer, summarizer, planner }[args.role]);
  }, resolveChiefModel: async () => ({ model: 'fixture-chief', effort: 'high', reason: 'synthetic resolver' }), verifySource: async () => true, ...options });
}
function testReceipt(args) {
  const id = 'receipt-' + args.fixtureIdentity.threadId;
  args.onEvidence({ id, kind: 'isolated', command: 'synthetic meaningful test command', exitCode: 0, output: 'synthetic result', status: 'completed', cwd: root,
    manifestHash: crypto.createHash('sha256').update('[]').digest('hex'), sourceManifest: [], validationFiles: { files: [], complete: true, limitations: [] }, limitations: ['Synthetic engine test'], ...args.fixtureIdentity });
  return id;
}
const input = (mode = 'once', more = {}) => ({ prompt: '只执行测试夹具任务', cwd: root, mode, requestId: crypto.randomUUID(), ...more });
async function settled(m, id) {
  for (let i = 0; i < 300; i++) {
    const job = m.get(id);
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('fixture did not settle');
}
async function test(label, fn) { await fn(); passed++; console.log('ok ' + label); }
await test('refresh continues interrupted coding without repeating chief; duplicate clicks are idempotent', async () => {
  let coding = 0, chiefs = 0;
  const m = manager('resume', args => {
    if (args.role === 'chief') { chiefs++; return chiefs === 1 ? delegate('coding') : { decision: 'needs_input', role: null, task: '', summary: 'Fixture pause after continuation', evidence: [], blockers: ['fixture stop'] }; }
    if (args.role === 'coding') {
      coding++;
      if (coding === 1) throw Object.assign(new Error('fixture approval'), { code: 'needs_input' });
      assert.ok(args.resumeThreadId); assert.match(args.prompt, /只继续未完成部分/); return lead;
    }
    throw new Error('Unexpected role');
  });
  const stopped = await settled(m, m.create(input('complex')).id);
  await new Promise(r => setTimeout(r, 0));
  const action = { requestId: crypto.randomUUID(), expectedStage: 1 };
  assert.throws(() => m.resume(stopped.id, { ...action, expectedStage: 0 }), /阶段已变化/);
  m.resume(stopped.id, action); m.resume(stopped.id, action);
  const done = await settled(m, stopped.id);
  assert.equal(coding, 2); assert.equal(chiefs, 2);
  assert.equal(done.stages[1].threadId, done.stages[2].threadId);
  assert.equal(done.stages[2].parentIndex, 0);
  assert.equal(done.stages[0].status, 'completed');
  assert.equal(done.writeSafetyHold, false);
});

await test('once runs one real-identity stage and keeps defaults unmodified', async () => {
  let args; const m = manager('once', a => { args = a; return operator; }); const j = await settled(m, m.create(input('once')).id);
  assert.equal(j.status, 'completed'); assert.equal(j.stages.length, 1);
  assert.ok(j.stages[0].threadId); assert.ok(j.stages[0].turnId);
  assert.equal(Object.hasOwn(args, 'model'), false); assert.equal(Object.hasOwn(args, 'effort'), false);
});
await test('complex delegates independent coding, tester and QA with a confirmed chief model', async () => {
  const calls = []; let chiefs = 0, reference;
  const m = manager('complex', a => { calls.push(a); if (a.role === 'chief') return [delegate('coding'), delegate('tester'), delegate('qa'), complete][chiefs++];
    if (a.role === 'tester') reference = testReceipt(a); return a.role === 'qa' ? { ...reviewer, evidence: [{ kind: 'isolated', detail: 'Host command checked', reference }], verifiedWriteRevision: 1 } : lead; });
  const j = await settled(m, m.create(input('complex', { model: 'chosen-model', effort: 'high' })).id);
  assert.deepEqual(calls.map(a => a.role), ['chief', 'coding', 'chief', 'tester', 'chief', 'qa', 'chief']); assert.equal(j.status, 'completed');
  assert.equal(new Set(j.stages.map(s => s.threadId)).size, 7);
  assert.ok(calls.every(a => a.model === (a.role === 'chief' ? 'fixture-chief' : 'chosen-model') && a.effort === 'high'));
});
await test('chief schedules a bounded rework then independent QA pass', async () => {
  let reviews = 0, chiefs = 0, writes = 0, reference;
  const m = manager('rework', a => { if (a.role === 'chief') return [delegate('coding'), delegate('qa'), delegate('coding'), delegate('tester'), delegate('qa'), complete][chiefs++];
    if (a.role === 'coding') { writes++; return lead; } if (a.role === 'tester') { reference = testReceipt(a); return lead; }
    return { ...(++reviews === 1 ? changes : reviewer), evidence: reference ? [{ kind: 'isolated', detail: 'Host command checked', reference }] : facts, verifiedWriteRevision: writes }; });
  const j = await settled(m, m.create(input('complex')).id);
  assert.deepEqual(j.stages.map(s => s.role), ['chief', 'coding', 'chief', 'qa', 'chief', 'coding', 'chief', 'tester', 'chief', 'qa', 'chief']); assert.equal(j.status, 'completed'); assert.equal(j.reworkCount, 1);
});
await test('chief cannot turn a failed QA report into success', async () => {
  let chiefs = 0; const m = manager('still-failed', a => a.role === 'chief' ? [delegate('qa'), complete][chiefs++] : { ...changes, evidence: facts, verifiedWriteRevision: 0 });
  const j = await settled(m, m.create(input('complex')).id); assert.equal(j.status, 'needs_attention'); assert.equal(j.stages.length, 3);
});
await test('invalid output and evidence-free success fail closed', async () => {
  for (const [name, report] of [['invalid', { summary: 'made up' }], ['no-evidence', { ...operator, evidence: [] }]]) {
    const m = manager(name, () => report); const j = await settled(m, m.create(input()).id); assert.equal(j.status, 'failed'); assert.equal(j.stages.length, 1);
  }
});
await test('explicit failed operation does not run later stages', async () => {
  const m = manager('operator-failed', () => ({ ...operator, outcome: 'failed' })); const j = await settled(m, m.create(input()).id);
  assert.equal(j.status, 'failed'); assert.equal(j.stages.length, 1);
});
await test('transport user-input request remains visible', async () => {
  const m = manager('needs-input', () => { const e = new Error('请确认具体命令'); e.code = 'needs_input'; throw e; });
  const j = await settled(m, m.create(input()).id); assert.equal(j.status, 'needs_input'); assert.match(j.error, /具体命令/);
});
await test('duplicate submissions return same job; conflicts rejected', async () => {
  const m = manager('idempotent'); const req = input(); const a = m.create(req), b = m.create(req); assert.equal(a.id, b.id);
  assert.throws(() => m.create({ ...req, prompt: 'different' }), /不同任务/); await settled(m, a.id); assert.equal(m.list().length, 1);
});
await test('cancellation aborts runner and prevents later stages', async () => {
  let began; const ready = new Promise(r => began = r);
  const m = manager('cancel', a => new Promise((resolve, reject) => { began(); a.signal.addEventListener('abort', () => { const e = new Error('cancel'); e.name = 'AbortError'; reject(e); }, { once: true }); }));
  const j = m.create(input()); await ready; m.cancel(j.id); const out = await settled(m, j.id); assert.equal(out.status, 'cancelled'); assert.equal(out.stages.length, 1);
});
await test('capacity protects concurrent work', async () => {
  const m = manager('capacity', a => new Promise((resolve, reject) => a.signal.addEventListener('abort', () => reject(new Error('stopped')))), { maxActive: 1 });
  const j = m.create(input()); assert.throws(() => m.create(input()), /等候/); m.cancel(j.id);
});
await test('late turn identity survives cancellation without dispatching another stage', async () => {
  let args, release; const m = new WorkflowManager({ file: path.join(root, 'late-identity.json'), runStage: async a => {
    args = a; a.onIdentity({ threadId: 'late-thread' }); await new Promise(r => release = r); return operator;
  } });
  const job = m.create(input()); await new Promise(r => setTimeout(r, 10)); m.cancel(job.id);
  args.onIdentity({ turnId: 'late-turn' }); release(); const out = await settled(m, job.id);
  assert.equal(out.status, 'cancelled'); assert.equal(out.stages[0].turnId, 'late-turn'); assert.match(out.error, /请求停止/); assert.equal(out.stages.length, 1);
});
await test('restart marks unfinished records interrupted without runner calls', async () => {
  const file = path.join(root, 'restart.json'); const j = { id: 'fixture', status: 'running', stages: [{ status: 'running' }] };
  fs.writeFileSync(file, JSON.stringify({ version: 1, jobs: [j] })); let calls = 0;
  const m = new WorkflowManager({ file, runStage: () => { calls++; } }); assert.equal(m.get('fixture').status, 'interrupted'); assert.equal(calls, 0);
  assert.equal(JSON.parse(fs.readFileSync(file)).jobs[0].status, 'interrupted');
});
await test('cannot accept missing or reused independent thread identity', async () => {
  const m = new WorkflowManager({ file: path.join(root, 'no-identity.json'), runStage: async () => operator });
  assert.equal((await settled(m, m.create(input()).id)).status, 'failed');
  const reused = new WorkflowManager({ file: path.join(root, 'reused.json'), resolveChiefModel: async () => 'fixture-chief', verifySource: async () => true, runStage: async a => { a.onIdentity({ threadId: 'same-thread', turnId: crypto.randomUUID(), model: a.model || 'fixture-default' }); return a.role === 'chief' ? delegate('coding') : lead; } });
  const j = await settled(reused, reused.create(input('complex')).id); assert.equal(j.status, 'failed'); assert.match(j.error, /复用/);
});
await test('read-only manager and unknown modes reject writes', async () => {
  const m = manager('readonly', null, { readonly: true }); assert.throws(() => m.create(input()), /只读/);
  const normal = manager('unknown-mode'); assert.throws(() => normal.create(input('invented')), /未定义/);
});
await test('storage failure prevents further runner dispatch', async () => {
  let m, count = 0;
  m = manager('storage', () => { count++; m.file = root; return operator; });
  const j = await settled(m, m.create(input()).id); assert.equal(j.status, 'failed'); assert.equal(count, 1); assert.match(j.error, /保存失败/); assert.throws(() => m.create(input()), /保存失败/);
});
await test('discuss stays planning until explicit confirmation', async () => {
  const calls = []; const m = manager('discuss', a => { calls.push(a); return { operator, reviewer, summarizer, planner }[a.role]; });
  const created = m.create(input('discuss')); let j = await settled(m, created.id);
  assert.equal(created.planRevision, 0); assert.equal(j.planRevision, 1);
  assert.equal(j.status, 'awaiting_confirmation'); assert.deepEqual(calls.map(a => a.role), ['planner']);
  const discussionId = crypto.randomUUID(); m.discuss(j.id, '先只讨论，不执行', discussionId, 1); m.discuss(j.id, '先只讨论，不执行', discussionId, 1);
  j = await settled(m, j.id); assert.equal(j.status, 'awaiting_confirmation'); assert.equal(calls.length, 2); assert.equal(j.planRevision, 2);
  assert.equal(m.discuss(j.id, '先只讨论，不执行', discussionId, 1).planRevision, 2); // Lost-response retry after revision advanced.
  assert.match(calls[1].prompt, /先只讨论，不执行/);
  const requestId = crypto.randomUUID(); m.confirm(j.id, { mode: 'once', requestId, expectedRevision: 2 }); m.confirm(j.id, { mode: 'once', requestId, expectedRevision: 2 });
  j = await settled(m, j.id); assert.equal(j.status, 'completed'); assert.equal(j.confirmation.mode, 'once'); assert.equal(j.confirmation.planRevision, 2);
  assert.deepEqual(calls.map(a => a.role), ['planner', 'planner', 'operator']);
  assert.match(calls[2].prompt, /先只讨论，不执行/); assert.match(calls[2].prompt, /先比较方案再操作/);
});
await test('stale tab cannot confirm or extend a newer plan', async () => {
  const m = manager('stale-plan'); const created = m.create(input('discuss')); let j = await settled(m, created.id);
  m.discuss(j.id, '选择第二个方案', crypto.randomUUID(), j.planRevision); j = await settled(m, j.id);
  assert.equal(j.planRevision, 2);
  const before = m.get(j.id);
  assert.throws(() => m.confirm(j.id, { mode: 'once', requestId: crypto.randomUUID(), expectedRevision: 1 }), /方案版本/);
  assert.throws(() => m.discuss(j.id, '旧标签页补充', crypto.randomUUID(), 1), /方案版本/);
  assert.throws(() => m.confirm(j.id, { mode: 'once', requestId: crypto.randomUUID() }), /方案版本/);
  assert.throws(() => m.confirm(j.id, { mode: 'once', requestId: crypto.randomUUID(), expectedRevision: '2' }), /方案版本/);
  assert.deepEqual(m.get(j.id), before);
  const requestId = crypto.randomUUID(); m.confirm(j.id, { mode: 'once', requestId, expectedRevision: 2 });
  assert.throws(() => m.confirm(j.id, { mode: 'complex', requestId, expectedRevision: 2 }), /不同操作/);
  assert.throws(() => m.confirm(j.id, { mode: 'once', requestId, expectedRevision: 1 }), /不同操作/);
  assert.equal((await settled(m, j.id)).status, 'completed');
});
await test('planner user-input request can continue discussion but cannot confirm execution', async () => {
  const calls = []; let needsQuestion = true;
  const m = manager('planner-clarify', args => {
    calls.push(args);
    if (needsQuestion) { needsQuestion = false; const error = new Error('请选择方案甲或方案乙'); error.code = 'needs_input'; throw error; }
    return planner;
  });
  const created = m.create(input('discuss')); let j = await settled(m, created.id);
  assert.equal(j.status, 'needs_input'); assert.equal(j.planRevision, 0);
  assert.throws(() => m.confirm(j.id, { mode: 'once', requestId: crypto.randomUUID(), expectedRevision: 0 }), /等待/);
  m.discuss(j.id, '确认方案乙，先继续讨论细节', crypto.randomUUID(), 0);
  j = await settled(m, j.id);
  assert.equal(j.status, 'awaiting_confirmation'); assert.equal(j.planRevision, 1);
  assert.deepEqual(calls.map(a => a.role), ['planner', 'planner']);
  assert.match(calls[1].prompt, /请选择方案甲或方案乙/); assert.match(calls[1].prompt, /确认方案乙，先继续讨论细节/);
  assert.equal(j.confirmation, undefined);
});
console.log(`PASS ${passed} workflow tests; fixtures: ${root}`);
