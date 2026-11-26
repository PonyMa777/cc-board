// All identities, model responses and command receipts are synthetic fixtures.
// No Codex chats or actual business tasks are started here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { WorkflowManager } from '../workflows.mjs';

const root = fs.mkdtempSync('D:/ChatGPT-Temp/ccboard-workflows-20261125/hierarchy-tests-');
const facts = [{ kind: 'static', detail: 'Synthetic fixture observation', reference: null }];
const lead = { outcome: 'completed', summary: 'Fixture specialist report', evidence: facts, blockers: [] };
const finish = { decision: 'complete', role: null, task: '', summary: 'Fixture completion report', evidence: facts, blockers: [] };
const planner = { summary: 'Fixture plan', steps: ['Wait for explicit approval'], questions: [], risks: [] };
let passed = 0;
const input = (mode = 'complex', extra = {}) => ({ prompt: 'Synthetic fixture task', cwd: root, mode, requestId: crypto.randomUUID(), ...extra });
const delegate = role => ({ decision: 'delegate', role, task: 'Fixture assignment for ' + role, summary: 'Fixture delegation', evidence: [], blockers: [] });
async function settled(manager, id) { for (let i = 0; i < 500; i++) { const j = manager.get(id); if (!['queued', 'running'].includes(j.status)) return j; await new Promise(r => setTimeout(r, 5)); } throw new Error('Fixture did not settle'); }
async function test(name, fn) { await fn(); passed++; console.log('ok ' + name); }
function scenario(name, roles, options = {}) {
  const calls = []; let chief = 0, writes = 0, reference = null;
  const resolver = Object.hasOwn(options, 'resolver') ? options.resolver : async () => ({ model: 'highest-fixture', effort: 'high', reason: 'Fixture availability verified' });
  const verifier = Object.hasOwn(options, 'verifySource') ? options.verifySource : async () => true;
  const manager = new WorkflowManager({ file: path.join(root, name + '.json'), resolveChiefModel: resolver, verifySource: verifier, runStage: async args => {
    const identity = { threadId: crypto.randomUUID(), turnId: crypto.randomUUID() };
    calls.push(args);
    args.onIdentity({ ...identity, ...(options.omitActualModel ? {} : { model: options.actualModel || args.model || 'default-fixture' }) });
    if (args.role === 'chief') return roles[chief] ? delegate(roles[chief++]) : { ...finish, ...options.finish };
    if (args.role === 'coding' || args.role === 'documentation') writes++;
    if (args.role === 'tester' && !options.noReceipts) {
      const exits = options.exits || [0];
      for (const [i, exitCode] of exits.entries()) {
        reference = 'host-' + identity.threadId + '-' + i;
        args.onEvidence({ kind: 'isolated', id: reference, command: 'fixture-suite --verify-target', exitCode, output: exitCode ? 'Fixture failure' : 'Fixture passed', status: 'completed', cwd: root,
          manifestHash: crypto.createHash('sha256').update(JSON.stringify(options.sourceManifest || [])).digest('hex'), limitations: ['Isolated fixture; not a real desktop verification'], ...identity,
          ...(i === 0 && !options.noMetadata ? { sourceManifest: options.sourceManifest || [], validationFiles: options.validationFiles || { files: [], complete: true, limitations: [] } } : {}),
          ...(options.foreignReceipt ? { threadId: 'other-thread' } : {}), ...options.receipt });
      }
    }
    if (args.role === 'qa') return { verdict: options.qaVerdict || 'pass', summary: 'Fixture QA report',
      evidence: [{ kind: options.qaKind || 'isolated', detail: 'Checked fixture receipt', reference: options.forgedReference ? 'invented-host-id' : reference }],
      findings: options.qaVerdict === 'changes_requested' ? ['Fixture requires repair'] : [], verifiedWriteRevision: options.staleQa ? writes - 1 : writes };
    return lead;
  } });
  return { manager, calls };
}

await test('dynamic roles form a real rooted hierarchy and preserve chosen models', async () => {
  const { manager, calls } = scenario('tree', ['decomposition', 'research', 'coding', 'tester', 'qa']);
  const j = await settled(manager, manager.create(input('complex', { model: 'chosen-specialist', effort: 'low', originThreadId: 'external-reference' })).id);
  assert.equal(j.status, 'completed'); assert.equal(j.stages.length, 11); assert.equal(j.rootChiefIndex, 0);
  assert.equal(j.rootChiefThreadId, j.stages[0].threadId); assert.equal(j.stages[0].parentThreadId, null);
  for (const stage of j.stages.slice(1)) {
    const expectedParent = stage.role === 'chief' ? 0 : stage.index - 1;
    assert.equal(stage.parentIndex, expectedParent); assert.equal(stage.parentThreadId, j.stages[expectedParent].threadId);
  }
  assert.ok(calls.every(a => a.model === (a.role === 'chief' ? 'highest-fixture' : 'chosen-specialist')));
  assert.ok(calls.every(a => a.effort === (a.role === 'chief' ? 'high' : 'low')));
  assert.equal(j.scope.entry, 'YOU'); assert.equal(j.scope.takesOverOrigin, false); assert.equal(j.scope.originThreadId, 'external-reference');
  assert.ok(j.stages.every(s => s.parentThreadId !== 'external-reference'));
  const tester = j.stages.find(s => s.role === 'tester'); assert.equal(tester.writesSource, false); assert.equal(tester.readOnly, false);
  assert.equal(tester.executionEvidence[0].manifestHash, crypto.createHash('sha256').update('[]').digest('hex')); assert.equal(tester.executionEvidence[0].cwd, root);
  assert.ok(calls.find(a => a.role === 'qa').prompt.includes('fixture-suite --verify-target'));
});
await test('completion permits descriptive task text but never a delegated role', async () => {
  const valid = scenario('descriptive-complete', ['tester', 'qa'], { finish: { task: '核验已捕获的测试结果并汇总限制。' } });
  const completed = await settled(valid.manager, valid.manager.create(input()).id);
  assert.equal(completed.status, 'completed'); assert.equal(completed.stages.length, 5);
  const invalid = scenario('role-on-complete', ['tester', 'qa'], { finish: { task: '描述性收尾', role: 'coding' } });
  const rejected = await settled(invalid.manager, invalid.manager.create(input()).id);
  assert.equal(rejected.status, 'failed'); assert.match(rejected.error, /决策与委派/);
  assert.equal(rejected.stages.length, 5); assert.ok(!rejected.stages.some(s => s.role === 'coding'));
});
await test('missing or unavailable chief selection fails without lower-model fallback', async () => {
  for (const [name, resolver] of [['missing', undefined], ['unavailable', async () => { throw new Error('Highest model unavailable'); }]]) {
    const { manager, calls } = scenario('resolver-' + name, [], { resolver }); const j = await settled(manager, manager.create(input()).id);
    assert.equal(j.status, 'failed'); assert.equal(calls.length, 0); assert.equal(j.stages.length, 0);
  }
});
await test('actual chief model must be explicitly confirmed and match the selected model', async () => {
  for (const [name, option] of [['mismatch', { actualModel: 'lower-model' }], ['missing', { omitActualModel: true }]]) {
    const { manager } = scenario('actual-' + name, ['coding'], option); const j = await settled(manager, manager.create(input()).id);
    assert.equal(j.status, 'failed'); assert.equal(j.stages.length, 1); assert.match(j.error, /模型/);
  }
});
await test('self-reported real-environment success without host receipts is blocked', async () => {
  const { manager } = scenario('self-report', ['tester', 'qa'], { noReceipts: true, qaKind: 'real_environment' });
  const j = await settled(manager, manager.create(input()).id); assert.equal(j.status, 'blocked'); assert.equal(j.lastTester.qualified, false); assert.equal(j.lastQa.verdict, 'blocked');
});
await test('forged or relabeled host references cannot pass QA', async () => {
  for (const [name, option] of [['forged', { forgedReference: true }], ['relabeled', { qaKind: 'real_environment' }]]) {
    const { manager } = scenario('reference-' + name, ['tester', 'qa'], option); const j = await settled(manager, manager.create(input()).id);
    assert.equal(j.status, 'blocked'); assert.equal(j.stages.at(-1).report.verdict, 'blocked');
  }
});
await test('any failed host command invalidates tester acceptance even with a successful self-report', async () => {
  const { manager } = scenario('command-failure', ['tester', 'qa'], { exits: [0, 1] });
  const j = await settled(manager, manager.create(input()).id); assert.equal(j.status, 'blocked'); assert.equal(j.lastTester.qualified, false);
  assert.equal(j.stages.find(s => s.role === 'tester').executionEvidence.length, 2);
});
await test('truncated host commands or outputs cannot qualify even when exit is zero', async () => {
  for (const [name, receipt] of [['command-flag', { commandTruncated: true }], ['output-flag', { outputTruncated: true }], ['command-bound', { command: 'x'.repeat(2001) }], ['output-bound', { output: 'x'.repeat(4001) }]]) {
    const { manager } = scenario('truncated-' + name, ['tester', 'qa'], { receipt });
    const j = await settled(manager, manager.create(input()).id);
    assert.equal(j.status, 'blocked'); assert.equal(j.lastTester.qualified, false);
    const evidence = j.stages.find(s => s.role === 'tester').executionEvidence[0];
    assert.ok(evidence.commandTruncated || evidence.outputTruncated);
  }
});
await test('host evidence from another thread is rejected', async () => {
  const { manager } = scenario('foreign-host', ['tester'], { foreignReceipt: true }); const j = await settled(manager, manager.create(input()).id);
  assert.equal(j.status, 'failed'); assert.match(j.error, /不属于/); assert.equal(j.writeSafetyHold, false);
});
await test('missing or incomplete host file snapshots cannot qualify a tester', async () => {
  for (const [name, options] of [['missing', { noMetadata: true }], ['incomplete', { validationFiles: { files: [], complete: false, limitations: ['Not fully captured'] } }]]) {
    const { manager } = scenario('snapshot-' + name, ['tester', 'qa'], options);
    const j = await settled(manager, manager.create(input()).id); assert.equal(j.status, 'blocked'); assert.equal(j.lastTester.qualified, false);
  }
});
await test('complete rechecks the current source manifest and blocks a changed project', async () => {
  let verified = false;
  const { manager } = scenario('source-changed', ['tester', 'qa'], { verifySource: async (cwd, manifest) => {
    verified = true; assert.equal(cwd, root); assert.deepEqual(manifest, []); throw new Error('Synthetic source changed');
  } });
  const j = await settled(manager, manager.create(input()).id); assert.equal(verified, true); assert.equal(j.status, 'blocked'); assert.match(j.error, /源版本复核/);
  const missing = scenario('verifier-missing', [], { verifySource: undefined }); const absent = await settled(missing.manager, missing.manager.create(input()).id);
  assert.equal(absent.status, 'failed'); assert.equal(absent.stages.length, 0);
});
await test('host-classified runtime notices do not hide incomplete or truncated test artifacts', async () => {
  const runtimeArtifacts = [{ path: 'TEMP/AppData/Local/Microsoft/PowerShell/StartupProfileData-NonInteractive', size: 1, sha256: 'b'.repeat(64) }];
  for (const complete of [true, false]) {
    const validationFiles = { files: [], runtimeArtifacts, complete, limitations: ['Known runtime cache; not test evidence'] };
    const { manager, calls } = scenario('runtime-' + complete, ['tester', 'qa'], { validationFiles });
    const j = await settled(manager, manager.create(input()).id);
    assert.equal(j.status, complete ? 'completed' : 'blocked');
    assert.deepEqual(j.stages.find(s => s.role === 'tester').validationEvidence.runtimeArtifacts, runtimeArtifacts);
    assert.ok(calls.find(a => a.role === 'qa').prompt.includes('Known runtime cache'));
  }
  const validationFiles = { files: [{ path: 'test.mjs', size: 5, sha256: 'c'.repeat(64), content: '', truncated: true }], complete: true, limitations: [] };
  const { manager } = scenario('truncated-file', ['tester', 'qa'], { validationFiles });
  assert.equal((await settled(manager, manager.create(input()).id)).status, 'blocked');
});
await test('QA receives captured test contents but not the full original source manifest', async () => {
  const content = 'assert.equal(actual, expected); // independently captured fixture';
  const validationFiles = { files: [{ path: 'independent.test.mjs', size: Buffer.byteLength(content), sha256: crypto.createHash('sha256').update(content).digest('hex'), content, truncated: false }], complete: true, limitations: [] };
  const sourceManifest = [{ path: '__SOURCE_MANIFEST_SENTINEL__.mjs', size: 1, sha256: 'a'.repeat(64) }];
  const { manager, calls } = scenario('test-contents', ['tester', 'qa'], { validationFiles, sourceManifest });
  const j = await settled(manager, manager.create(input()).id); assert.equal(j.status, 'completed');
  const qa = calls.find(a => a.role === 'qa'); assert.ok(qa.prompt.includes(content)); assert.ok(!qa.prompt.includes('__SOURCE_MANIFEST_SENTINEL__'));
  assert.ok(qa.prompt.includes('Fixture availability verified')); assert.ok(qa.prompt.includes('"qualified":true'));
  assert.ok(qa.prompt.includes('不需要验证宿主整个调度实现')); assert.ok(qa.prompt.includes('缺失、删除或截断时必须blocked'));
  assert.deepEqual(j.stages.find(s => s.role === 'tester').sourceManifest, sourceManifest); assert.ok(j.sourceVerifiedAt);
});
await test('a later source write invalidates previously passing tests and QA', async () => {
  const { manager } = scenario('later-write', ['coding', 'tester', 'qa', 'documentation']); const j = await settled(manager, manager.create(input()).id);
  assert.equal(j.status, 'needs_attention'); assert.equal(j.writeRevision, 2); assert.equal(j.lastQa.writeRevision, 1);
});
await test('tester and QA must cover the current write revision', async () => {
  const a = scenario('old-test', ['tester', 'coding', 'qa']); assert.equal((await settled(a.manager, a.manager.create(input()).id)).status, 'blocked');
  const b = scenario('old-qa', ['coding', 'tester', 'qa'], { staleQa: true }); assert.equal((await settled(b.manager, b.manager.create(input()).id)).status, 'blocked');
});
await test('stage limit bounds continuing chief delegation', async () => {
  const { manager } = scenario('stage-limit', Array(20).fill('research')); const j = await settled(manager, manager.create(input()).id);
  assert.equal(j.status, 'needs_attention'); assert.ok(j.stages.length <= 12); assert.equal(j.stages.filter(s => s.role === 'research').length, 5);
});
await test('third QA repair request cannot start a third repair cycle', async () => {
  const { manager } = scenario('repair-limit', ['qa', 'coding', 'qa', 'documentation', 'qa'], { qaVerdict: 'changes_requested' });
  const j = await settled(manager, manager.create(input()).id); assert.equal(j.status, 'needs_attention'); assert.equal(j.reworkCount, 2); assert.match(j.error, /两次返工/);
});
await test('invalid delegated role never dispatches an invented assistant', async () => {
  const { manager } = scenario('invalid-role', ['unknown-service']); const j = await settled(manager, manager.create(input()).id);
  assert.equal(j.status, 'failed'); assert.equal(j.stages.length, 1);
});
await test('same and nested source directories cannot run concurrent writers, planning remains read-only', async () => {
  const source = path.join(root, 'source'), nested = path.join(source, 'nested'), other = path.join(root, 'other');
  fs.mkdirSync(nested, { recursive: true }); fs.mkdirSync(other);
  const manager = new WorkflowManager({ file: path.join(root, 'locks.json'), resolveChiefModel: async () => 'highest-fixture', runStage: async args => {
    args.onIdentity({ threadId: crypto.randomUUID(), turnId: crypto.randomUUID(), model: args.model || 'default-fixture' });
    if (args.role === 'planner') return planner;
    return new Promise((resolve, reject) => args.signal.addEventListener('abort', () => { const e = new Error('Stop requested'); e.name = 'AbortError'; reject(e); }, { once: true }));
  } });
  const running = manager.create(input('once', { cwd: source })); await new Promise(r => setTimeout(r, 10));
  assert.throws(() => manager.create(input('complex', { cwd: nested })), /嵌套目录/);
  assert.throws(() => manager.create(input('once', { cwd: source })), /嵌套目录/);
  const independent = manager.create(input('once', { cwd: other })); manager.cancel(independent.id);
  const plan = await settled(manager, manager.create(input('discuss', { cwd: nested })).id);
  assert.equal(plan.status, 'awaiting_confirmation');
  assert.throws(() => manager.confirm(plan.id, { mode: 'complex', requestId: crypto.randomUUID(), expectedRevision: 1 }), /嵌套目录/);
  manager.cancel(running.id); await new Promise(r => setTimeout(r, 10)); assert.equal(manager.get(running.id).writeSafetyHold, true);
  assert.throws(() => manager.create(input('once', { cwd: nested })), /停止状态未核实/);
  const requestId = crypto.randomUUID(); manager.acknowledgeStop(running.id, { requestId }); manager.acknowledgeStop(running.id, { requestId });
  assert.equal(manager.get(running.id).status, 'cancelled'); assert.equal(manager.get(running.id).writeSafetyHold, false); assert.match(manager.get(running.id).error, /已核对/);
  const allowed = manager.create(input('once', { cwd: nested })); manager.cancel(allowed.id);
});
await test('restart preserves uncertain-write holds and leaves legacy completed records untouched', async () => {
  const file = path.join(root, 'restart-hold.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, jobs: [
    { id: 'old-complete', mode: 'complex', cwd: root, status: 'completed', stages: [{ role: 'operator', status: 'completed' }, { role: 'reviewer', status: 'completed' }, { role: 'summarizer', status: 'completed' }] },
    { id: 'unknown-writer', mode: 'once', cwd: root, status: 'running', stages: [{ role: 'operator', status: 'running', threadId: 'old-thread', turnId: 'old-turn' }] },
  ] }));
  let calls = 0; const manager = new WorkflowManager({ file, runStage: async () => { calls++; return lead; } });
  assert.equal(manager.get('old-complete').status, 'completed'); assert.equal(manager.get('old-complete').stages[1].role, 'reviewer');
  assert.equal(manager.get('unknown-writer').status, 'interrupted'); assert.equal(manager.get('unknown-writer').writeSafetyHold, true);
  assert.throws(() => manager.create(input('once')), /停止状态未核实/); assert.equal(calls, 0);
});
console.log(`PASS ${passed} hierarchy tests; synthetic fixtures: ${root}`);
