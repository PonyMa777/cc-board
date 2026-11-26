// Isolated Windows integration: never points at the user's Codex home.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { codexRequest } from '../codex-rpc.mjs';

const root = fs.mkdtempSync('D:/ChatGPT-Temp/ccboard-archive-test-');
const home = path.join(root, 'home'), data = path.join(root, 'data');
fs.mkdirSync(data, { recursive: true });
fs.writeFileSync(path.join(data, 'config.json'), '{"codex":true}');
const dir = path.join(home, '.codex/sessions/2026/11/25');
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(path.join(home, '.claude/sessions'), { recursive: true });
const sid = '019abcde-0000-7000-8000-000000000002';
const busyId = '019abcde-0000-7000-8000-000000000003';
function fixture(id, busy = false) {
  const file = path.join(dir, `rollout-2026-11-25T00-00-00-${id}.jsonl`);
  const rows = [{ type: 'session_meta', timestamp: '2026-11-25T00:00:00Z', payload: { id, timestamp: '2026-11-25T00:00:00Z', cwd: home, source: 'cli', originator: 'codex_cli_rs', cli_version: '0.0.0', model_provider: 'openai' } }];
  if (busy) rows.push({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_started', turn_id: 'fixture-turn' } });
  fs.writeFileSync(file, rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  return file;
}
const file = fixture(sid), busyFile = fixture(busyId, true);
const batch = ['019abcde-0000-7000-8000-000000000004', '019abcde-0000-7000-8000-000000000005', '019abcde-0000-7000-8000-000000000006'];
batch.forEach(id => fixture(id));
const bin = execFileSync('where.exe', ['codex.exe'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
const port = 14847;
const env = { ...process.env, USERPROFILE: home, HOME: home, CODEX_HOME: path.join(home, '.codex'), TEMP: root, TMP: root, TMPDIR: root, CCBOARD_DATA: data, CCBOARD_PORT: String(port) };
const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', b => logs += b); server.stderr.on('data', b => logs += b);
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { const h = await (await fetch(base + '/health')).json(); assert.equal(h.data, data); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(ready, logs);
  const token = fs.readFileSync(path.join(data, '.token'), 'utf8').trim();
  const api = async (url, body, auth = token) => {
    const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'x-ccboard': auth, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  for (let i = 0; i < 100; i++) {
    if ((await api('/api/state')).body.providers.codex?.ok) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal((await api('/api/archive', { sid }, 'bad')).status, 403);
  assert.equal((await api('/api/archive', { sid: '../invalid' })).body.ok, false);
  const before = (await api('/api/state')).body;
  assert.equal(before.home, home);
  assert.ok(before.sessions.some(x => x.sid === sid));
  assert.equal(before.sessions.find(x => x.sid === busyId).status, 'busy');
  assert.equal((await api('/api/archive', { sid: busyId, force: true })).body.ok, false);
  assert.ok(fs.existsSync(busyFile));
  const result = (await api('/api/archive', { sid })).body;
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.nativeArchive, true);
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.existsSync(path.join(home, '.codex/archived_sessions', path.basename(file))));
  assert.ok(!(await api('/api/state')).body.sessions.some(x => x.sid === sid));
  assert.equal((await api('/api/archive', { sid })).body.ok, false);
  assert.equal(fs.existsSync(path.join(data, 'archive.json')), false);
  for (const id of batch) assert.equal((await api('/api/archive', { sid: id })).body.ok, true);
  await new Promise(r => setTimeout(r, 1500));
  const afterBatch = (await api('/api/state')).body;
  assert.equal(afterBatch.crash, null); assert.deepEqual(afterBatch.lost, []);
  await assert.rejects(codexRequest(bin, home, 'thread/archive', { threadId: '019abcde-0000-7000-8000-000000000099' }));
  await assert.rejects(codexRequest('Z:/missing-codex.exe', home, 'thread/archive', { threadId: sid }));
  await assert.rejects(codexRequest(bin, home, 'thread/list', {}, { timeout: 1 }), /超时/);
  // Execute the real UI handler with fake services: no navigation and no optimistic removal.
  const html = fs.readFileSync(new URL('../ui.html', import.meta.url), 'utf8');
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  const handler = html.slice(html.indexOf('const archivePending = new Set();'), html.indexOf('async function doDelete('));
  let calls = 0, refreshes = 0, resolveRequest;
  const notices = [];
  const context = vm.createContext({ Set, api: () => { calls++; return new Promise(r => resolveRequest = r); }, toast: x => notices.push(x), refresh: () => refreshes++, T: x => x });
  vm.runInContext(handler, context);
  const first = context.doArchive({ sid }, false);
  await context.doArchive({ sid }, false); assert.equal(calls, 1); assert.equal(refreshes, 0);
  resolveRequest({ ok: true, nativeArchive: true }); await first; assert.equal(refreshes, 1);
  const failed = context.doArchive({ sid }, false); resolveRequest({ ok: false, error: 'fixture failure' }); await failed;
  assert.equal(notices.at(-1), 'fixture failure');
  console.log('PASS: authenticated API, real isolated Codex archive, busy protection, discovery refresh, errors, duplicate click and UI feedback.');
  console.log('Fixtures retained at ' + root);
} finally { server.kill(); }
