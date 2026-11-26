// Extractive, read-only transcript recap. No model calls and no claims of verified completion.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const cache = new Map(), inFlight = new Map();
const CACHE_ENTRIES = 4, CACHE_BYTES = 16 << 20;
let cachedBytes = 0;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const signature = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const int = (value, fallback, min, max) => { const n = value ?? fallback; if (!Number.isSafeInteger(n) || n < min || n > max) throw new TypeError('Invalid recap limit.'); return n; };

function prefix(text, bytes) {
  const buffer = Buffer.from(text);
  if (buffer.length <= bytes) return { text, bytes: buffer.length, truncated: false };
  let end = bytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return { text: buffer.subarray(0, end).toString('utf8'), bytes: end, truncated: true };
}

// Remove known automatic wrappers, not arbitrary XML/HTML the user may have asked about.
function userContent(value) {
  let text = value;
  if (/^\s*#\s*AGENTS\.md instructions\b/i.test(text)) {
    if (!/<INSTRUCTIONS\b/i.test(text)) return '';
    text = text.replace(/^\s*#\s*AGENTS\.md instructions[^\n]*(?:\n|$)/i, '');
  }
  text = text.replace(/<(INSTRUCTIONS|environment_context|permissions instructions|collaboration_mode|app-context|skills_instructions|codex_apps_client_time_context|turn_aborted|task-notification|system-reminder|user_instructions|developer_instructions)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  if (/^\s*<(?:environment_context|INSTRUCTIONS|system-reminder|task-notification|codex_delegation|subagent_notification|context|analysis|permissions\b|developer\b|system\b)/i.test(text)) return '';
  if (/^\s*\[Request interrupted by user(?:\]|[^\]]*\])/i.test(text)) return '';
  return text;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block && ['text', 'input_text', 'output_text'].includes(block.type) && typeof block.text === 'string').map(block => block.text).join('\n');
}

function extract(record, provider) {
  if (!record || typeof record !== 'object') return null;
  if (provider === 'codex') {
    const p = record.payload || {};
    if (record.type === 'response_item' && p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
      if (p.role === 'assistant' && p.channel === 'analysis') return null;
      const text = contentText(p.content);
      return { role: p.role, text, kind: 'response', phase: p.phase || p.channel || null, final: p.role === 'assistant' && ['final', 'final_answer'].includes(p.phase || p.channel) };
    }
    if (record.type === 'event_msg' && ['user_message', 'agent_message'].includes(p.type) && typeof p.message === 'string') return {
      role: p.type === 'user_message' ? 'user' : 'assistant', text: p.message, kind: p.type, phase: p.phase || null, final: ['final', 'final_answer'].includes(p.phase),
    };
    if (record.type === 'event_msg' && p.type === 'task_complete') return { role: 'assistant', text: typeof p.last_agent_message === 'string' ? p.last_agent_message : '', kind: 'task_complete', phase: 'final', final: true };
    return null;
  }
  if (record.isSidechain || record.isMeta || record.isCompactSummary || record.isApiErrorMessage || !['user', 'assistant'].includes(record.type)) return null;
  const message = record.message || {};
  if (message.model === '<synthetic>') return null;
  if (record.type === 'user' && ((record.origin && record.origin.kind !== 'human') || (record.turnOrigin && record.turnOrigin !== 'human') || (Array.isArray(message.content) && message.content.some(b => b?.type === 'tool_result')))) return null;
  return { role: record.type, text: contentText(message.content), kind: 'claude', phase: message.stop_reason || null,
    final: record.type === 'assistant' && ['end_turn', 'stop_sequence'].includes(message.stop_reason) };
}

function quote(message, label) {
  if (!message) return null;
  const bytes = Buffer.byteLength(message.text);
  let text = message.text;
  if (bytes > 1800) {
    const buffer = Buffer.from(message.text); let from = buffer.length - 900;
    while (from < buffer.length && (buffer[from] & 0xc0) === 0x80) from++;
    text = prefix(message.text, 900).text + '\n[…中间原文省略，展开来源查看…]\n' + buffer.subarray(from).toString('utf8');
  }
  return { messageId: message.id, text, at: message.at, label,
    excerptTruncated: Buffer.byteLength(message.text) > 1800 || message.textTruncated };
}

function extractedRecap(messages) {
  messages = messages.filter(m => !m.inherited);
  const users = messages.filter(m => m.role === 'user');
  const last = messages.at(-1); let user = last?.role === 'user' ? last : null;
  const assistant = last?.role === 'assistant' ? last : null;
  let pairingUncertain = false;
  if (assistant) {
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].segment !== assistant.segment || messages[i + 1].sequence !== messages[i].sequence + 1) { pairingUncertain = true; break; }
      if (messages[i].role === 'user') { user = messages[i]; break; }
    }
    if (!user) pairingUncertain = true;
  }
  const turns = [];
  let current = null, previous = null;
  for (const message of messages) {
    const contiguous = previous && previous.segment === message.segment && previous.sequence + 1 === message.sequence;
    if (!contiguous || message.role === 'user') {
      current = { user: message.role === 'user' ? quote(message, '用户请求') : null, assistants: [], messageIds: [], pairingUncertain: message.role !== 'user' };
      turns.push(current);
    }
    current.messageIds.push(message.id);
    if (message.role === 'assistant') current.assistants.push(message);
    previous = message;
  }
  const preferred = messages.filter(m => m.role === 'user' || m.final);
  const recent = (preferred.length >= 4 ? preferred : messages).slice(-6);
  return {
    goal: quote(users[0], '首条可读取的实质用户请求'),
    background: users.slice(1, 4).map(m => quote(m, '早期后续请求（原文摘录）')),
    reportedWork: messages.filter(m => m.role === 'assistant' && m.final).slice(-3).map(m => quote(m, '助手曾报告（未独立验证）')),
    recentContext: recent.map(m => quote(m, m.role === 'user' ? '最近用户请求' : '最近助手回复（未独立验证）')),
    stoppingPoint: { user: quote(user, '最近相关用户请求'), assistant: quote(assistant, '最后相关助手文本'), pairingUncertain },
    pending: { user: quote(user, '对应用户请求'), assistant: quote(assistant, '对应助手文本'),
      contextTurns: turns.slice(-3).map(turn => ({ user: turn.user, assistant: quote(turn.assistants.findLast(m => m.final) || turn.assistants.at(-1), '助手原文（优先本轮最终回复）'),
        messageIds: turn.messageIds, pairingUncertain: turn.pairingUncertain })), assessment: '最近交流：无法仅凭日志摘录判断是否仍需回答或任务是否完成。', pairingUncertain },
  };
}

function emptyResult(file, provider, status, error) {
  return freeze({ ok: false, status, version: null, source: { file, provider }, error,
    coverage: { complete: false, truncated: false, malformedLines: 0, incompleteTail: false, segments: [], omittedBytes: 0, changedDuringRead: false }, messages: [], recap: extractedRecap([]) });
}

async function parseFile(file, provider, limits, initialStat, version) {
  let handle;
  try { handle = await fs.open(file, 'r'); } catch (e) { return emptyResult(file, provider, e.code === 'ENOENT' ? 'missing' : 'unreadable', { code: e.code || 'READ_ERROR', message: '无法读取会话日志。' }); }
  const coverage = { complete: true, truncated: initialStat.size > limits.maxBytes, malformedLines: 0, incompleteTail: false, segments: [], omittedBytes: 0,
    changedDuringRead: false, bytesRead: 0, parsedLines: 0, ignoredRecords: 0, duplicateMessages: 0, filteredMessages: 0, totalMessages: 0,
    omittedMessages: 0, omittedTextBytes: 0, totalTextBytes: 0, textTruncatedMessages: 0, malformedSamples: [], contextBoundary: null };
  const first = [], tail = [], pending = [];
  let firstBytes = 0, tailBytes = 0, firstOpen = true, sequence = 0;
  const firstCount = Math.ceil(limits.maxMessages / 2), tailCount = Math.floor(limits.maxMessages / 2), firstBudget = Math.ceil(limits.maxTextBytes / 2), tailBudget = Math.floor(limits.maxTextBytes / 2);
  function retain(candidate) {
    const { fingerprint, seenKinds, kind, bytes, ...message } = candidate;
    message.sequence = sequence++; coverage.totalMessages++; coverage.totalTextBytes += message.sourceTextBytes;
    if (message.textTruncated) coverage.textTruncatedMessages++;
    if (firstOpen && first.length < firstCount && firstBytes + bytes <= firstBudget) { first.push(message); firstBytes += bytes; return; }
    firstOpen = false; tail.push(message); tailBytes += bytes;
    while (tail.length > tailCount || tailBytes > tailBudget) { const removed = tail.shift(); tailBytes -= Buffer.byteLength(removed.text); }
  }
  function flush() { while (pending.length) retain(pending.shift()); }
  function candidate(record, coordinate) {
    if (provider === 'codex' && record?.type === 'event_msg' && ['task_started', 'turn_started', 'turn_aborted'].includes(record.payload?.type)) {
      flush(); coverage.ignoredRecords++; return;
    }
    const entry = extract(record, provider);
    if (!entry) { coverage.ignoredRecords++; return; }
    if (entry.role === 'user' && /^\s*Side conversation boundary\.\s*\n\s*Everything before this boundary is inherited history\b/i.test(entry.text)) {
      flush();
      coverage.contextBoundary = { byteOffset: coordinate.byteOffset, line: coordinate.line, at: record.timestamp || null,
        note: '界限之前为继承历史，回顾目标采用界限之后的首条实质用户请求。' };
      coverage.filteredMessages++; return;
    }
    if (entry.kind === 'task_complete' && !entry.text) {
      const last = pending.at(-1);
      if (last?.role === 'assistant' && last.phase !== 'commentary') { last.final = true; last.completionSource = coordinate.byteOffset; }
      flush(); return;
    }
    const original = entry.role === 'user' ? userContent(entry.text) : entry.text;
    if (!original.trim()) { coverage.filteredMessages++; return; }
    const fingerprint = digest(entry.role + '\0' + original.trim());
    const cut = prefix(original, limits.maxMessageBytes);
    const next = { ...coordinate, id: 'm-' + coordinate.byteOffset, role: entry.role, text: cut.text, at: typeof record.timestamp === 'string' ? record.timestamp : null,
      phase: entry.phase, final: entry.final, kind: entry.kind, fingerprint, seenKinds: new Set([entry.kind]), bytes: cut.bytes,
      textTruncated: cut.truncated, sourceTextBytes: Buffer.byteLength(original) };
    // Only adjacent conversational representations can be paired without a shared
    // message identity. Searching older turns would erase a repeated real request.
    const previous = pending.at(-1);
    const match = provider === 'codex' && previous?.fingerprint === fingerprint && !previous.seenKinds.has(entry.kind) ? previous : null;
    if (match) {
      coverage.duplicateMessages++; match.seenKinds.add(entry.kind); match.final ||= entry.final;
      if (entry.kind === 'task_complete') match.completionSource = coordinate.byteOffset;
      if (entry.kind === 'response') {
        const previousFinal = match.final, kinds = match.seenKinds, completion = match.completionSource;
        pending.splice(pending.indexOf(match), 1);
        Object.assign(next, { final: previousFinal, seenKinds: kinds, ...(completion != null ? { completionSource: completion } : {}) }); pending.push(next);
      }
      if (entry.kind === 'task_complete') flush();
      return;
    }
    pending.push(next);
    if (pending.length > 64) retain(pending.shift());
    if (entry.kind === 'task_complete') flush();
  }
  const size = initialStat.size;
  const ranges = size <= limits.maxBytes ? [[0, size, 'full']] : [[0, Math.ceil(limits.maxBytes / 2), 'head'], [size - Math.floor(limits.maxBytes / 2), size, 'tail']];
  try {
    const opened = await handle.stat();
    if (signature(opened) !== signature(initialStat)) coverage.changedDuringRead = true;
    for (const [from, to, name] of ranges) {
      flush();
      const segment = { name, requestedFrom: from, requestedTo: to, parsedFrom: from, parsedTo: from, skippedStartBytes: 0, skippedEndBytes: 0 };
      coverage.segments.push(segment);
      let offset = from, lineStart = from, line = from === 0 ? 1 : null, chunks = [], length = 0, skip = from > 0;
      if (skip) { const previous = Buffer.alloc(1); const read = await handle.read(previous, 0, 1, from - 1); coverage.bytesRead += read.bytesRead; skip = previous[0] !== 10; }
      const processLine = (buffer, start, globalLine, terminated) => {
        let text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
        if (!text) return;
        let record;
        try { record = JSON.parse(text); } catch {
          flush(); // An unreadable line may itself contain a conversational boundary.
          sequence++; // Do not pair a later assistant with a user across unknown content.
          if (!terminated && to === size) coverage.incompleteTail = true;
          else { coverage.malformedLines++; if (coverage.malformedSamples.length < 5) coverage.malformedSamples.push({ line: globalLine, byteOffset: start }); }
          return;
        }
        coverage.parsedLines++;
        candidate(record, { line: globalLine, byteOffset: start, segment: name });
      };
      while (offset < to) {
        const buffer = Buffer.allocUnsafe(Math.min(65536, to - offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) { coverage.changedDuringRead = true; break; }
        coverage.bytesRead += bytesRead;
        let cursor = 0;
        while (cursor < bytesRead) {
          const found = buffer.indexOf(10, cursor), end = found >= 0 && found < bytesRead ? found : bytesRead;
          const part = buffer.subarray(cursor, end);
          if (!skip && part.length) { chunks.push(part); length += part.length; }
          if (end < bytesRead) {
            if (skip) { segment.skippedStartBytes = offset + end + 1 - from; segment.parsedFrom = offset + end + 1; skip = false; }
            else processLine(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length), lineStart, line, true);
            chunks = []; length = 0; lineStart = offset + end + 1; if (line != null) line++; segment.parsedTo = lineStart;
          }
          cursor = end + 1;
        }
        offset += bytesRead;
      }
      if (length && to === size && !skip) { processLine(Buffer.concat(chunks, length), lineStart, line, false); segment.parsedTo = offset; }
      else if (length || skip) segment.skippedEndBytes = offset - lineStart;
      flush();
    }
    const finalStat = await fs.stat(file);
    if (signature(finalStat) !== signature(initialStat)) coverage.changedDuringRead = true;
  } catch (e) {
    return emptyResult(file, provider, e.code === 'ENOENT' ? 'missing' : 'unreadable', { code: e.code || 'READ_ERROR', message: '读取会话日志过程中失败，未返回不完整的成功结果。' });
  } finally { await handle.close(); }
  const messages = first.concat(tail).sort((a, b) => a.byteOffset - b.byteOffset);
  if (coverage.contextBoundary) for (const message of messages) message.inherited = message.byteOffset < coverage.contextBoundary.byteOffset;
  coverage.omittedMessages = coverage.totalMessages - messages.length;
  coverage.omittedTextBytes = coverage.totalTextBytes - messages.reduce((sum, m) => sum + Buffer.byteLength(m.text), 0);
  coverage.omittedBytes = size - coverage.segments.reduce((sum, s) => sum + Math.max(0, s.parsedTo - s.parsedFrom), 0);
  coverage.truncated ||= coverage.omittedMessages > 0 || coverage.textTruncatedMessages > 0 || coverage.incompleteTail;
  coverage.complete = !coverage.truncated && !coverage.malformedLines && !coverage.changedDuringRead;
  const status = coverage.truncated ? 'truncated' : coverage.malformedLines ? 'malformed' : messages.length ? 'ready' : 'empty';
  return freeze({ ok: true, status, version, source: { file, provider, size, mtimeMs: initialStat.mtimeMs }, coverage, messages, recap: extractedRecap(messages) });
}

export async function readRecap(file, options = {}) {
  const provider = options.provider || 'codex';
  if (!['codex', 'claude'].includes(provider)) throw new TypeError('Unsupported transcript provider.');
  if (typeof file !== 'string' || !file) return emptyResult(null, provider, 'missing', { code: 'NO_PATH', message: '没有可读取的会话日志路径。' });
  file = path.resolve(file);
  const maxTextBytes = int(options.maxTextBytes, 4 << 20, 128, 8 << 20);
  const limits = { maxBytes: int(options.maxBytes, 32 << 20, 256, 64 << 20), maxMessages: int(options.maxMessages, 2000, 2, 10000), maxTextBytes,
    maxMessageBytes: Math.min(int(options.maxMessageBytes, 1 << 20, 64, 4 << 20), Math.floor(maxTextBytes / 2)) };
  let stat;
  try { stat = await fs.stat(file); if (!stat.isFile()) return emptyResult(file, provider, 'unreadable', { code: 'NOT_FILE', message: '会话日志路径不是普通文件。' }); }
  catch (e) { return emptyResult(file, provider, e.code === 'ENOENT' ? 'missing' : 'unreadable', { code: e.code || 'STAT_ERROR', message: '无法访问会话日志。' }); }
  const version = digest(signature(stat));
  const key = JSON.stringify([file, provider, limits]);
  const found = cache.get(key);
  if (found?.result.version === version) { cache.delete(key); cache.set(key, found); return found.result; }
  if (found) { cache.delete(key); cachedBytes -= found.bytes; }
  const flightKey = key + ':' + version;
  if (inFlight.has(flightKey)) return inFlight.get(flightKey);
  const request = parseFile(file, provider, limits, stat, version).then(result => {
    if (result.ok && !result.coverage.changedDuringRead) {
      const bytes = result.messages.reduce((sum, m) => sum + Buffer.byteLength(m.text) * 2 + 512, 0) + 65536;
      const previous = cache.get(key); if (previous) cachedBytes -= previous.bytes;
      cache.delete(key); cache.set(key, { result, bytes }); cachedBytes += bytes;
      while (cache.size > CACHE_ENTRIES || cachedBytes > CACHE_BYTES) { const old = cache.keys().next().value; cachedBytes -= cache.get(old).bytes; cache.delete(old); }
    }
    return result;
  }).finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, request);
  return request;
}
