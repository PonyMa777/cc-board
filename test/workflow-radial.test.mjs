// Isolated synthetic host snapshots + full production HTML in headless Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { workflowOrg, radialJob } from '../workflow-org.mjs';

const job = { id: 'radial-fixture', mode: 'complex', prompt: '合成并行任务', status: 'running', rootChiefIndex: 0, stages: [
  { index: 0, role: 'chief', threadId: 'chief', turnId: 'chief-turn', status: 'running', assignment: '拆分三个任务' },
] };
const sessions = ['chief', 'search', 'checkout', 'coding'].map(sid => ({ sid, title: sid, status: 'busy', provider: 'codex', cwd: 'D:/fixture', startedAt: 1, prompt: '合成测试', project: { key: 'fixture', name: 'Fixture' } }));
const snapshot = () => ({ now: Date.now(), sessions, pending: [], others: 0, home: 'D:/fixture', notices: [], providers: {}, archived: 0, lost: [], limits: {}, processed: {}, org: workflowOrg({ nodes: {} }, sessions, [job], { explicitOnly: true }) });
const states = [snapshot()];
job.stages[0].status = 'completed';
for (const [i, role] of ['research', 'checkout', 'coding'].entries()) job.stages.push({ index: i + 1, role, threadId: ['search', 'checkout', 'coding'][i], status: 'running', parentIndex: 0, parentThreadId: 'chief', assignment: ['检索资料', '核对结账', '修改组件'][i] });
states.push(snapshot());
assert.deepEqual(radialJob(job).stages.slice(1).map(s => s.status), ['queued', 'queued', 'queued']);
job.stages[1].turnId = 'search-turn'; job.stages[3].turnId = 'coding-turn'; states.push(snapshot());
assert.deepEqual(radialJob(job).stages.slice(1).map(s => s.status), ['running', 'queued', 'running']);
job.stages[1].status = 'completed'; states.push(snapshot());
job.stages[3].status = 'needs_input'; job.stages[3].error = '请选择组件方案'; states.push(snapshot());
job.stages[3].status = 'completed'; job.stages[3].error = null; states.push(snapshot());
const forged = structuredClone(job); forged.stages[1].parentThreadId = 'unverified';
assert.equal(radialJob(forged).stages[1].dispatchId, null);
assert.equal(radialJob({ stages: [{status:'completed', report:{outcome:'needs_input',summary:'选择方案'}}] }).stages[0].status, 'waiting');

const temp = process.env.CCBOARD_TEST_TMP || os.tmpdir();
assert.ok(path.resolve(temp).toLowerCase().startsWith('d:\\chatgpt-temp\\'), 'Set TEMP or CCBOARD_TEST_TMP to the task directory under D:\\ChatGPT-Temp');
const root = fs.mkdtempSync(path.join(temp, 'radial-'));
let html = fs.readFileSync(new URL('../ui.html', import.meta.url), 'utf8');
const bootstrap = `<script>
window.testErrors=[];addEventListener('error',e=>testErrors.push(e.message));addEventListener('unhandledrejection',e=>testErrors.push(String(e.reason)));
localStorage.clear();localStorage.setItem('ccb_lang',JSON.stringify('zh'));localStorage.setItem('ccb_mode',JSON.stringify('org'));localStorage.setItem('ccb_orgshape',JSON.stringify('map'));
window.states=${JSON.stringify(states)};window.current=states[0];
window.fetch=async url=>({ok:true,status:200,json:async()=>url.startsWith('/api/state')?current:{ok:true,jobs:[],turns:[]}});
window.flashCount=0;const realAnimate=Element.prototype.animate;Element.prototype.animate=function(...args){if(this.matches('[data-wr-line]'))flashCount++;return realAnimate.apply(this,args);};
</script>`;
const tests = `<script>
const check=(v,m)=>{if(!v)throw Error(m)};
const slot=r=>document.querySelector('[data-wr-role="'+r+'"]');
const radialStep=i=>{current=states[i];paint(current)};
setTimeout(async()=>{try{
 check(!testErrors.length,testErrors.join(';'));check(slot('chief').dataset.state==='running','chief starts from host');
 check(slot('chief').textContent.includes('正在拆分任务'),'chief task label');check(flashCount===0,'initial history never flashes');
 const coords=()=>[...document.querySelectorAll('.wr-slot')].map(e=>e.style.left+','+e.style.top).join(';');const fixed=coords();
 radialStep(1);check(slot('checkout').textContent.includes('排队中'),'queued lead text');
 const expected=matchMedia('(prefers-reduced-motion: reduce)').matches?0:3;
 check(flashCount===expected,'one dispatch flash per edge');radialStep(1);check(flashCount===expected,'polling must not replay dispatch');
 radialStep(2);check(document.querySelectorAll('.wr-slot[data-state="running"]').length===2,'exactly two leads execute');
 check(slot('research').textContent.includes('检索资料')&&slot('coding').textContent.includes('修改组件'),'correct assignments');
 check(getComputedStyle(slot('checkout')).animationName==='none','queued node never breathes');
 check(getComputedStyle(slot('coding')).animationName===(expected?'wr-breathe':'none'),'motion setting');
 radialStep(3);check(slot('research').dataset.state==='completed'&&slot('coding').dataset.state==='running','independent completion');
 check(getComputedStyle(slot('research')).animationName==='none','completed stops immediately');
 radialStep(4);check(slot('coding').dataset.state==='waiting'&&slot('coding').textContent.includes('请选择组件方案'),'waiting decision visible');
 await new Promise(resolve=>setTimeout(resolve,300));
 check(getComputedStyle(slot('coding').querySelector('.onode')).boxShadow.includes('2px'),'amber decision border: '+getComputedStyle(slot('coding').querySelector('.onode')).boxShadow);
 radialStep(5);check(!document.querySelector('.wr-slot[data-state="running"]'),'all finished stop');check(coords()===fixed,'fixed geometry across transitions');
 let opened=null;zoomCard=sid=>{opened=sid};document.querySelector('[data-wr-tasks="research"] button').click();check(opened==='search','task opens actual session');
 check(slot('coding').querySelector('.oarchive')&&slot('coding').querySelector('.orecap'),'node actions preserved');
 const select=document.querySelector('.wr-select');select.value='*';select.dispatchEvent(new Event('change'));check(!document.querySelector('#org').classList.contains('workflow-map'),'all sessions available');
 select.value='radial-fixture';select.dispatchEvent(new Event('change'));check(flashCount===expected,'view switching never replays dispatch');
 radialStep(2);check(!testErrors.length,testErrors.join(';'));document.body.dataset.testResult='PASS';
 }catch(e){document.body.dataset.testResult='FAIL';document.body.dataset.testError=e.stack}},100);
</script>`;
html = html.replace('<head>', '<head>' + bootstrap).replace('</body>', tests + '</body>');
const fixture = path.join(root, 'radial.html');fs.writeFileSync(fixture, html);
const browser = [process.env.CCBOARD_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));assert.ok(browser,'Chromium required');
for (const reduced of [false,true]) {
  const name = reduced?'reduced':'normal';
  const run=spawnSync(browser,['--headless','--disable-gpu','--no-first-run','--disable-extensions',...(reduced?['--force-prefers-reduced-motion']:[]),'--user-data-dir='+path.join(root,name+'-profile'),'--window-size=1440,1000','--virtual-time-budget=1100','--screenshot='+path.join(root,name+'.png'),'--dump-dom',pathToFileURL(fixture).href],{encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,TEMP:root,TMP:root,TMPDIR:root},maxBuffer:8*1024*1024});
  fs.writeFileSync(path.join(root,name+'.html'),run.stdout||'');
  assert.match(run.stdout||'',/data-test-result="PASS"/,(run.stdout||'').match(/data-test-error="([^"]*)/)?.[1]||run.stderr||String(run.error));
}
console.log('PASS isolated: host projection; concurrent leads, queued lead, independent completion, decision, fixed positions, dispatch deduplication, preserved actions and reduced motion. Artifacts: '+root);
