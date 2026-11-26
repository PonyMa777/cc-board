// Replay actual captured API states through the production renderer; no invented running statuses.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {workflowOrg} from '../workflow-org.mjs';
const captured=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const overlap=captured.find(s=>s.projection?.stages.filter(t=>t.status==='running').length===2&&s.projection.stages.some(t=>t.status==='queued'));
assert.ok(overlap);const final=captured.at(-1);assert.equal(final.job.status,'completed');
const states=[overlap,final].map(s=>{
 const sessions=s.projection.stages.filter(t=>t.threadId).map(t=>({sid:t.threadId,title:t.role,status:t.status==='running'?'busy':'idle',provider:'codex',cwd:s.job.cwd,startedAt:t.assignedAt,prompt:t.task,project:{key:'trial',name:'Real trial'}}));
 return {now:s.at,sessions,pending:[],others:0,home:'D:/fixture',notices:[],providers:{},archived:0,lost:[],limits:{},processed:{},org:{...workflowOrg({nodes:{}},sessions,[s.job],{explicitOnly:true}),radialJobs:[s.projection]}};
});
const root=fs.mkdtempSync('D:/ChatGPT-Temp/parallel-live-ui-');
let html=fs.readFileSync(new URL('../ui.html',import.meta.url),'utf8');
const bootstrap=`<script>window.realStates=${JSON.stringify(states)};window.currentReal=realStates[0];localStorage.clear();localStorage.setItem('ccb_lang','"zh"');localStorage.setItem('ccb_mode','"org"');localStorage.setItem('ccb_orgshape','"map"');window.fetch=async url=>({ok:true,status:200,json:async()=>url.startsWith('/api/state')?currentReal:{ok:true,jobs:[]}});</script>`;
const tests=`<script>setTimeout(()=>{try{const assertReal=(x,m)=>{if(!x)throw Error(m)};assertReal(document.querySelectorAll('.wr-slot[data-state="running"]').length===2,'exact real overlap');assertReal(document.querySelector('[data-wr-role="documentation"]').dataset.state==='queued','real queued writer');currentReal=realStates[1];paint(currentReal);assertReal(!document.querySelector('.wr-slot[data-state="running"]'),'actual completion extinguishes all nodes');currentReal=realStates[0];paint(currentReal);document.body.dataset.result='PASS'}catch(e){document.body.dataset.result='FAIL';document.body.dataset.error=e.stack}},150);</script>`;
html=html.replace('<head>','<head>'+bootstrap).replace('</body>',tests+'</body>');
const fixture=path.join(root,'real.html');fs.writeFileSync(fixture,html);
const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const result=spawnSync(browser,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--user-data-dir='+path.join(root,'profile'),'--window-size=1440,1000','--virtual-time-budget=1100','--screenshot='+path.join(root,'overlap.png'),'--dump-dom',pathToFileURL(fixture).href],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:8*1024*1024,env:{...process.env,TEMP:root,TMP:root,TMPDIR:root}});
fs.writeFileSync(path.join(root,'rendered.html'),result.stdout||'');
assert.match(result.stdout||'',/data-result="PASS"/,(result.stdout||'').match(/data-error="([^"]*)/)?.[1]||result.stderr);
console.log('PASS actual API snapshot renderer: two real turns light, queued writer dark, completed all dark. '+path.join(root,'overlap.png'));
