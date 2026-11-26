// Only persisted, actually created stage identities establish workflow edges.
export function workflowExecution(session, jobs) {
  for (const job of jobs) {
    const stage = [...(job.stages || [])].reverse().find(s => s.threadId === session.sid);
    if (!stage) continue;
    if (Date.parse(session.turnAt || '') > (stage.finishedAt || Date.now())) return session;
    session.status = stage.status === 'running' && stage.turnId ? 'busy' : 'idle';
    if (stage.status === 'running') { session.halt = null; session.done = false; }
    return session;
  }
  return session;
}
export function workflowFailure(session, jobs) {
  if (session.status === 'busy') return null;
  for (const job of jobs) for (const stage of [...(job.stages || [])].reverse()) {
    if (stage.threadId === session.sid && stage.pendingApproval) return { kind:'error', key:'approval@'+stage.pendingApproval.id, workflow:true,
      summary: stage.pendingApproval.reason || '等待命令执行授权', text:stage.pendingApproval.reason+'\n'+stage.pendingApproval.command, at:new Date(stage.pendingApproval.at).toISOString() };
    if (stage.threadId === session.sid && ['running', 'completed'].includes(stage.status)) return null;
    if (stage.threadId !== session.sid || !stage.error || !['needs_input', 'failed', 'interrupted'].includes(stage.status)) continue;
    // A subsequent user turn supersedes the historical workflow failure.
    if (Date.parse(session.turnAt || session.promptAt || '') > stage.finishedAt) continue;
    return { kind: 'error', key: 'workflow@' + job.id + ':' + stage.index, text: stage.error, summary: stage.error.startsWith('需要用户处理：') ? stage.error.split('\n')[1] || stage.error : stage.error, at: new Date(stage.finishedAt).toISOString(), workflow: true };
  }
  return null;
}
export function workflowOrg(base, sessions, jobs, { explicitOnly = false } = {}) {
  const live = new Set(sessions.map(s => s.sid));
  const nodes = explicitOnly ? Object.fromEntries(sessions.map(s => [s.sid, { role: 'member', boss: null, via: 'independent', from: [], for: null }])) : { ...base.nodes };
  for (const job of jobs) {
    for (const stage of job.stages || []) {
      if (!stage.threadId || !live.has(stage.threadId)) continue;
      const parent = (job.stages || []).find(s => s.index === stage.parentIndex);
      const verifiedParent = parent?.threadId && parent.threadId === stage.parentThreadId && parent.index < stage.index ? parent.threadId : null;
      const root = stage.role === 'chief' && stage.index === job.rootChiefIndex;
      nodes[stage.threadId] = {
        ...(nodes[stage.threadId] || {}), role: root ? 'lead' : stage.role === 'chief' ? 'member' : 'head',
        boss: verifiedParent && live.has(verifiedParent) ? verifiedParent : null,
        via: 'workflow', workflowId: job.id, workflowRole: stage.role,
        workflowResumable: ['failed', 'interrupted', 'needs_input', 'blocked'].includes(job.status) && job.mode !== 'discuss' && stage.index === job.stages.at(-1)?.index,
        workflowStageIndex: stage.index,
        workflowApproval: stage.pendingApproval || null,
        workflowParent: verifiedParent, workflowStageStatus: stage.status,
        actualModel: stage.actualModel || null, from: [], for: null,
      };
    }
  }
  return { ...base, ...(explicitOnly ? { chief: null, gen: null } : {}), nodes,
    radialJobs: jobs.filter(job => job.mode !== 'discuss').map(radialJob) };
}

// A separate presentation projection: never invent threads or execution from transcript activity.
export function radialJob(job) {
  return { id: job.id, prompt: job.prompt || job.input?.prompt || '', status: job.status,
    stages: (job.stages || []).map(stage => {
      const parent = (job.stages || []).find(s => s.index === stage.parentIndex);
      const delegated = parent?.threadId && parent.threadId === stage.parentThreadId && parent.index < stage.index;
      const outcome = stage.report?.outcome || (stage.report?.decision === 'needs_input' ? 'needs_input' : null);
      const status = ['needs_input', 'blocked', 'awaiting_confirmation', 'waiting_approval'].includes(stage.status) || ['needs_input', 'blocked'].includes(outcome) ? 'waiting'
        : stage.status === 'running' ? (stage.turnId ? 'running' : 'queued')
        : stage.status === 'queued' ? 'queued' : stage.status === 'completed' ? 'completed'
        : ['failed', 'interrupted', 'cancelled'].includes(stage.status) ? 'stopped' : 'idle';
      return { index: stage.index, role: stage.role, threadId: stage.threadId || null,
        waitingApproval: !!stage.pendingApproval,
        turnId: stage.turnId || null, status, task: stage.assignment || (delegated ? parent.report?.task : '') || job.prompt || job.input?.prompt || '',
        decision: status === 'waiting' ? stage.pendingApproval?.reason || stage.error || stage.report?.blockers?.join('\n') || stage.report?.summary || '' : '',
        dispatchId: delegated && stage.role !== 'chief' ? job.id + ':' + stage.index : null,
        assignedAt: stage.startedAt || null, executionStartedAt: stage.executionStartedAt || null, finishedAt: stage.finishedAt || null };
    }) };
}
