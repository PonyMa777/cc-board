import { codexRequest } from './codex-rpc.mjs';

// Explicit user-authorized strongest model. Availability is verified, never inferred
// from the account's default or silently replaced by another model.
export const CHIEF_MODEL = 'gpt-6.2-astra';
export async function resolveChiefModel(bin, home, request = codexRequest) {
  let cursor, found; const cursors = new Set();
  do {
    const page = await request(bin, home, 'model/list', { limit: 100, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page.data)) throw new Error('无法读取总负责人模型列表；未启动任务。');
    found ||= page.data.find(m => m.model === CHIEF_MODEL && !m.hidden);
    cursor = page.nextCursor;
    if (cursor && (cursors.has(cursor) || cursors.size >= 20)) throw new Error('模型列表分页异常；未启动任务。');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (!found) throw new Error('总负责人需要 ' + CHIEF_MODEL + '，当前账户未提供；不会自动降级。');
  if (!found.supportedReasoningEfforts?.some(e => e.reasoningEffort === 'high')) throw new Error('总负责人模型不支持所需 high 推理强度；未启动任务。');
  return { model: found.model, effort: 'high', reason: '用户指定最高能力模型；已通过本机 model/list 核对可用性。' };
}
