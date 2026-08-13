import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createTestWorkspace } from '../../test/helpers.mjs';
import { createRepositoryService } from '../server/repository-service.mjs';
import { startEditor } from '../server/app.mjs';
import { loadSiteRepository } from '../../src/lib/content/repository.mjs';

async function treeHash(root) { const h=createHash('sha256'); async function walk(dir){ for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){ const p=path.join(dir,e.name); h.update(path.relative(root,p)); if(e.isDirectory()) await walk(p); else h.update(await readFile(p)); }} await walk(root); return h.digest('hex'); }
async function raw(origin, target, { headers={}, method='GET' }={}) { const url=new URL(target,origin); return new Promise((resolve,reject)=>{ const req=http.request({hostname:url.hostname,port:url.port,path:url.pathname+url.search,method,headers,setHost:Object.keys(headers).some((name)=>name.toLowerCase()==='host')},res=>{let data='';res.setEncoding('utf8');res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:data}));});req.on('error',reject);req.end();}); }

const windowsPath = (...segments) => ['C:', ...segments].join('\\');
const browserCandidates = process.platform === 'win32'
  ? [windowsPath('Program Files','Google','Chrome','Application','chrome.exe'), windowsPath('Program Files (x86)','Microsoft','Edge','Application','msedge.exe')]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
async function findBrowser() { for (const candidate of [process.env.EDITOR_TEST_BROWSER, ...browserCandidates]) { if (!candidate) continue; try { await access(candidate); return candidate; } catch {} } throw new Error('真实 Chromium 浏览器不可用；设置 EDITOR_TEST_BROWSER'); }
async function waitFor(read, timeout=10000) { const deadline=Date.now()+timeout; let last; while(Date.now()<deadline){ try{return await read();}catch(error){last=error;await new Promise(resolve=>setTimeout(resolve,25));} } throw last ?? new Error('等待浏览器超时'); }
async function jsonRequest(port, pathname) { const response=await raw(`http://127.0.0.1:${port}`,pathname,{headers:{Host:`127.0.0.1:${port}`}}); if(response.status!==200) throw new Error(`浏览器调试端点返回 ${response.status}`); return JSON.parse(response.body); }
class Cdp {
  constructor(socket) { this.socket=socket; this.nextId=1; this.pending=new Map(); this.events=[]; socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const pending=this.pending.get(message.id);this.pending.delete(message.id);if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result);}else this.events.push(message);}); }
  static async connect(url) { const socket=new WebSocket(url); await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});}); return new Cdp(socket); }
  send(method,params={}) { const id=this.nextId++; return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}));}); }
  async wait(method, after=0, timeout=10000) { return waitFor(()=>{const found=this.events.slice(after).find(event=>event.method===method);if(!found)throw new Error(`等待 ${method}`);return found;},timeout); }
  close() { this.socket.close(); }
}
async function startBrowser(workspace) {
  const executable=await findBrowser(); const profile=path.join(workspace.parent,'browser-profile');
  const child=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','about:blank'],{stdio:'ignore',windowsHide:true});
  let stopped=false; let cdp;
  const exited=new Promise(resolve=>child.once('exit',resolve));
  const stop=async()=>{if(stopped)return;stopped=true;try{await cdp?.send('Browser.close');}catch{} await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);if(child.exitCode===null){child.kill();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);}cdp?.close();};
  child.once('exit',()=>{stopped=true;});
  const active=path.join(profile,'DevToolsActivePort');
  const [portText]=await waitFor(async()=>{const lines=(await readFile(active,'utf8')).trim().split(/\r?\n/);if(lines.length<2)throw new Error('调试端口尚未就绪');return lines;});
  const pages=await waitFor(async()=>{const values=await jsonRequest(Number(portText),'/json/list');const page=values.find(value=>value.type==='page'&&value.webSocketDebuggerUrl);if(!page)throw new Error('浏览器页面尚未就绪');return page;});
  cdp=await Cdp.connect(pages.webSocketDebuggerUrl); return {cdp,stop};
}

async function fixture(t) { const workspace=await createTestWorkspace(); const service=createRepositoryService({ projectRoot: workspace.root, csrfToken:'csrf-A' }); const started=await startEditor({projectRoot:workspace.root,preferredPort:0,token:'startup-A',csrfToken:'csrf-A',repositoryService:service}); t.after(async()=>{await started.close();await workspace.cleanup();}); return {workspace,...started}; }

test('repository loader routes every bootstrap read through its injected IO boundary', async (t) => {
  const workspace=await createTestWorkspace(); t.after(workspace.cleanup);
  let reads=0;
  const io={...await import('node:fs/promises'),readFile:async()=>{reads+=1;throw new Error('injected read boundary');}};
  await assert.rejects(loadSiteRepository({contentRoot:path.join(workspace.root,'src','content'),io}),/injected read boundary/);
  assert.equal(reads,1);
});

test('repository bootstrap cannot bypass its operation-bound filesystem', async (t) => {
  const workspace=await createTestWorkspace(); t.after(workspace.cleanup);
  let reads=0;
  const filesystem={...await import('node:fs/promises'),readFile:async()=>{reads+=1;throw new Error('operation-bound read');}};
  const service=createRepositoryService({projectRoot:workspace.root,csrfToken:'csrf-A',filesystem});
  await assert.rejects(service.bootstrap(),/operation-bound read/);
  assert.equal(reads,1);
});

test('bootstrap is one-time, no-Origin compatible, session-bound and read-only', async (t) => {
  const f=await fixture(t); const before=await treeHash(f.workspace.root);
  assert.match(f.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const first=await raw(f.origin,'/?session=startup-A',{headers:{Host:new URL(f.origin).host,'Sec-Fetch-Site':'none','Sec-Fetch-Mode':'navigate'}});
  assert.equal(first.status,302); assert.match(first.headers['set-cookie'][0],/HttpOnly; SameSite=Strict; Path=\//); assert.equal(first.headers.location,'/');
  assert.equal((await raw(f.origin,'/?session=startup-A',{headers:{Host:new URL(f.origin).host}})).status,401);
  const cookie=first.headers['set-cookie'][0].split(';')[0];
  const api=await raw(f.origin,'/api/bootstrap',{headers:{Host:new URL(f.origin).host,Cookie:cookie}}); assert.equal(api.status,200); const data=JSON.parse(api.body); assert.equal(data.csrfToken,'csrf-A'); assert.match(data.baseManifestHash,/^[0-9a-f]{64}$/);
  assert.equal(await treeHash(f.workspace.root),before);
});

test('Host, Origin, session, routes and methods fail closed without CORS', async (t) => {
  const f=await fixture(t), authority=new URL(f.origin).host;
  for(const headers of [{}, {Host:'evil.invalid'}, {Host:authority,Origin:'null'}, {Host:authority,Origin:`${f.origin}.evil`}]) { const r=await raw(f.origin,'/',{headers}); assert.ok([400,403].includes(r.status)); assert.equal(r.headers['access-control-allow-origin'],undefined); }
  assert.equal((await raw(f.origin,'/api/bootstrap',{headers:{Host:authority}})).status,401);
  assert.equal((await raw(f.origin,'/unknown',{headers:{Host:authority}})).status,404);
  assert.equal((await raw(f.origin,'/',{headers:{Host:authority},method:'POST'})).status,405);
});

test('responses provide restrictive browser security policy and preview sandbox', async (t) => {
  const f=await fixture(t), authority=new URL(f.origin).host;
  const boot=await raw(f.origin,'/?session=startup-A',{headers:{Host:authority}}), cookie=boot.headers['set-cookie'][0].split(';')[0];
  const shell=await raw(f.origin,'/',{headers:{Host:authority,Cookie:cookie}}); assert.equal(shell.status,200);
  assert.equal(shell.headers['cache-control'],'no-store'); assert.equal(shell.headers['referrer-policy'],'no-referrer'); assert.equal(shell.headers['x-content-type-options'],'nosniff');
  assert.equal(shell.headers['content-security-policy'],"default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'");
  assert.match(shell.body,/<iframe[^>]+sandbox=""/); assert.doesNotMatch(shell.body,/<script[^>]+src=["']https?:|<link[^>]+href=["']https?:/);
});

test('restart rotates credentials and external binding cannot be configured', async (t) => {
  const a=await fixture(t); const authority=new URL(a.origin).host; const boot=await raw(a.origin,'/?session=startup-A',{headers:{Host:authority}}); const oldCookie=boot.headers['set-cookie'][0].split(';')[0]; await a.close();
  const service=createRepositoryService({projectRoot:a.workspace.root,csrfToken:'csrf-B'}); const b=await startEditor({projectRoot:a.workspace.root,preferredPort:0,token:'startup-B',csrfToken:'csrf-B',repositoryService:service,host:'0.0.0.0'}); t.after(b.close);
  assert.equal(new URL(b.origin).hostname,'127.0.0.1'); assert.equal((await raw(b.origin,'/api/bootstrap',{headers:{Host:new URL(b.origin).host,Cookie:oldCookie}})).status,401);
});

test('ordinary browser navigation stays on exact loopback origin and bootstraps without Origin', async (t) => {
  const f=await fixture(t); const browser=await startBrowser(f.workspace); const {cdp}=browser;
  try {
    await cdp.send('Network.enable'); await cdp.send('Page.enable');
    const eventStart=cdp.events.length; await cdp.send('Page.navigate',{url:`${f.origin}/?session=startup-A`}); await cdp.wait('Page.loadEventFired',eventStart); await new Promise(resolve=>setTimeout(resolve,250));
    const requests=cdp.events.slice(eventStart).filter(event=>event.method==='Network.requestWillBeSent').map(event=>event.params.request);
    const bootstrap=requests.find(request=>request.url===`${f.origin}/?session=startup-A`); assert.ok(bootstrap); assert.equal(Object.keys(bootstrap.headers).some(name=>name.toLowerCase()==='origin'),false);
    assert.ok(requests.length>0); assert.deepEqual([...new Set(requests.map(request=>new URL(request.url).origin))],[f.origin]);
    const cookies=(await cdp.send('Network.getCookies',{urls:[f.origin]})).cookies; const sessionCookie=cookies.find(cookie=>cookie.name==='editor_session');
    assert.ok(sessionCookie); assert.equal(sessionCookie.httpOnly,true); assert.equal(sessionCookie.sameSite,'Strict'); assert.equal(sessionCookie.path,'/');
    const page=(await cdp.send('Runtime.evaluate',{expression:`({url:location.href,title:document.querySelector('h1')?.textContent,sandbox:document.querySelector('iframe')?.getAttribute('sandbox'),iframeSrc:document.querySelector('iframe')?.getAttribute('src')})`,returnByValue:true})).result.value;
    assert.deepEqual(page,{url:`${f.origin}/`,title:'本地内容编辑器',sandbox:'',iframeSrc:null});
  } finally { await browser.stop(); }
});
