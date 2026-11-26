import assert from 'node:assert/strict';
import { resolveChiefModel, CHIEF_MODEL } from '../chief-model.mjs';
const strongest = { model: CHIEF_MODEL, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] };
let calls = 0;
const selected = await resolveChiefModel('unused', 'unused', async (_b, _h, method, params) => {
  assert.equal(method, 'model/list'); calls++;
  return params.cursor ? { data: [strongest], nextCursor: null } : { data: [{ model: 'default' }], nextCursor: 'next' };
});
assert.equal(calls, 2); assert.equal(selected.model, CHIEF_MODEL); assert.equal(selected.effort, 'high');
for (const data of [[], [{ ...strongest, hidden: true }], [{ ...strongest, supportedReasoningEfforts: [] }]]) {
  await assert.rejects(resolveChiefModel('unused', 'unused', async () => ({ data })), /未提供|不支持/);
}
await assert.rejects(resolveChiefModel('unused', 'unused', async () => ({ data: [], nextCursor: 'same' })), /分页异常/);
console.log('PASS: explicit strongest model availability, pagination, no silent fallback.');
