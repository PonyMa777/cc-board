// Real browser layout/state regression using only synthetic sessions; never contacts CCBoard.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const html = fs.readFileSync(new URL('../ui.html', import.meta.url), 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const extract = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const view = extract('function view(s) {', '// 封面那一截');
const node = extract('function orgNode(sid) {', 'function orgPlace(');
const box = extract('const orgLive =', 'function orgCol(');
assert.match(html, /if \(orgLive\(v\)\) nRun\+\+/);
const root = fs.mkdtempSync('D:/ChatGPT-Temp/ccboard-workflows-20261125/org-running-');
const script = `
const onodes = new Map(), cards = new Map(), sentAt = {}, ack = {}, archivePending = new Set(), resumePending = new Set();
const ORG_ROLE = { chief: '总管', lead: '负责人', head: '分支', former: '前任' };
const $ = (s, root = document) => root.querySelector(s);
const T = s => s, ms = t => typeof t === 'number' ? t : Date.parse(t) || 0, isDone = () => false;
const setText = (el, text) => { el.textContent = text; };
const coverOf = () => ({head:'合成测试',ask:''}), orgMeta = () => '', orgWhy = () => '';
${view}\n${node}\n${box}
function check(ok, text) { if (!ok) throw new Error(text); }
const sessions = [
 {sid:'running1',title:'CCBoard 直接存档按钮',status:'busy'},
 {sid:'running2',title:'改进 CC board：这是一个很长的标题需要保持可读且不能和徽标重叠',status:'shell'},
 {sid:'waiting',title:'等待选择',status:'waiting'},
 {sid:'done',title:'已交付的任务',status:'idle',done:true,result:'完成',resultAt:Date.now(),digest:{need:'review'}},
 {sid:'failed',title:'失败的任务',status:'idle',alert:{kind:'error',key:'failure'}},
 {sid:'idle',title:'空闲的任务',status:'idle'}
];
const M = {S:new Map(sessions.map(s=>[s.sid,s])), nd:sid=>({workflowResumable:sid==='failed'}), role:sid=>sid==='running2'?'head':'member',under:new Map()};
function render(s) { cards.set(s.sid,{v:view(s)});orgBox(s.sid,M,{});const x=onodes.get(s.sid);x.li.className='oli r-'+M.role(s.sid);if(!x.li.isConnected)$('#fixtures').append(x.li); }
try {
 sessions.forEach(render);
 check(!$('.oresume',onodes.get('failed').box).hidden,'stopped workflow exposes continue action');
 check($('.oresume',onodes.get('running1').box).hidden,'running task has no continue action');
 resumePending.add('failed');render(sessions.find(s=>s.sid==='failed'));
 check($('.oresume',onodes.get('failed').box).disabled,'pending continuation disables duplicate click');
 resumePending.clear();render(sessions.find(s=>s.sid==='failed'));
 const count = [...cards.values()].filter(c=>orgLive(c.v)).length;
 check(count === 2, 'hub count should include busy and background only');
 check(document.querySelectorAll('.orunning:not([hidden])').length===count,'visible running badge count must match hub');
 for (const s of sessions) {
   const x=onodes.get(s.sid), badge=$('.orunning',x.box);
   check(badge.hidden===!cards.get(s.sid).v.live,'badge state '+s.sid);
   if (!badge.hidden) {check(badge.textContent==='运行中','explicit label');check(!!badge.querySelector('svg'),'running icon');}
 }
 const changing=sessions[0];
 for (const state of ['waiting','busy','idle']) {changing.status=state;render(changing);check($('.orunning',onodes.get(changing.sid).box).hidden===(state!=='busy'),'state transition '+state);}
 changing.status='idle';changing.alert={kind:'error',key:'failed'};render(changing);check($('.orunning',onodes.get(changing.sid).box).hidden,'failure must remove badge');
 changing.status='busy';delete changing.alert;render(changing);
 for (const sid of ['running1','running2']) {
   const b=onodes.get(sid).box, title=$('.ot',b).getBoundingClientRect(), badge=$('.orunning',b).getBoundingClientRect(), outer=b.getBoundingClientRect();
   check(title.width>0&&badge.width>0&&outer.width>0,'node must be visibly laid out '+sid);
   check(title.right<=badge.left+1, 'title and badge overlap '+sid);
   check(badge.right<=outer.right+1, 'badge exceeds node '+sid);
   check(getComputedStyle($('.orunning svg',b)).animationName===(matchMedia('(prefers-reduced-motion: reduce)').matches?'none':'org-running-turn'),'running animation respects motion preference');
 }
 const reducedRule=[...document.styleSheets[0].cssRules].filter(r=>r.conditionText?.includes('prefers-reduced-motion')).flatMap(r=>[...r.cssRules]).find(r=>r.selectorText==='.orunning svg');
 check(reducedRule?.style.animationName==='none','reduced motion disables icon animation');
 document.body.dataset.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'normal';
 document.body.dataset.result='PASS';$('#result').textContent='PASS: busy/background count, waiting/done/error/idle, state transitions, long-title layout, icon animation and reduced-motion override.';
} catch(e) { document.body.dataset.result='FAIL';$('#result').textContent=e.stack; }
`;
const fixture = path.join(root, 'org-running.html');
fs.writeFileSync(fixture, '<!doctype html><html><meta charset="utf-8"><style>' + css + '\n#org.map{position:relative!important;min-height:440px;padding:30px!important}#org.map .omnodes>.oli{position:relative!important;margin:20px 0}#org.map .omnodes .onode{min-width:260px}#result{white-space:pre-wrap;padding:20px}</style><body class="org"><div id="org" class="map"><ul id="fixtures" class="omnodes"></ul></div><pre id="result"></pre><script>' + script + '</script></body></html>');
const edge = [process.env.CCBOARD_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p => fs.existsSync(p));
assert.ok(edge, 'A Chromium browser is required for this Windows UI regression.');
for (const reduced of [false, true]) {
  const name = reduced ? 'org-running-reduced' : 'org-running';
  const render = spawnSync(edge, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', ...(reduced ? ['--force-prefers-reduced-motion'] : []), '--user-data-dir=' + path.join(root, name + '-profile'), '--window-size=1000,720', '--virtual-time-budget=1000', '--screenshot=' + path.join(root, name + '.png'), '--dump-dom', pathToFileURL(fixture).href], {encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,TEMP:root,TMP:root,TMPDIR:root},stdio:['ignore','pipe','pipe']});
  const output = render.stdout || '';
  if (!output) throw new Error('Headless browser produced no document: ' + (render.error?.message || render.stderr || render.status));
  fs.writeFileSync(path.join(root, name + '.rendered.html'), output);
  assert.ok(/data-result="PASS"/.test(output), output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] || 'Browser did not finish tests');
  assert.ok(output.includes('data-motion="' + (reduced ? 'reduced' : 'normal') + '"'), 'Browser did not apply requested motion preference');
}
console.log('PASS: organization running badges; browser artifact ' + path.join(root, 'org-running.png'));
