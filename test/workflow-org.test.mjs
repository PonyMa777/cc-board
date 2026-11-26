import assert from 'node:assert/strict';
import { workflowOrg, workflowFailure } from '../workflow-org.mjs';
const failureJobs = [{ id: 'blocked-job', stages: [{ index: 1, threadId: 'blocked', status: 'needs_input', error: 'Permission required', finishedAt: 2000 }] }];
assert.equal(workflowFailure({ sid: 'blocked', status: 'idle', turnAt: new Date(1000).toISOString() }, failureJobs).text, 'Permission required');
assert.equal(workflowFailure({ sid: 'blocked', status: 'busy' }, failureJobs), null);
assert.equal(workflowFailure({ sid: 'blocked', status: 'idle', turnAt: new Date(3000).toISOString() }, failureJobs), null);
const sessions = ['chief', 'worker', 'other', 'unknown'].map(sid => ({ sid }));
const jobs = [{ id: 'job', rootChiefIndex: 0, stages: [
  { index: 0, role: 'chief', threadId: 'chief', actualModel: 'strongest' },
  { index: 1, role: 'coding', threadId: 'worker', parentIndex: 0, parentThreadId: 'chief', status: 'running' },
  { index: 2, role: 'qa', threadId: 'unknown', parentIndex: 0, parentThreadId: 'forged' },
] }];
const base = { chief: 'other', nodes: { other: { boss: 'chief' } } };
const graph = workflowOrg(base, sessions, jobs, { explicitOnly: true });
assert.equal(graph.chief, null); assert.equal(graph.nodes.worker.boss, 'chief');
assert.equal(graph.nodes.worker.workflowStageStatus, 'running');
assert.equal(graph.nodes.other.boss, null); assert.equal(graph.nodes.unknown.boss, null);
assert.equal(graph.nodes.chief.actualModel, 'strongest');
const archived = workflowOrg(base, sessions.filter(s => s.sid !== 'chief'), jobs, { explicitOnly: true });
assert.equal(archived.nodes.worker.boss, null); assert.equal(archived.nodes.worker.workflowParent, 'chief');
assert.equal(base.nodes.other.boss, 'chief');
console.log('PASS: actual workflow relationships, unrelated chats independent, absent parents and invalid edges.');
