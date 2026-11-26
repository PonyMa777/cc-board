// Synthetic logs only. Tests never read or write real user chats.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readRecap } from '../recap.mjs';

const root = await fs.mkdtemp('D:/ChatGPT-Temp/ccboard-recap-20261125/run-');
const at = '2026-11-25T00:00:00Z';
const response = (role, text, phase) => ({ timestamp: at, type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }], ...(phase ? { phase } : {}) } });
const event = (type, message) => ({ timestamp: at, type: 'event_msg', payload: { type, ...(type === 'task_complete' ? { last_agent_message: message } : { message }) } });
let passed = 0;
async function write(name, rows) { const file = path.join(root, name + '.jsonl'); await fs.writeFile(file, rows.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n'); return file; }
async function test(label, fn) { await fn(); passed++; console.log('ok ' + label); }

await test('extracts first real goal, full text order, and source-linked final reports', async () => {
  const file = await write('basic', [
    { type: 'session_meta', payload: { id: 'fixture' } },
    response('developer', 'Do not display developer instructions'),
    response('user', '# AGENTS.md instructions\n<INSTRUCTIONS>automatic rules</INSTRUCTIONS>'),
    response('user', '<environment_context>automatic cwd</environment_context>'),
    response('user', 'Create a housing model with 14 features.'),
    response('assistant', 'I am checking the data.', 'commentary'),
    { type: 'response_item', payload: { type: 'function_call_output', output: 'never display this tool output' } },
    response('assistant', 'I fitted the model; see results.csv.', 'final_answer'),
    response('user', 'Why use gradient descent when OLS is available?'),
    response('assistant', 'What is it useful for? Teaching how a model learns, not an advantage for this small linear model.', 'final_answer'),
  ]);
  const r = await readRecap(file);
  assert.equal(r.status, 'ready'); assert.equal(r.coverage.complete, true); assert.equal(r.messages.length, 5);
  assert.equal(r.recap.goal.text, 'Create a housing model with 14 features.'); assert.equal(r.recap.reportedWork.length, 2);
  assert.ok(r.recap.reportedWork.every(q => q.label.includes('未独立验证')));
  assert.ok(!r.recap.reportedWork.some(q => q.text.includes('checking')));
  assert.equal(r.recap.pending.user.text, 'Why use gradient descent when OLS is available?');
  assert.match(r.recap.pending.assessment, /无法/); assert.equal(r.recap.pending.contextTurns.length, 2);
  assert.equal(r.messages[0].line, 5); assert.ok(r.messages.every(m => m.id === 'm-' + m.byteOffset));
  const data = await fs.readFile(file);
  assert.equal(JSON.parse(data.subarray(r.messages[0].byteOffset).toString().split('\n')[0]).payload.role, 'user');
});
await test('event and response duplicates collapse, genuinely repeated messages remain', async () => {
  const file = await write('dedup', [event('user_message', 'same request'), response('user', 'same request'),
    response('assistant', 'same answer', 'final_answer'), event('agent_message', 'same answer'), event('task_complete', 'same answer'),
    response('user', 'same request'), event('user_message', 'same request'),
    event('agent_message', 'same answer'), response('assistant', 'same answer', 'final_answer'), event('task_complete', 'same answer')]);
  const r = await readRecap(file); assert.deepEqual(r.messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(r.coverage.duplicateMessages, 6); assert.equal(new Set(r.messages.map(m => m.id)).size, 4);
});
await test('event-only logs remain available without duplicate task completion text', async () => {
  const r = await readRecap(await write('event-only', [event('user_message', 'event goal'), event('agent_message', 'event result'), event('task_complete', 'event result')]));
  assert.equal(r.messages.length, 2); assert.equal(r.messages[1].final, true); assert.equal(r.recap.reportedWork.length, 1);
});
await test('mixed missing representations do not erase a repeated user in the next turn', async () => {
  const r = await readRecap(await write('mixed-repeated-user', [response('user', 'Repeat this'), response('assistant', 'First reply'),
    event('user_message', 'Repeat this'), event('agent_message', 'Second reply')]));
  assert.deepEqual(r.messages.map(m => [m.role, m.text]), [['user', 'Repeat this'], ['assistant', 'First reply'], ['user', 'Repeat this'], ['assistant', 'Second reply']]);
  assert.equal(r.coverage.duplicateMessages, 0);
  assert.equal(r.recap.pending.user.messageId, r.messages[2].id);
});
await test('deduplication stops at task and side-conversation boundaries', async () => {
  const start = { type: 'event_msg', payload: { type: 'task_started', turn_id: 'next-turn' } };
  const started = await readRecap(await write('task-start-dedup', [response('user', 'Repeat this'), start, event('user_message', 'Repeat this')]));
  assert.equal(started.messages.length, 2); assert.equal(started.coverage.duplicateMessages, 0);
  const completed = await readRecap(await write('task-complete-dedup', [response('assistant', 'Same reply'), event('task_complete', 'Same reply'), event('agent_message', 'Same reply')]));
  assert.equal(completed.messages.length, 2); assert.equal(completed.coverage.duplicateMessages, 1);
  const boundary = response('user', 'Side conversation boundary.\n\nEverything before this boundary is inherited history.');
  const side = await readRecap(await write('side-boundary-dedup', [response('user', 'Repeat this'), boundary, event('user_message', 'Repeat this')]));
  assert.equal(side.messages.length, 2); assert.equal(side.coverage.duplicateMessages, 0); assert.equal(side.recap.goal.messageId, side.messages[1].id);
});
await test('distinct intervening same-role messages also prevent text-only deduplication', async () => {
  const r = await readRecap(await write('intervening-same-role', [response('user', 'Repeat this'), response('user', 'A different request'), event('user_message', 'Repeat this')]));
  assert.deepEqual(r.messages.map(m => m.text), ['Repeat this', 'A different request', 'Repeat this']); assert.equal(r.coverage.duplicateMessages, 0);
});
await test('malformed lines break both deduplication and user-assistant pairing', async () => {
  const r = await readRecap(await write('malformed-pairing', [response('user', 'Known earlier request'), '{possibly a missing later user', response('assistant', 'A later answer', 'final_answer')]));
  assert.equal(r.coverage.malformedLines, 1); assert.equal(r.recap.pending.pairingUncertain, true); assert.equal(r.recap.pending.user, null);
  assert.equal(r.recap.pending.contextTurns.at(-1).pairingUncertain, true); assert.equal(r.recap.pending.contextTurns.at(-1).user, null);
  const repeated = await readRecap(await write('malformed-dedup', [response('user', 'Repeated request'), '{unknown content', event('user_message', 'Repeated request')]));
  assert.equal(repeated.messages.length, 2); assert.equal(repeated.coverage.duplicateMessages, 0);
});
await test('known wrappers are stripped while genuine HTML requests remain', async () => {
  const r = await readRecap(await write('wrappers', [response('user', '<environment_context>automatic</environment_context>\nPlease explain this code.'),
    response('user', '<div>Fix this HTML component</div>'), response('user', '<task-notification>auto task result</task-notification>'),
    response('assistant', 'Still investigating.', 'commentary'), event('task_complete', undefined)]));
  assert.equal(r.messages.length, 3); assert.match(r.messages[0].text, /Please explain/); assert.ok(r.messages[1].text.startsWith('<div>'));
  assert.equal(r.recap.reportedWork.length, 0);
  const bundled = await readRecap(await write('bundled-instructions', [response('user', '# AGENTS.md instructions\n<INSTRUCTIONS>automatic rules</INSTRUCTIONS>\n<environment_context>automatic cwd</environment_context>\nActual user task follows the wrappers.')]));
  assert.equal(bundled.messages.length, 1); assert.match(bundled.recap.goal.text, /Actual user task/); assert.ok(!bundled.recap.goal.text.includes('automatic'));
});
await test('side-conversation boundary excludes inherited goals without hiding their history', async () => {
  const r = await readRecap(await write('boundary', [response('user', 'Inherited old goal'), response('assistant', 'Inherited result', 'final_answer'),
    response('user', 'Side conversation boundary.\n\nEverything before this boundary is inherited history. Continue below.'),
    response('user', 'New housing model goal'), response('assistant', 'New result', 'final_answer')]));
  assert.equal(r.messages.length, 4); assert.equal(r.messages[0].inherited, true); assert.ok(r.coverage.contextBoundary);
  assert.equal(r.recap.goal.text, 'New housing model goal'); assert.equal(r.recap.reportedWork.length, 1); assert.equal(r.recap.recentContext.length, 2);
});
await test('reads beginning beyond the old four-megabyte tail limitation', async () => {
  const file = await write('large-complete', [response('user', 'Original goal before a large tool record'),
    { type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(5 << 20) } }, response('assistant', 'Latest final answer', 'final_answer')]);
  const r = await readRecap(file); assert.equal(r.coverage.complete, true); assert.equal(r.messages.length, 2); assert.match(r.recap.goal.text, /Original goal/);
});
await test('bounded file reads keep first and last segments and disclose missing middle', async () => {
  const rows = [response('user', 'Initial goal')]; for (let i = 0; i < 100; i++) rows.push(response('assistant', 'middle ' + i + ' ' + 'x'.repeat(100), 'commentary'));
  rows.push(response('user', 'Final request'), response('assistant', 'Final answer', 'final_answer'));
  const r = await readRecap(await write('segments', rows), { maxBytes: 1600 });
  assert.equal(r.status, 'truncated'); assert.equal(r.coverage.complete, false); assert.ok(r.coverage.omittedBytes > 0);
  assert.match(r.recap.goal.text, /Initial goal/); assert.equal(r.messages.at(-1).text, 'Final answer');
  assert.equal(r.messages.at(-1).line, null); assert.equal(r.messages[0].line, 1); assert.ok(r.coverage.bytesRead <= 1601);
});
await test('message count retention keeps head and tail and never fabricates pairing over a gap', async () => {
  const rows = [response('user', 'Only user request')]; for (let i = 0; i < 12; i++) rows.push(response('assistant', 'answer ' + i, 'final_answer'));
  const r = await readRecap(await write('message-limit', rows), { maxMessages: 4 });
  assert.equal(r.messages.length, 4); assert.equal(r.coverage.omittedMessages, 9); assert.equal(r.messages.at(-1).text, 'answer 11');
  assert.equal(r.recap.pending.user, null); assert.equal(r.recap.pending.pairingUncertain, true); assert.equal(r.status, 'truncated');
});
await test('text limits are UTF-8 safe and explicitly incomplete', async () => {
  const r = await readRecap(await write('text-limits', [response('user', '目标'.repeat(400)), response('assistant', '结果'.repeat(400), 'final_answer')]), { maxTextBytes: 256, maxMessageBytes: 128 });
  assert.equal(r.messages.length, 2); assert.ok(r.messages.every(m => m.textTruncated));
  assert.ok(r.messages.every(m => !m.text.includes('\ufffd'))); assert.ok(r.coverage.omittedTextBytes > 0); assert.equal(r.status, 'truncated');
});
await test('long quoted replies retain head and ending advice with source reference', async () => {
  const reply = 'Opening answer. ' + 'detail '.repeat(700) + ' Ending recommendation.';
  const r = await readRecap(await write('excerpt', [response('user', 'Need context'), response('assistant', reply, 'final_answer')]));
  assert.equal(r.messages[1].text, reply); assert.match(r.recap.pending.assistant.text, /Opening answer/); assert.match(r.recap.pending.assistant.text, /Ending recommendation/);
  assert.equal(r.recap.pending.assistant.messageId, r.messages[1].id); assert.equal(r.recap.pending.assistant.excerptTruncated, true);
});
await test('missing, unreadable, empty, malformed and incomplete logs are distinct', async () => {
  assert.equal((await readRecap(path.join(root, 'missing.jsonl'))).status, 'missing');
  assert.equal((await readRecap(root)).status, 'unreadable');
  assert.equal((await readRecap(await write('empty', []))).status, 'empty');
  const malformed = await readRecap(await write('malformed', ['{broken}', response('user', 'Still readable')]));
  assert.equal(malformed.status, 'malformed'); assert.equal(malformed.coverage.malformedLines, 1); assert.equal(malformed.messages.length, 1);
  const file = await write('partial', [response('user', 'Readable before pending write')]); await fs.appendFile(file, '{"type":"response_item"');
  const partial = await readRecap(file); assert.equal(partial.status, 'truncated'); assert.equal(partial.coverage.incompleteTail, true); assert.equal(partial.coverage.malformedLines, 0);
});
await test('Claude logs include only human and assistant text, not tools or sidechains', async () => {
  const r = await readRecap(await write('claude', [
    { type: 'user', timestamp: at, message: { content: 'Claude human goal' } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'tool secret' }] } },
    { type: 'user', origin: { kind: 'peer' }, message: { content: 'peer instruction' } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'sidechain' }] } },
    { type: 'assistant', timestamp: at, message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Claude result' }, { type: 'tool_use', name: 'hidden' }] } },
  ]), { provider: 'claude' });
  assert.deepEqual(r.messages.map(m => m.text), ['Claude human goal', 'Claude result']); assert.equal(r.recap.reportedWork.length, 1);
});
await test('stat version cache is immutable, singleflight, and refreshed after source changes', async () => {
  const file = await write('cache', [response('user', 'Cache goal')]); const originalOpen = fs.open; let opens = 0;
  fs.open = async (...args) => { opens++; await new Promise(r => setTimeout(r, 15)); return originalOpen(...args); };
  let first;
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => readRecap(file))); first = results[0]; assert.equal(opens, 1); assert.ok(results.every(r => r === first));
    assert.equal(Object.isFrozen(first.messages[0]), true); assert.equal(await readRecap(file), first);
  } finally { fs.open = originalOpen; }
  await fs.appendFile(file, JSON.stringify(response('assistant', 'New answer', 'final_answer')) + '\n');
  const next = await readRecap(file); assert.notEqual(next.version, first.version); assert.equal(next.messages.length, 2); assert.equal(next.messages[0].id, first.messages[0].id);
});
await test('LRU evicts old entries rather than retaining every full transcript', async () => {
  const files = []; for (let i = 0; i < 5; i++) files.push(await write('lru' + i, [response('user', 'LRU ' + i)]));
  const first = await readRecap(files[0]); for (const f of files.slice(1)) await readRecap(f);
  assert.notEqual(await readRecap(files[0]), first);
});
await test('source changing during read is flagged and not cached as a current snapshot', async () => {
  const file = await write('changing', [response('user', 'Initial')]); const originalOpen = fs.open; let appended = false;
  fs.open = async (...args) => { const handle = await originalOpen(...args); const originalRead = handle.read.bind(handle);
    handle.read = async (...readArgs) => { if (!appended) { appended = true; await fs.appendFile(file, JSON.stringify(response('assistant', 'Concurrent update', 'final_answer')) + '\n'); } return originalRead(...readArgs); }; return handle; };
  let result; try { result = await readRecap(file); } finally { fs.open = originalOpen; }
  assert.equal(result.coverage.changedDuringRead, true); assert.equal(result.coverage.complete, false);
  const next = await readRecap(file); assert.notEqual(next.version, result.version); assert.equal(next.messages.length, 2);
});
console.log(`PASS ${passed} recap tests; synthetic fixtures: ${root}`);
