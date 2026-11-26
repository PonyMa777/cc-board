// Full synthetic organization UI in a real Chromium browser. CDP drives real mouse movement.
// No live CCBoard API, user chats, or model calls are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const base = 'D:/ChatGPT-Temp/ccboard-org-archive-20261125';
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, 'ui-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let html = fs.readFileSync(new URL('../ui.html', import.meta.url), 'utf8');
const bootstrap = `<script>
window.testErrors=[];addEventListener('error',e=>testErrors.push(e.message));addEventListener('unhandledrejection',e=>testErrors.push(String(e.reason)));
localStorage.clear();localStorage.setItem('ccb_lang',JSON.stringify('zh'));localStorage.setItem('ccb_mode',JSON.stringify('org'));localStorage.setItem('ccb_orgshape',JSON.stringify('tree'));
window.testCalls=[];window.holdArchive=false;window.writerOwned=false;
const fixtureSession=(sid,title,status)=>({sid,title,status,provider:'codex',cwd:'D:/fixture',startedAt:1,prompt:'合成界面测试',promptAt:Date.now(),result:'已完成合成检查，请审阅。',resultAt:Date.now(),done:status!=='busy',digest:{need:'reply',head:'合成任务',ask:'请审阅合成结果'},project:{key:'fixture',name:'合成项目'},nativeArchive:true});
window.testSessions=[fixtureSession('done','可以直接存档的合成任务','idle'),fixtureSession('failed','存档失败应保留的合成任务','idle'),fixtureSession('busy','仍在运行的合成任务','busy')];
window.fetch=async(url,opt={})=>{const method=opt.method||'GET',body=opt.body?JSON.parse(opt.body):null;testCalls.push({url,method,body});let data={ok:true};
 if(url.startsWith('/api/state'))data={now:Date.now(),sessions:JSON.parse(JSON.stringify(testSessions)),pending:[],others:0,home:'D:/fixture',notices:[],providers:{codex:{ok:true,label:'Codex',models:[],efforts:[],defaultModel:'',defaultEffort:''}},archived:0,lost:[],crash:null,limits:{claude:[],codex:null},processed:{},workflows:{enabled:true,jobs:[]},org:{chief:null,nodes:Object.fromEntries(testSessions.map(s=>[s.sid,{role:'member'}]))}};
 if(url==='/api/archive'){if(holdArchive){holdArchive=false;await new Promise(r=>window.releaseArchive=r);}if(body.sid==='busy')data={ok:false,error:'此会话仍在运行，请等它结束或在 Codex 中停止后再归档。'};else if(body.sid==='failed'&&writerOwned)data={ok:false,code:'CODEX_WRITER_OWNED',error:'聊天仍由另一个 Codex 服务持有，尚未归档。这不一定代表任务正在运行。'};else if(body.sid==='failed')data={ok:false,error:'合成存档失败：请稍后重试。'};else{testSessions=testSessions.filter(s=>s.sid!==body.sid);data={ok:true,nativeArchive:true};}}
 if(url.startsWith('/api/recap'))data={ok:true,title:'合成回顾',messages:[],coverage:{complete:true},recap:{},current:{}};
 if(url.startsWith('/api/turns'))data={turns:[]};
 return{ok:true,status:200,json:async()=>data};};
</script>`;
html = html.replace('<head>', '<head>' + bootstrap);
const file = path.join(root, 'org-archive.html'); fs.writeFileSync(file, html);
const browser = [process.env.CCBOARD_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p => fs.existsSync(p));
assert.ok(browser, 'A local Chromium browser is required.');
const profile = path.join(root, 'profile');
const proc = spawn(browser, ['--headless','--disable-gpu','--no-first-run','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=1300,900',pathToFileURL(file).href], {windowsHide:true,stdio:'ignore',env:{...process.env,TEMP:root,TMP:root,TMPDIR:root}});
let ws, id = 0;
const pending = new Map();
try {
  let port;
  for(let n=0;n<100;n++) {try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}await pause(50);}
  assert.ok(port,'Chromium did not expose the isolated debugger');
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=pages.find(p=>p.type==='page'&&p.url===pathToFileURL(file).href);assert.ok(page,'Synthetic page did not load');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error('CDP timeout: '+method));},5000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const check=async(expression,message)=>assert.ok(await evaluate(expression),message);
  const waitFor=async(expression,message)=>{for(let n=0;n<80;n++){if(await evaluate(expression))return;await pause(30);}throw new Error(message+'; '+JSON.stringify(await evaluate(`({errors:window.testErrors,nodes:document.querySelectorAll('.onode').length,classes:document.body.className})`)));};
  const rect=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()`);
  const move=async(x,y)=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,buttons:0});await pause(80);};
  const moveTo=async selector=>{const r=await rect(selector);assert.ok(r.width>0&&r.height>0,'Target not visible: '+selector);await move(r.x+r.width/2,r.y+r.height/2);};
  const click=async selector=>{await moveTo(selector);const r=await rect(selector);const p={x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1};await call('Input.dispatchMouseEvent',{type:'mousePressed',buttons:1,...p});await call('Input.dispatchMouseEvent',{type:'mouseReleased',buttons:0,...p});await pause(100);};
  const shot=async name=>{await pause(200);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,name),Buffer.from(r.data,'base64'));};
  await waitFor(`document.querySelectorAll('.onode').length===3`,'Three synthetic organization nodes did not render');
  await check(`testErrors.length===0`,'UI bootstrap errors');
  await check(`[...document.querySelectorAll('.onode .oarchive')].length===3&&[...document.querySelectorAll('.onode .oarchive')].every(b=>b.textContent.includes('存档')&&b.getBoundingClientRect().height>0)`,'Tree must always show explicit archive buttons');
  await check(`[...document.querySelectorAll('.onode .orecap')].every(b=>b.getBoundingClientRect().height>0)`,'Tree must retain recap buttons');
  await evaluate(`window.initialMutations=testCalls.filter(c=>c.method!=='GET').length;window.initialDetailCalls=testCalls.filter(c=>c.url.startsWith('/api/turns')||c.url==='/api/focus').length`);
  await shot('org-archive-tree.png');
  await click('.onode[data-sid="done"] .orecap');await check(`document.querySelector('#recapDlg').open`,'Recap action retained');await evaluate(`document.querySelector('#recapDlg').close()`);await pause(80);
  await click('[data-oshape="map"]');await waitFor(`document.querySelector('#org').classList.contains('map')`,'Map view not selected');
  await move(1250,850);await evaluate(`document.activeElement?.blur();orgSetHot(null)`);await pause(80);
  // Force only CSS :hover without the JS expansion, covering the compact fallback selector.
  await call('DOM.enable');await call('CSS.enable');const dom=await call('DOM.getDocument');const target=await call('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'.onode[data-sid="done"]'});
  await call('CSS.forcePseudoState',{nodeId:target.nodeId,forcedPseudoClasses:['hover']});
  await check(`!document.querySelector('.onode[data-sid="done"]').parentElement.classList.contains('hot1')&&document.querySelector('.onode[data-sid="done"] .oarchive').getBoundingClientRect().height>0`,'Compact CSS hover must reveal archive without relying on expansion');
  await call('CSS.forcePseudoState',{nodeId:target.nodeId,forcedPseudoClasses:[]});
  await moveTo('.onode[data-sid="done"] .ot');
  await check(`document.querySelector('.onode[data-sid="done"]').parentElement.classList.contains('hot1')`,'Real mouse hover should expand node');
  await moveTo('.onode[data-sid="done"] .oarchive');
  await check(`(()=>{const b=document.querySelector('.onode[data-sid="done"] .oarchive'),r=b.getBoundingClientRect();return b.matches(':hover')&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`,'Archive button must remain reachable while mouse moves into it');
  await check(`document.querySelector('.onode[data-sid="done"] .orecap').getBoundingClientRect().height>0`,'Expanded map retains recap');
  await shot('org-archive-map.png');
  await check(`testCalls.filter(c=>c.url==='/api/archive').length===0`,'Hover and recap must not archive');
  await moveTo('.onode[data-sid="failed"] .ot');await click('.onode[data-sid="failed"] .oarchive');
  await check(`!!document.querySelector('.onode[data-sid="failed"]')&&document.querySelector('#toast').textContent.includes('合成存档失败')`,'Archive failure must retain node and show error');
  await check(`!document.querySelector('#detail').open&&testCalls.filter(c=>c.url.startsWith('/api/turns')||c.url==='/api/focus').length===initialDetailCalls`,'Archive click must not bubble to detail or terminal');
  await evaluate(`window.writerOwned=true;window.beforeConflict=testCalls.filter(c=>c.method!=='GET').length;window.conflictLocation=location.href`);
  await moveTo('.onode[data-sid="failed"] .ot');await click('.onode[data-sid="failed"] .oarchive');
  await check(`document.querySelector('#archiveBlocked').open&&document.querySelector('#archiveBlocked').textContent.includes('当前 CCBoard 使用独立服务')&&document.querySelector('#archiveBlockedChat').textContent==='存档失败应保留的合成任务'`,'Writer conflict must show persistent explanation tied to the chat');
  await check(`!!document.querySelector('.onode[data-sid="failed"]')&&location.href===conflictLocation&&testCalls.filter(c=>c.method!=='GET').length===beforeConflict+1`,'Writer conflict must retain node without navigation or additional mutations');
  await check(`testCalls.filter(c=>c.url.startsWith('/api/turns')||c.url==='/api/focus').length===initialDetailCalls`,'Writer conflict must not open the original chat automatically');
  await shot('org-archive-writer-conflict.png');
  await click('#archiveBlocked .dbody [data-close]');await check(`!document.querySelector('#archiveBlocked').open`,'Writer conflict explanation can be closed');
  await evaluate(`window.writerOwned=false;window.beforeRetry=testCalls.filter(c=>c.url==='/api/archive'&&c.body.sid==='failed').length`);
  await moveTo('.onode[data-sid="failed"] .ot');await click('.onode[data-sid="failed"] .oarchive');
  await check(`testCalls.filter(c=>c.url==='/api/archive'&&c.body.sid==='failed').length===beforeRetry+1&&!document.querySelector('#archiveBlocked').open`,'Closing conflict must allow a fresh explicit retry');
  await moveTo('.onode[data-sid="busy"] .ot');await click('.onode[data-sid="busy"] .oarchive');
  await check(`!!document.querySelector('.onode[data-sid="busy"]')&&!document.querySelector('.onode[data-sid="busy"] .orunning').hidden&&document.querySelector('#toast').textContent.includes('仍在运行')`,'Busy rejection must keep running node and explain why');
  await evaluate(`window.holdArchive=true;window.beforeDone=testCalls.filter(c=>c.url==='/api/archive'&&c.body.sid==='done').length`);
  await moveTo('.onode[data-sid="done"] .ot');await click('.onode[data-sid="done"] .oarchive');
  await evaluate(`document.querySelector('.onode[data-sid="done"] .oarchive').click()`);await pause(80);
  await check(`testCalls.filter(c=>c.url==='/api/archive'&&c.body.sid==='done').length===beforeDone+1`,'Repeated archive click must send only one in-flight request');
  await evaluate(`window.releaseArchive()`);
  await waitFor(`!document.querySelector('.onode[data-sid="done"]')`,'Successful archive did not refresh the organization graph');
  await check(`document.querySelector('.oyn').textContent.includes('2 个窗口')&&document.querySelector('.oyn').textContent.includes('1 个在跑')`,'Central counts must refresh after archive');
  await check(`testCalls.filter(c=>c.method!=='GET').slice(initialMutations).every(c=>c.url==='/api/archive'&&c.method==='POST')`,'Archive interactions must only mutate through POST /api/archive');
  await check(`!document.querySelector('#detail').open&&testCalls.filter(c=>c.url.startsWith('/api/turns')||c.url==='/api/focus').length===initialDetailCalls`,'Archive requests must never trigger detail/focus');
  await check(`testErrors.length===0`,'Unexpected browser error during organization archive tests');
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({ok:true,tests:'tree/map hover, reachable buttons, recap retained, error/busy feedback, writer conflict explanation/retry/no navigation, duplicate request protection, success and central counts'},null,2));
  console.log('PASS: organization archive UI. Screenshots: '+path.join(root,'org-archive-tree.png')+' ; '+path.join(root,'org-archive-map.png'));
} finally {
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Test cleanup'));}pending.clear();
  ws?.close();proc.kill();
}
