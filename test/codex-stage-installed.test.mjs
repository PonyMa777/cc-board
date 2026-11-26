// Test the installed protocol/configuration, but intercept EVERY turn/start before it reaches Codex.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { runCodexStage } from '../codex-stage.mjs';

const root = fs.mkdtempSync('D:/ChatGPT-Temp/ccboard-workflows-20261125/installed-');
const home = path.join(root, 'home'); fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
const marker = path.join(root, 'unexpected-mcp-start');
const stub = path.join(root, 'mcp.mjs');
fs.writeFileSync(stub, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'started');`);
fs.writeFileSync(path.join(home, '.codex/config.toml'), `[windows]\nsandbox = "elevated"\n[mcp_servers.fixture]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(stub)}]\n`);
const bin = execFileSync('where.exe', ['codex.exe'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
let intercepted = 0, identity, lastPolicy;
function guardedSpawn(executable, args, options) {
  const real = spawn(executable, args, { ...options, env: { ...options.env, HOME: home, USERPROFILE: home, TEMP: root, TMP: root, TMPDIR: root } });
  const wrapped = new EventEmitter(); wrapped.stdout = new PassThrough(); wrapped.stderr = real.stderr;
  real.stdout.pipe(wrapped.stdout); real.on('error', e => wrapped.emit('error', e)); real.on('exit', (...x) => wrapped.emit('exit', ...x));
  let diagnostic = '';
  real.stdout.on('data', b => { diagnostic += b; let at; while ((at = diagnostic.indexOf('\n')) >= 0) { const line = diagnostic.slice(0, at); diagnostic = diagnostic.slice(at + 1); try { const m = JSON.parse(line); if (m.result?.sandbox) lastPolicy = { sandbox: m.result.sandbox, approvalPolicy: m.result.approvalPolicy }; } catch {} } });
  wrapped.kill = () => real.kill();
  wrapped.stdin = new Writable({ write(chunk, _enc, cb) {
    const message = JSON.parse(chunk.toString());
    if (message.method === 'turn/start') {
      intercepted++;
      queueMicrotask(() => wrapped.stdout.write(JSON.stringify({ id: message.id, error: { message: 'PROBE_NO_MODEL_TURN' } }) + '\n'));
      cb();
    } else real.stdin.write(chunk, cb);
  }, destroy(error, cb) { real.stdin.destroy(); cb(error); } });
  return wrapped;
}
const originalTemp = [process.env.TEMP, process.env.TMP, process.env.TMPDIR];
process.env.TEMP = process.env.TMP = process.env.TMPDIR = root;
try {
  await assert.rejects(runCodexStage({ bin, home, cwd: home, role: 'planner', prompt: 'Protocol probe only', taskTitle: 'Isolated protocol fixture', schema: {}, spawnProcess: guardedSpawn, onIdentity: x => identity = x }), /PROBE_NO_MODEL_TURN/);
  assert.equal(intercepted, 1); assert.ok(identity.threadId);
  await assert.rejects(runCodexStage({ bin, home, cwd: home, role: 'chief', model: 'gpt-6.2-astra', effort: 'high', prompt: 'Protocol probe only', taskTitle: 'Isolated chief fixture', schema: {}, spawnProcess: guardedSpawn, onIdentity: x => identity = x }), /PROBE_NO_MODEL_TURN/);
  assert.equal(intercepted, 2); assert.equal(identity.model, 'gpt-6.2-astra');
  await assert.rejects(runCodexStage({ bin, home, cwd: home, role: 'tester', prompt: 'Protocol probe only', taskTitle: 'Isolated tester fixture', schema: {}, spawnProcess: guardedSpawn }), e => { assert.match(e.message, /PROBE_NO_MODEL_TURN/, JSON.stringify(lastPolicy)); return true; });
  assert.equal(intercepted, 3);
  assert.equal(fs.existsSync(marker), false, 'configured external MCP must never start');
  // Even a read-only CLI default must produce an explicitly scoped writing stage.
  fs.appendFileSync(path.join(home, '.codex/config.toml'), '\n');
  await assert.rejects(runCodexStage({ bin, home, cwd: home, role: 'coding', prompt: 'Protocol probe only', taskTitle: 'Writer permission fixture', schema: {}, spawnProcess: guardedSpawn, onIdentity: x => identity = x }), e => { assert.match(e.message, /PROBE_NO_MODEL_TURN/, JSON.stringify(lastPolicy)); return true; });
  assert.equal(intercepted, 4);
  assert.equal(lastPolicy.sandbox.type, 'workspaceWrite');
  assert.equal(lastPolicy.sandbox.networkAccess, false);
  assert.equal(lastPolicy.sandbox.writableRoots.length, 1); // cwd is implicit
  assert.match(lastPolicy.sandbox.writableRoots[0], /ccboard-stage-/);
  const resumedId = identity.threadId;
  await new Promise(resolve => setTimeout(resolve, 300));
  await assert.rejects(runCodexStage({ bin, home, cwd: home, role: 'coding', resumeThreadId: resumedId, resumeScratchDir: identity.scratchDir, prompt: 'Resume probe only', schema: {}, spawnProcess: guardedSpawn, onIdentity: x => identity = x }), e => { assert.match(e.message, /PROBE_NO_MODEL_TURN/, JSON.stringify(lastPolicy)); return true; });
  assert.equal(identity.threadId, resumedId); assert.equal(intercepted, 5);
  console.log('PASS: installed Codex initialized, read-only thread created, MCP disabled and no usable external tools; turn/start intercepted, zero model calls.');
} finally { [process.env.TEMP, process.env.TMP, process.env.TMPDIR] = originalTemp; }
