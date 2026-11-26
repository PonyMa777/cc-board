import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { runCodexStage, readOnlyContext } from '../codex-stage.mjs';

const root = fs.mkdtempSync('D:/ChatGPT-Temp/ccboard-workflows-20261125/stage-tests-');
fs.writeFileSync(path.join(root, 'safe.md'), 'Independent evidence');
fs.writeFileSync(path.join(root, 'check.mjs'), 'import assert from "node:assert/strict"; assert.equal(2 + 2, 4);');
fs.writeFileSync(path.join(root, 'credentials.txt'), 'DO NOT SEND');
assert.ok(!JSON.stringify(readOnlyContext(root)).includes('DO NOT SEND'));
const calls = [];
function fakeSpawn(options = {}) {
  return (_bin, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); };
    const emit = m => child.stdout.write(JSON.stringify(m) + '\n');
    child.stdin = new Writable({ write(chunk, _enc, cb) {
      const m = JSON.parse(chunk.toString()); calls.push(m);
      queueMicrotask(() => {
        if (m.method === 'initialize') {
          if (options.serverRequest) emit({ id: 'server-request', method: 'account/chatgptAuthTokens/refresh', params: {} });
          emit({ id: m.id, result: {} });
        }
        if (m.method === 'config/read') emit({ id: m.id, result: { config: { mcp_servers: { fixture_server: { enabled: true } } } } });
        if (m.method === 'thread/name/set') emit({ id: m.id, result: {} });
        if (m.method === 'thread/start' || m.method === 'thread/resume') {
          if (options.resume) { assert.equal(m.method, 'thread/resume'); assert.equal(m.params.threadId, 'thread-fixture'); }
          if (options.writer) {
            assert.equal(m.params.sandbox, 'workspace-write');
            assert.equal(m.params.approvalPolicy, 'on-request');
            const roots = m.params.config['sandbox_workspace_write.writable_roots'];
            assert.equal(roots[0], root); assert.ok(fs.existsSync(roots[1]));
            emit({ id: m.id, result: { thread: { id: 'thread-fixture', status: { type: options.active ? 'active' : 'idle' } }, sandbox: options.badSandbox ? { type: 'readOnly' } : { type: 'workspaceWrite', networkAccess: false, writableRoots: roots.slice(1), excludeTmpdirEnvVar: true, excludeSlashTmp: true } } });
            return;
          }
          assert.equal(m.params.model, options.model, 'must use only the requested model');
          if (options.readOnly) {
            assert.ok(args.includes('shell_tool')); assert.ok(args.includes('apps'));
            assert.equal(m.params.config['mcp_servers.fixture_server.enabled'], false);
            assert.equal(m.params.config['features.plugins'], false);
          }
          if (options.tester) {
            assert.equal(m.params.config['features.shell_tool'], true);
            assert.equal(m.params.config['features.apps'], false);
            assert.equal(m.params.config['mcp_servers.fixture_server.enabled'], false);
            assert.notEqual(m.params.cwd, root);
            assert.equal(m.params.config['shell_environment_policy.set'].CODEX_HOME, path.join(m.params.cwd, '.codex'));
            if (options.modifySource) fs.writeFileSync(path.join(path.dirname(m.params.cwd), 'project', 'safe.md'), 'Changed the implementation while testing');
          }
          emit({ id: m.id, result: { thread: { id: 'thread-fixture' }, ...(options.actualModel ? { model: options.actualModel } : {}), approvalPolicy: 'never', sandbox: options.tester ? { type: 'workspaceWrite', networkAccess: !!options.badNetwork, writableRoots: options.badRoot ? [root] : [m.params.cwd], excludeTmpdirEnvVar: true, excludeSlashTmp: true } : { type: options.badSandbox ? 'dangerFullAccess' : 'readOnly' } } });
        }
        if (m.method === 'mcpServerStatus/list') {
          if (options.inventoryRequest) emit({ id: 'late-request', method: 'attestation/generate', params: {} });
          emit({ id: m.id, result: { data: options.externalTools ? [{ name: 'unexpected' }] : [], nextCursor: null } });
        }
        if (m.method === 'turn/start') {
          if (options.approval) {
            emit({id:m.id,result:{turn:{id:'turn-fixture'}}});
            emit({id:'approval-fixture',method:'item/commandExecution/requestApproval',params:{threadId:'thread-fixture',turnId:'turn-fixture',command:'node synthetic.mjs',reason:'fixture approval'}});return;
          }
          if (options.writer) {
            assert.equal(m.params.sandboxPolicy.type, 'workspaceWrite');
            assert.equal(m.params.sandboxPolicy.networkAccess, false);
            assert.equal(m.params.sandboxPolicy.writableRoots[0], root);
          }
          if (options.tester) {
            assert.equal(m.params.sandboxPolicy.type, 'workspaceWrite'); assert.equal(m.params.sandboxPolicy.networkAccess, false);
            emit({ method: 'item/completed', params: { threadId: 'thread-fixture', turnId: 'turn-fixture', item: { type: 'commandExecution', id: 'host-command', command: 'node check.mjs', exitCode: 0, aggregatedOutput: 'Synthetic assertions passed', status: 'completed' } } });
          }
          if (options.reroute) emit({ method: 'model/rerouted', params: { threadId: 'thread-fixture', fromModel: options.model, toModel: 'other' } });
          if (options.readOnly) assert.ok(m.params.input[0].text.includes('Independent evidence'));
          const result = () => emit({ id: m.id, result: { turn: { id: 'turn-fixture' } } });
          if (options.cancel) { options.cancel.abort(); setTimeout(result, 10); return; }
          // Complete before the response: a real transport may interleave notifications this way.
          emit({ method: 'item/completed', params: { threadId: 'other-thread', turnId: 'turn-fixture', item: { type: 'agentMessage', id: 'bad', text: 'wrong' } } });
          emit({ method: 'item/completed', params: { threadId: 'thread-fixture', turnId: 'turn-fixture', item: { type: 'agentMessage', id: 'final', phase: 'final_answer', text: options.invalidJson ? 'not JSON' : '{"summary":"actual result"}' } } });
          emit({ method: 'turn/completed', params: { threadId: 'thread-fixture', turn: { id: 'turn-fixture', status: options.failed ? 'failed' : 'completed', items: [] } } });
          result();
        }
        if (m.method === 'turn/interrupt') emit({ id: m.id, result: {} });
        if (m.id === 'approval-fixture' && m.result) {
          emit({method:'turn/completed',params:{threadId:'thread-fixture',turn:{id:'turn-fixture',status:'completed',items:[{type:'agentMessage',id:'final',phase:'final_answer',text:'{"summary":"approved fixture"}'}]}}});
        }
      });
      cb();
    } });
    return child;
  };
}
const base = { bin: 'unused', home: root, cwd: root, role: 'planner', prompt: 'Plan only', taskTitle: 'Protocol fixture', schema: {}, timeout: 2000 };
let identity;
assert.deepEqual(await runCodexStage({ ...base, spawnProcess: fakeSpawn({ readOnly: true }), onIdentity: x => identity = x }), { summary: 'actual result' });
assert.deepEqual(identity, { threadId: 'thread-fixture', turnId: 'turn-fixture' });
await assert.rejects(runCodexStage({ ...base, spawnProcess: fakeSpawn({ badSandbox: true }) }), /只读沙盒/);
await assert.rejects(runCodexStage({ ...base, spawnProcess: fakeSpawn({ externalTools: true }) }), /MCP/);
await assert.rejects(runCodexStage({ ...base, spawnProcess: fakeSpawn({ invalidJson: true }) }), /结构化/);
await assert.rejects(runCodexStage({ ...base, spawnProcess: fakeSpawn({ failed: true }) }), /未完成/);
calls.length = 0;
await assert.rejects(runCodexStage({ ...base, spawnProcess: fakeSpawn({ serverRequest: true }) }), e => e.code === 'needs_input');
assert.ok(!calls.some(x => x.method === 'turn/start'));
calls.length = 0;
await assert.rejects(runCodexStage({ ...base, spawnProcess: fakeSpawn({ inventoryRequest: true }) }), e => e.code === 'needs_input');
assert.ok(!calls.some(x => x.method === 'turn/start'), 'unknown request during isolation checks must prevent the turn');
calls.length = 0;
const controller = new AbortController();
await assert.rejects(runCodexStage({ ...base, role: 'operator', signal: controller.signal, spawnProcess: fakeSpawn({ writer: true, cancel: controller }) }), e => e.name === 'AbortError');
assert.ok(calls.some(x => x.method === 'turn/interrupt' && x.params.turnId === 'turn-fixture'));
const chief = { ...base, role: 'chief', model: 'gpt-6.2-astra', effort: 'high' };
calls.length=0;
let allow;
const approvalRun=runCodexStage({...base,role:'coding',spawnProcess:fakeSpawn({writer:true,approval:true}),onApproval:()=>new Promise(resolve=>allow=resolve)});
for(let i=0;i<50&&!allow;i++)await new Promise(resolve=>setTimeout(resolve,5));
assert.ok(allow);assert.ok(!calls.some(m=>m.id==='approval-fixture'),'no automatic approval response');
allow('accept');await approvalRun;
assert.deepEqual(calls.find(m=>m.id==='approval-fixture').result,{decision:'accept'});
await runCodexStage({ ...base, role: 'coding', resumeThreadId: 'thread-fixture', spawnProcess: fakeSpawn({ writer: true, resume: true }) });
calls.length = 0;
await assert.rejects(runCodexStage({ ...base, role: 'coding', resumeThreadId: 'thread-fixture', spawnProcess: fakeSpawn({ writer: true, resume: true, active: true }) }), /仍在运行/);
assert.ok(!calls.some(x => x.method === 'turn/start'));
for (const role of ['operator', 'coding', 'documentation']) {
  await runCodexStage({ ...base, role, spawnProcess: fakeSpawn({ writer: true }) });
  calls.length = 0;
  await assert.rejects(runCodexStage({ ...base, role, spawnProcess: fakeSpawn({ writer: true, badSandbox: true }) }), /写入权限/);
  assert.ok(!calls.some(x => x.method === 'turn/start'));
}
calls.length = 0;
await assert.rejects(runCodexStage({ ...chief, spawnProcess: fakeSpawn({ model: chief.model, actualModel: 'other' }) }), /实际模型/);
assert.ok(!calls.some(x => x.method === 'turn/start'));
await assert.rejects(runCodexStage({ ...chief, spawnProcess: fakeSpawn({ model: chief.model }) }), /实际模型/);
await assert.rejects(runCodexStage({ ...chief, spawnProcess: fakeSpawn({ model: chief.model, actualModel: chief.model, reroute: true }) }), /重新路由/);
await runCodexStage({ ...chief, spawnProcess: fakeSpawn({ model: chief.model, actualModel: chief.model, readOnly: true }), onIdentity: x => identity = x });
assert.equal(identity.model, chief.model);
for (const role of ['research', 'decomposition', 'qa']) await runCodexStage({ ...base, role, spawnProcess: fakeSpawn({ readOnly: true }) });
const receipts = [];
await runCodexStage({ ...base, role: 'tester', spawnProcess: fakeSpawn({ tester: true }), onEvidence: e => receipts.push(e) });
assert.equal(receipts.length, 1); assert.equal(receipts[0].exitCode, 0); assert.equal(receipts[0].kind, 'isolated');
assert.match(receipts[0].id, /^[a-f0-9]{64}$/); assert.equal(receipts[0].turnId, 'turn-fixture');
assert.ok(receipts[0].validationFiles.files.some(f => f.path === 'check.mjs' && f.content.includes('assert.equal')));
for (const option of ['badRoot', 'badNetwork']) {
  calls.length = 0;
  await assert.rejects(runCodexStage({ ...base, role: 'tester', spawnProcess: fakeSpawn({ tester: true, [option]: true }) }), /隔离写入/);
  assert.ok(!calls.some(x => x.method === 'turn/start'));
}
await assert.rejects(runCodexStage({ ...base, role: 'tester', spawnProcess: fakeSpawn({ tester: true, modifySource: true }) }), /修改了被验证/);
console.log('PASS: stage protocol, early notifications, independent snapshot, read-only isolation, unsupported requests, failure, malformed output, cancellation race.');
