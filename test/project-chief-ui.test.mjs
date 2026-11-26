import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root=fs.mkdtempSync('D:/ChatGPT-Temp/chief-ui-');
let html=fs.readFileSync(new URL('../ui.html',import.meta.url),'utf8');
const bootstrap=`<script>
window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
localStorage.setItem('ccb_lang','zh');window.calls=[];window.team={id:'fixture',name:'专用项目团队',cwd:'D:/synthetic-source',roles:{},chat:{messages:[],preferences:[]},jobs:[]};
window.fetch=async(url,options={})=>{const body=options.body?JSON.parse(options.body):null;calls.push({url,body});let data={ok:true};
if(url.startsWith('/api/state'))data={now:Date.now(),sessions:[],pending:[],others:0,home:'D:/fixture',notices:[],providers:{},archived:0,lost:[],crash:null,limits:{},processed:{},workflows:{enabled:true,jobs:[]}};
if(url==='/api/chief')data={ok:true,teams:[team]};
if(url==='/api/chief/send'){await new Promise(r=>setTimeout(r,100));const m={text:body.text,state:'completed',reply:body.text==='开始干'?'已派工':'计划已就绪',...(body.text==='开始干'?{jobId:'job'}:{})};team.chat.messages.push(m);data={ok:true,message:m};}
return{ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(data))};};</script>`;
const test=`<script>(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));const check=(ok,msg)=>{if(!ok)throw new Error(msg)};try{
await wait(80);document.querySelector('#chiefBtn').click();await wait(80);
check(document.querySelector('#chiefDlg').open,'dedicated dialog opens');check(document.querySelector('#chiefScope').textContent==='D:/synthetic-source','bound project displayed');
document.querySelector('#chiefInput').value='只讨论一个小任务';document.querySelector('#chiefSend').click();await wait(200);
check(!document.querySelector('[data-chief-job]'),'discussion does not fake a job');
document.querySelector('#chiefInput').value='开始干';document.querySelector('#chiefSend').click();document.querySelector('#chiefSend').click();
check(document.querySelector('#chiefSend').disabled,'double submit blocked');await wait(200);
check(document.querySelector('[data-chief-job]').dataset.chiefJob==='job','actual dispatched workflow link');
check(calls.filter(c=>c.url==='/api/chief/send').length===2,'only discussion and one execute message');check(!calls.some(c=>c.url==='/api/send'),'ordinary chat untouched');check(!errors.length,errors.join(';'));
document.body.dataset.testResult='PASS';}catch(e){document.body.dataset.testResult='FAIL';document.body.dataset.testError=e.stack;}})();</script>`;
html=html.replace('<head>','<head>'+bootstrap).replace('</body>',test+'</body>');
const fixture=path.join(root,'chief.html');fs.writeFileSync(fixture,html);
const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));assert.ok(browser);
const run=spawnSync(browser,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--user-data-dir='+path.join(root,'profile'),'--window-size=1200,900','--virtual-time-budget=2500','--screenshot='+path.join(root,'chief.png'),'--dump-dom',pathToFileURL(fixture).href],{encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,TEMP:root,TMP:root,TMPDIR:root}});
fs.writeFileSync(path.join(root,'rendered.html'),run.stdout||'');
assert.match(run.stdout||'',/data-test-result="PASS"/,(run.stdout||'').match(/data-test-error="([^"]*)/)?.[1]||run.stderr);
console.log('PASS dedicated Chief UI: bound project, discussion, dispatch, duplicate clicks, ordinary-chat isolation. '+path.join(root,'chief.png'));
