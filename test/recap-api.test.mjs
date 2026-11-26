// Read-only HTTP integration; isolated synthetic transcripts, no model or business operations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fs.mkdtempSync('D:/ChatGPT-Temp/ccboard-recap-20261125/api-');
const home = path.join(root, 'home'), data = path.join(root, 'data');
const dir = path.join(home, '.codex/sessions/2026/11/25'); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(data);
fs.writeFileSync(path.join(data, 'config.json'), '{"codex":true}');
const sid = '019abcde-0000-7000-8000-000000000010', file = path.join(dir, `rollout-2026-11-25T00-00-00-${sid}.jsonl`);
const at = '2026-11-25T00:00:00Z';
const message = (role, text) => ({ type: 'response_item', timestamp: at, payload: { type: 'message', role, ...(role === 'assistant' ? { phase: 'final_answer' } : {}), content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
const original = [
  { type: 'session_meta', timestamp: at, payload: { id: sid, cwd: home, timestamp: at, source: 'cli', originator: 'codex_cli_rs' } },
  message('user', 'Explain house-price features.'), message('assistant', 'Both categorical and numerical features work.'),
  { type: 'event_msg', timestamp: at, payload: { type: 'task_complete', last_agent_message: 'Both categorical and numerical features work.' } },
].map(JSON.stringify).join('\n') + '\n'; fs.writeFileSync(file, original);
const port = 14849;
const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { windowsHide: true, env: { ...process.env, USERPROFILE: home, HOME: home, CODEX_HOME: path.join(home, '.codex'), CCBOARD_DATA: data, CCBOARD_PORT: String(port), TEMP: root, TMP: root, TMPDIR: root }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x);
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { const h = await (await fetch(base + '/health')).json(); assert.equal(h.data, data); ready = true; break; } catch { await new Promise(r => setTimeout(r, 80)); } }
  assert.ok(ready, logs);
  const token = fs.readFileSync(path.join(data, '.token'), 'utf8').trim();
  const get = async (url, auth = token) => { const response = await fetch(base + url, { headers: { 'x-ccboard': auth } }); return { status: response.status, data: await response.json() }; };
  const before = (await get('/api/state')).data;
  assert.equal((await get('/api/recap?sid=' + sid, 'invalid')).status, 403);
  assert.equal((await get('/api/recap?sid=../../arbitrary')).data.status, 'unavailable');
  const recap = (await get('/api/recap?sid=' + sid)).data;
  assert.equal(recap.ok, true); assert.equal(recap.recap.goal.text, 'Explain house-price features.');
  assert.equal(recap.messages.length, 2); assert.ok(recap.messages[1].final);
  assert.equal((await get('/api/turns?sid=' + sid)).data.turns.length, 1, 'Windows separator must select Codex parser');
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'recap must not write original transcript');
  const after = (await get('/api/state')).data;
  assert.deepEqual(after.processed, before.processed); assert.equal(after.sessions[0].done, before.sessions[0].done);
  assert.equal((await get('/api/recap?check=1&sid=' + sid + '&version=' + recap.version)).data.stale, false);
  fs.appendFileSync(file, JSON.stringify(message('user', 'Now compare OLS and gradient descent.')) + '\n');
  assert.equal((await get('/api/recap?check=1&sid=' + sid + '&version=' + recap.version)).data.stale, true);
  const newer = (await get('/api/recap?sid=' + sid)).data;
  assert.notEqual(newer.version, recap.version); assert.equal(newer.messages.at(-1).role, 'user');
  fs.unlinkSync(file); // only the synthetic fixture
  assert.equal((await get('/api/recap?sid=' + sid)).data.status, 'missing');
  console.log('PASS: authenticated read-only recap API, source version changes, missing history and Windows detail parser.');
} finally { child.kill(); }
