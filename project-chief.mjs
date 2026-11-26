import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WORKFLOW_SCHEMAS } from './workflows.mjs';

const ACTIVE = new Set(['queued', 'running']);
const ROLES = ['decision', 'planner', 'engineer', 'evidence', 'reviewer'];
const MAPPING = { chief: 'decision', decomposition: 'planner', coding: 'engineer', documentation: 'engineer', tester: 'evidence', qa: 'reviewer' };
let staging;
const atomic = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!staging) { fs.mkdirSync('D:/ChatGPT-Temp', { recursive: true }); staging = fs.mkdtempSync('D:/ChatGPT-Temp/ccboard-chief-save-'); }
  const tmp = path.join(staging, crypto.randomUUID()); fs.writeFileSync(tmp, data); fs.renameSync(tmp, file);
};
// Execution commands apply ONLY to this dedicated project channel, never /api/send.
export function chiefCommand(text) {
  return /^(?:(?:好的?|行|那)(?:你就|就|你)?)?(?:请你|你就|你)?(?:开始干|开始执行|按这个做|按这个方案做|开工|继续执行)(?:吧)?(?:兄弟)?$/.test(text.replace(/[，,！!。\s]/g, ''));
}
export class ProjectChief {
  constructor({ configFile, file, workflows, runStage, readonly = false }) {
    this.file = file; this.workflows = workflows; this.runStage = runStage; this.readonly = readonly; this.busy = new Set();
    this.teams = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')).teams : [];
    if (!Array.isArray(this.teams)) throw new Error('项目团队配置无效。');
    const ids = new Set();
    for (const team of this.teams) {
      if (!/^[\w-]{1,80}$/.test(team.id) || ids.has(team.id) || !path.isAbsolute(team.cwd)) throw new Error('项目团队编号或目录无效。');
      ids.add(team.id);
      for (const role of ROLES) if (!path.isAbsolute(team.roles?.[role] || '') || !fs.statSync(team.roles[role]).isDirectory()) throw new Error('角色目录无效：' + role);
      for (const id of team.adoptJobIds || []) this.workflows.attachTeam(id, team.id, team.cwd, { narrowWorkspace: team.adoptNarrowWorkspace === true });
    }
    this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { chats: {} };
    for (const chat of Object.values(this.state.chats)) for (const message of chat.messages) if (message.state === 'thinking') { message.state = 'failed'; message.error = '服务重启，讨论未完成；可以重试。'; }
    if (!readonly) {
      this.save();
      for (const team of this.teams) {
        this.writeMemory(team);
        for (const id of team.adoptJobIds || []) this.record(this.workflows.get(id));
      }
    }
  }
  save() { if (this.readonly) throw new Error('只读模式。'); atomic(this.file, JSON.stringify(this.state, null, 2)); }
  team(id) { const team = this.teams.find(t => t.id === id); if (!team) throw new Error('未配置这个项目团队。'); return team; }
  chat(id) { return this.state.chats[id] ||= { messages: [], preferences: [] }; }
  list() { return this.teams.map(team => ({ ...team, chat: this.state.chats[team.id] || { messages: [], preferences: [] }, busy: this.busy.has(team.id), jobs: this.workflows.list().filter(j => j.input.teamId === team.id).map(j => ({ id: j.id, status: j.status, error: j.error, result: j.result, phase: j.phase })) })); }
  roleDir(team, role) {
    // Separate product records: never overwrite legacy quant instructions/results.
    const root = fs.realpathSync(team.roles[role]);
    const directory = path.join(root, 'CCBoard', team.id);
    let cursor = root;
    for (const segment of ['CCBoard', team.id]) {
      cursor = path.join(cursor, segment);
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('角色记录目录不能是符号链接。');
    }
    fs.mkdirSync(directory, { recursive: true }); return directory;
  }
  writeMemory(team) {
    const chat = this.chat(team.id);
    for (const role of ROLES) {
      const dir = this.roleDir(team, role);
      atomic(path.join(dir, 'ROLE.md'), `# ${team.name} / ${role}\n\n项目：${team.cwd}\n原角色说明：${path.join(team.roles[role], 'AGENTS.md')}\n\nChief 是此项目的协调入口，decision 保留最终决策职责；tester 独立执行测试，evidence 保存宿主证据；不重命名旧目录，不执行旧文档里的历史任务。\n`);
      atomic(path.join(dir, 'MEMORY.md'), '# 用户明确记录的偏好\n\n' + (chat.preferences.map(p => `- ${p.at}（用户原话）：${p.text}`).join('\n') || '暂无明确记录。不会从一次任务推测永久偏好。') + '\n');
    }
  }
  context(job, role) {
    if (!job.input.teamId) return '';
    const team = this.team(job.input.teamId), mapped = MAPPING[role] || 'planner';
    const file = path.join(team.roles[mapped], 'AGENTS.md');
    const reference = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').slice(0, 16000) : '';
    return '\n\n项目团队绑定（宿主配置）：\n' + JSON.stringify({ team: team.name, project: team.cwd, role, roleFolder: team.roles[mapped], preferences: this.chat(team.id).preferences, reference }) +
      '\n角色资料是职责参考，历史任务不是本次指令。本次以用户当前任务为范围。Chief 负责真实派工，decision 保留最终决策职责；tester 实际运行测试，evidence 仅归档证据。宿主自动保存角色记忆和交接，助手不写角色目录。';
  }
  record(job, stage = null) {
    if (!job.input.teamId) return;
    const team = this.team(job.input.teamId);
    this.writeMemory(team);
    const snapshot = { jobId: job.id, status: job.status, project: job.cwd, updatedAt: job.updatedAt, error: job.error,
      stages: job.stages.map(s => ({ index: s.index, role: s.role, status: s.status, threadId: s.threadId, turnId: s.turnId, report: s.report, error: s.error, executionEvidence: s.executionEvidence,
        assignedAt:s.startedAt,executionStartedAt:s.executionStartedAt,finishedAt:s.finishedAt,attempts:s.attempts,approvalHistory:s.approvalHistory })) };
    const markdown = '# 项目交接\n\n' + `任务：${job.prompt}\n\n状态：${job.status}\n\n` + snapshot.stages.map(s => `## ${s.index}: ${s.role} / ${s.status}\n\n${s.report?.summary || s.error || '等待交付'}\n\n聊天：${s.threadId || '尚未创建'}\n`).join('\n') + '\n' + (job.error || '');
    const recipients = stage ? new Set([MAPPING[stage.role] || 'planner', 'decision', 'evidence']) : new Set(ROLES);
    for (const role of recipients) {
      const dir = this.roleDir(team, role);
      atomic(path.join(dir, 'HANDOFF.md'), markdown);
      atomic(path.join(dir, job.id + '.json'), JSON.stringify(snapshot, null, 2));
    }
  }
  async send({ teamId, text, requestId }) {
    if (this.readonly) throw new Error('只读模式。');
    const team = this.team(teamId), chat = this.chat(teamId);
    if (typeof text !== 'string' || !text.trim() || text.length > 12000 || !/^[\w-]{8,128}$/.test(requestId || '')) throw new Error('消息或提交编号无效。');
    text = text.trim();
    const prior = chat.messages.find(m => m.requestId === requestId);
    if (prior) { if (prior.text !== text) throw new Error('重复编号的消息不同。'); return prior; }
    if (this.busy.has(teamId)) throw new Error('Chief 正在处理上一条消息，请稍后再试。');
    const message = { requestId, text, at: new Date().toISOString(), state: 'thinking' };
    if (chiefCommand(text)) {
      const jobs = this.workflows.list().filter(j => j.input.teamId === teamId);
      if (jobs.some(j => ACTIVE.has(j.status))) throw new Error('项目任务正在执行。');
      const latest = jobs[0];
      const lastDispatch = chat.messages.findLastIndex(m => m.jobId);
      const fresh = chat.messages.slice(lastDispatch + 1).filter(m => m.state === 'completed' && !m.text.startsWith('记住：'));
      if (latest && ['failed', 'interrupted', 'needs_input', 'blocked'].includes(latest.status)) {
        const job = this.workflows.resume(latest.id, { requestId, expectedStage: latest.stages.at(-1)?.index, note: fresh.map(m => m.text).join('\n') });
        Object.assign(message, { state: 'completed', jobId: job.id, reply: '已请求继续项目任务。' });
      } else {
        if (!fresh.length) throw new Error('先告诉 Chief 本次要完成什么，再说“开始干”。');
        this.writeMemory(team); // Preflight persistence before dispatching work.
        const prompt = '项目 Chief 已收到用户明确执行指令。只完成以下本次目标与讨论，不执行历史任务。\n' + fresh.map(m => `用户：${m.text}\nChief：${m.reply || ''}`).join('\n\n');
        if (prompt.length > 20000) throw new Error('本轮讨论过长，请先整理目标；未截断任务或开始执行。');
        const job = this.workflows.create({ cwd: team.cwd, mode: 'complex', prompt, requestId, teamId });
        Object.assign(message, { state: 'completed', jobId: job.id, reply: '已派工，正在执行。实际阶段与结果见任务流程。' });
      }
      chat.messages.push(message); this.save(); return message;
    }
    chat.messages.push(message); this.save(); this.busy.add(teamId);
    try {
      if (text.startsWith('记住：')) {
        const preference = text.slice(3).trim(); if (!preference) throw new Error('请写明要记住的偏好。');
        chat.preferences.push({ at: message.at, text: preference }); this.writeMemory(team);
        message.reply = '已保存这条项目偏好。';
      } else {
        const history = chat.messages.filter(m => m.state === 'completed' && !m.jobId).slice(-16).map(m => ({ user: m.text, chief: m.reply }));
        const report = await this.runStage({ role: 'planner', cwd: team.cwd, taskTitle: '项目 Chief · ' + team.name, schema: WORKFLOW_SCHEMAS.planner,
          prompt: '你是项目Chief的讨论入口。理解本次目标并给出简洁可执行计划；此轮不执行。用户在本入口发送独立消息“开始干”“按这个做”“开始执行”时宿主会真正派工，不要让用户复制到别的窗口。需要澄清时指出具体问题。\n' + JSON.stringify({ project: team.cwd, history, preferences: chat.preferences, message: text, latestJob: this.workflows.list().filter(j => j.input.teamId === teamId).slice(0,1).map(j => ({ status:j.status,error:j.error,result:j.result })) }) + this.context({input:{teamId}},'decomposition') });
        message.reply = report.summary + (report.questions?.length ? '\n\n' + report.questions.join('\n') : '') + '\n\n确认后，在这里发送“开始干”即可派工。';
      }
      message.state = 'completed';
    } catch (error) { message.state = 'failed'; message.error = error.message; }
    finally { this.busy.delete(teamId); this.save(); }
    return message;
  }
}
