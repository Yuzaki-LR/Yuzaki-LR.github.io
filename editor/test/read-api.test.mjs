import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTestWorkspace } from '../../test/helpers.mjs';
import { createRepositoryService } from '../server/repository-service.mjs';
import { startEditor as startEditorServer } from '../server/app.mjs';
import { loadSiteRepository } from '../../src/lib/content/repository.mjs';

const readyTransactionService={recoverBeforeListen:async()=>({ok:true,recoveryOnly:false,results:[]}),runMutation:async(action)=>action()};
const startEditor=(options)=>startEditorServer({...options,transactionService:readyTransactionService});
const legacyEditorScreenshot=new URL('../../.superpowers/sdd/2026-08-12-yunxi-academic-website-editor-redesign/task-8-editor.png',import.meta.url);

async function writeBrowserScreenshot(workspace,bytes){
  const output=path.join(workspace.parent,'browser-evidence.png');
  await writeFile(output,bytes);
  return output;
}

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

test('browser screenshot evidence stays inside its sentinel workspace', async () => {
  const workspace=await createTestWorkspace();
  let legacyBefore;
  try {
    legacyBefore=await readFile(legacyEditorScreenshot);
  } catch(error) {
    if(error?.code!=='ENOENT') throw error;
    legacyBefore=null;
  }
  try {
    const output=await writeBrowserScreenshot(workspace,Buffer.from('owned browser evidence'));
    const ownedParent=await realpath(workspace.parent),resolvedOutput=await realpath(output);
    assert.ok(resolvedOutput.startsWith(`${ownedParent}${path.sep}`),`${resolvedOutput} escapes the sentinel workspace`);
  } finally {
    let legacyAfter;
    try {
      legacyAfter=await readFile(legacyEditorScreenshot);
    } catch(error) {
      if(error?.code!=='ENOENT') throw error;
      legacyAfter=null;
    }
    const legacyUnchanged=legacyBefore===null?legacyAfter===null:legacyAfter!==null&&legacyBefore.equals(legacyAfter);
    if(!legacyUnchanged){
      if(legacyBefore===null) await rm(legacyEditorScreenshot,{force:true});
      else await writeFile(legacyEditorScreenshot,legacyBefore);
    }
    await workspace.cleanup();
  }
});

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

test('bootstrap exposes complete deterministic image descriptors without bytes or local paths', async (t) => {
  const f=await fixture(t), authority=new URL(f.origin).host;
  const boot=await raw(f.origin,'/?session=startup-A',{headers:{Host:authority}}), cookie=boot.headers['set-cookie'][0].split(';')[0];
  const response=await raw(f.origin,'/api/bootstrap',{headers:{Host:authority,Cookie:cookie}}), data=JSON.parse(response.body);
  assert.ok(data.images.length>0);
  assert.deepEqual([...data.images].map(image=>image.destination),[...data.images].map(image=>image.destination).sort());
  for(const image of data.images){
    assert.deepEqual(Object.keys(image).sort(),(image.kind==='project'?['destination','kind','name','sha256','slug']:['destination','kind','name','sha256']).sort());
    assert.match(image.destination,/^(?:site-images|projects\/[a-z0-9-]+\/images)\/[a-zA-Z0-9_-]+\.png$/);
    assert.match(image.sha256,/^[a-f0-9]{64}$/); assert.equal(JSON.stringify(image).includes('sourcePath'),false); assert.equal(JSON.stringify(image).includes('bytes'),false);
  }
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
  const sandbox=shell.body.match(/<iframe[^>]+sandbox="([^"]*)"/)?.[1]; assert.equal(sandbox,'allow-same-origin'); assert.doesNotMatch(sandbox,/allow-scripts|forms|popups|downloads|modals|pointer-lock|top-navigation/); assert.doesNotMatch(shell.body,/<script[^>]+src=["']https?:|<link[^>]+href=["']https?:/);
});

test('only the closed editor asset manifest is served with exact paths and MIME types', async (t) => {
  const f=await fixture(t), authority=new URL(f.origin).host;
  const boot=await raw(f.origin,'/?session=startup-A',{headers:{Host:authority}}), cookie=boot.headers['set-cookie'][0].split(';')[0];
  const headers={Host:authority,Cookie:cookie};
  const before=await treeHash(f.workspace.root);
  const allowed=[
    ['/assets/styles.css','text/css; charset=utf-8'],
    ['/assets/public-global.css','text/css; charset=utf-8'],
    ['/modules/app.mjs','text/javascript; charset=utf-8'],
    ['/modules/draft-store.mjs','text/javascript; charset=utf-8'],
    ['/modules/forms.mjs','text/javascript; charset=utf-8'],
    ['/modules/preview.mjs','text/javascript; charset=utf-8'],
    ['/modules/preview-model.mjs','text/javascript; charset=utf-8'],
    ['/src/lib/content/contrast.mjs','text/javascript; charset=utf-8'],
  ];
  for (const [target,type] of allowed) {
    const response=await raw(f.origin,target,{headers});
    assert.equal(response.status,200,target);
    assert.equal(response.headers['content-type'],type,target);
    assert.equal(response.headers['cache-control'],'no-store',target);
  }
  for (const target of [
    '/modules/unknown.mjs','/modules/App.mjs','/modules/app.mjs.map',
    '/modules/%61pp.mjs','/modules/%2e%2e/app.mjs','/modules/%252e%252e/app.mjs',
    '/modules/%5capp.mjs','/assets/Public-global.css','/assets/%70ublic-global.css',
    '/src/lib/content/Contrast.mjs','/src/lib/content/contrast.mjs.map','/src/lib/content/schema.mjs',
    '/src/lib/content/%63ontrast.mjs','/src/lib/content/%2e%2e/contrast.mjs','/src/lib/content/%252e%252e/contrast.mjs',
  ]) assert.equal((await raw(f.origin,target,{headers})).status,404,target);
  assert.equal(await treeHash(f.workspace.root),before);
});

test('restart rotates credentials and external binding cannot be configured', async (t) => {
  const a=await fixture(t); const authority=new URL(a.origin).host; const boot=await raw(a.origin,'/?session=startup-A',{headers:{Host:authority}}); const oldCookie=boot.headers['set-cookie'][0].split(';')[0]; await a.close();
  const service=createRepositoryService({projectRoot:a.workspace.root,csrfToken:'csrf-B'}); const b=await startEditor({projectRoot:a.workspace.root,preferredPort:0,token:'startup-B',csrfToken:'csrf-B',repositoryService:service,host:'0.0.0.0'}); t.after(b.close);
  assert.equal(new URL(b.origin).hostname,'127.0.0.1'); assert.equal((await raw(b.origin,'/api/bootstrap',{headers:{Host:new URL(b.origin).host,Cookie:oldCookie}})).status,401);
});

test('ordinary browser navigation stays on exact loopback origin and bootstraps without Origin', async (t) => {
  const f=await fixture(t),before=await treeHash(f.workspace.root); const browser=await startBrowser(f.workspace); const {cdp}=browser;
  try {
    await cdp.send('Network.enable'); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const eventStart=cdp.events.length; await cdp.send('Page.navigate',{url:`${f.origin}/?session=startup-A`}); await cdp.wait('Page.loadEventFired',eventStart); await new Promise(resolve=>setTimeout(resolve,250));
    const requests=cdp.events.slice(eventStart).filter(event=>event.method==='Network.requestWillBeSent').map(event=>event.params.request);
    const bootstrap=requests.find(request=>request.url===`${f.origin}/?session=startup-A`); assert.ok(bootstrap); assert.equal(Object.keys(bootstrap.headers).some(name=>name.toLowerCase()==='origin'),false);
    assert.ok(requests.length>0); assert.deepEqual([...new Set(requests.map(request=>new URL(request.url).origin))],[f.origin]);
    const cookies=(await cdp.send('Network.getCookies',{urls:[f.origin]})).cookies; const sessionCookie=cookies.find(cookie=>cookie.name==='editor_session');
    assert.ok(sessionCookie); assert.equal(sessionCookie.httpOnly,true); assert.equal(sessionCookie.sameSite,'Strict'); assert.equal(sessionCookie.path,'/');
    const page=await waitFor(async()=>{const value=(await cdp.send('Runtime.evaluate',{expression:`({url:location.href,title:document.querySelector('h1')?.textContent,sandbox:document.querySelector('iframe')?.getAttribute('sandbox'),iframeSrc:document.querySelector('iframe')?.getAttribute('src'),status:document.querySelector('#draft-status')?.textContent,nav:[...document.querySelectorAll('.editor-nav button')].map(x=>x.textContent.trim()),viewports:[...document.querySelectorAll('.viewport-switcher button')].map(x=>x.textContent.trim()),preview:document.querySelector('iframe')?.contentDocument?.querySelector('main')?.textContent?.trim()})`,returnByValue:true})).result.value;if(!value.preview){const exceptions=cdp.events.slice(eventStart).filter(event=>event.method==='Runtime.exceptionThrown').map(event=>event.params.exceptionDetails);const failures=cdp.events.slice(eventStart).filter(event=>event.method==='Network.loadingFailed').map(event=>event.params);throw new Error(`预览尚未渲染: ${JSON.stringify({value,exceptions,failures})}`);}return value;});
    assert.deepEqual(page,{url:`${f.origin}/`,title:'内容校样台',sandbox:'allow-same-origin',iframeSrc:null,status:'规范内容 · 只在内存中编辑',nav:['全站资料','首页','研究与稿件','项目','外观','备份'],viewports:['桌面','平板','手机'],preview:page.preview}); assert.match(page.preview,/About/);
    const surfaces=(await cdp.send('Runtime.evaluate',{expression:`(async()=>{
      const wait=()=>new Promise(resolve=>setTimeout(resolve,25)),click=text=>{const button=[...document.querySelectorAll('.editor-nav button')].find(value=>value.textContent.trim()===text);button?.click();return Boolean(button);},clickInspector=text=>{const button=[...document.querySelectorAll('#inspector-fields button')].find(value=>value.textContent.trim()===text);button?.click();return Boolean(button);},labels=()=>[...document.querySelectorAll('#inspector-fields label')].map(label=>label.childNodes[0]?.textContent?.trim()??label.textContent.trim()),buttons=()=>[...document.querySelectorAll('#inspector-fields button')].map(button=>button.textContent.trim());
      click('全站资料');await wait();const siteLabels=labels();const name=document.querySelector('[name="site-name"]');if(name){name.value='Edited in browser';name.dispatchEvent(new Event('change',{bubbles:true}));await wait();}const siteEdited=document.querySelector('[name="site-name"]')?.value??null;
      click('首页');await wait();const aboutBefore=document.querySelectorAll('[data-document-section]').length;const aboutAdded=clickInspector('新增章节');await wait();const aboutAfter=document.querySelectorAll('[data-document-section]').length;
      click('研究与稿件');await wait();const researchBefore=document.querySelectorAll('[data-research-record]').length;const researchAdded=clickInspector('新增稿件');await wait();const researchAfter=document.querySelectorAll('[data-research-record]').length;
      click('项目');await wait();const projectCards=document.querySelectorAll('[data-project-record]').length,contribution=[...document.querySelectorAll('.section-card')].find(card=>card.querySelector('input:disabled')?.value==='My Role and Contribution'),contributionButtons=[...(contribution?.querySelectorAll('button')??[])].map(button=>button.textContent.trim()),contributionBody=contribution?.querySelector('textarea');if(contributionBody){contributionBody.value='';contributionBody.dispatchEvent(new Event('change',{bubbles:true}));await wait();}const contributionCleared=contributionBody?.value==='' ;const detailOpened=clickInspector('编辑项目详情');await wait();const detailHeading=document.querySelector('iframe').contentDocument.querySelector('h1')?.textContent?.trim();
      click('外观');await wait();const appearanceLabels=labels(),hasAddLink=buttons().includes('新增链接');
      click('备份');await wait();const importButton=[...document.querySelectorAll('#inspector-fields button')].find(button=>button.textContent.includes('导入图片')),backupWarning=document.querySelector('#inspector-fields')?.textContent??'';
      return{siteLabels,siteEdited,status:document.querySelector('#draft-status').textContent,aboutBefore,aboutAfter,aboutAdded,researchBefore,researchAfter,researchAdded,projectCards,contributionButtons,contributionCleared,detailOpened,detailHeading,appearanceLabels,hasAddLink,hasLegacyImportButton:Boolean(importButton),backupWarning};
    })()`,awaitPromise:true,returnByValue:true})).result.value;
    assert.ok(['姓名','学位','学校','邮箱','简介'].every(label=>surfaces.siteLabels.includes(label)),JSON.stringify(surfaces)); assert.equal(surfaces.siteEdited,'Edited in browser'); assert.equal(surfaces.status,'有未保存更改');
    assert.equal(surfaces.aboutAdded,true); assert.equal(surfaces.aboutAfter,surfaces.aboutBefore+1); assert.equal(surfaces.researchAdded,true); assert.equal(surfaces.researchAfter,surfaces.researchBefore+1); assert.ok(surfaces.projectCards>=3); assert.deepEqual(surfaces.contributionButtons,['上移','下移','上移','下移']);assert.equal(surfaces.contributionCleared,true);assert.equal(surfaces.detailOpened,true); assert.ok(surfaces.detailHeading); assert.ok(['背景','表面','正文','强调色','头像'].every(label=>surfaces.appearanceLabels.includes(label))); assert.equal(surfaces.hasAddLink,true); assert.equal(surfaces.hasLegacyImportButton,false); assert.match(surfaces.backupWarning,/Fig\.|report|报告|私密像素/);
    const messageBinding=(await cdp.send('Runtime.evaluate',{expression:`(async()=>{const wait=()=>new Promise(resolve=>setTimeout(resolve,25)),frame=document.querySelector('iframe');document.querySelector('[data-panel="site"]').click();await wait();dispatchEvent(new MessageEvent('message',{origin:location.origin,source:window,data:{type:'editor/select',editorId:'future-ocean-habitat'}}));await wait();const forged=Boolean(document.querySelector('[data-editor-id="future-ocean-habitat"]'));document.querySelector('[data-route="/projects/"]').click();await wait();const topBefore=location.href,frameBefore=frame.contentWindow.location.href,target=frame.contentDocument.querySelector('[data-editor-id="future-ocean-habitat"]');target.click();await wait();return{forged,selected:Boolean(document.querySelector('[data-editor-id="future-ocean-habitat"]')),detail:frame.contentDocument.querySelector('h1')?.textContent?.trim(),topBefore,topAfter:location.href,frameBefore,frameAfter:frame.contentWindow.location.href};})()`,awaitPromise:true,returnByValue:true})).result.value;
    assert.equal(messageBinding.forged,false); assert.equal(messageBinding.selected,true,JSON.stringify(messageBinding)); assert.match(messageBinding.detail,/^Future Ocean Habitat/); assert.equal(messageBinding.topAfter,messageBinding.topBefore); assert.equal(messageBinding.frameAfter,messageBinding.frameBefore);
    const imageRemovalResult=await cdp.send('Runtime.evaluate',{expression:`(async()=>{const {createDraftStore,toCandidateBundle}=await import('/modules/draft-store.mjs'),bootstrap=await fetch('/api/bootstrap',{credentials:'same-origin'}).then(response=>response.json()),store=createDraftStore(bootstrap);let target;for(let projectIndex=0;projectIndex<store.getState().projects.length&&!target;projectIndex+=1){const document=store.getState().projects[projectIndex].document;for(let sectionIndex=0;sectionIndex<document.sections.length&&!target;sectionIndex+=1){const block=document.sections[sectionIndex].blocks.find(value=>value.type==='image');if(block)target={projectIndex,sectionIndex,id:block.id,destination:'projects/'+store.getState().projects[projectIndex].slug+'/images/'+block.markdown.split('./images/')[1].split(')')[0]};}}if(!target)throw new Error('缺少可删除的规范图片块');store.dispatch({type:'item/remove',path:['projects',target.projectIndex,'document','sections',target.sectionIndex,'blocks'],id:target.id});const candidate=toCandidateBundle(store.getState(),{sessionId:'browser-check',uploads:[],resolveCanonical:()=>true,resolveUpload:()=>true});return{dirty:store.isDirty(),ready:!store.getState().saveDisabled,removed:!candidate.images.some(image=>image.destination===target.destination),descriptorRetained:store.getState().images.some(image=>image.destination===target.destination)};})()`,awaitPromise:true,returnByValue:true});if(imageRemovalResult.exceptionDetails)throw new Error(`浏览器图片删除检查失败: ${imageRemovalResult.exceptionDetails.exception?.description??imageRemovalResult.exceptionDetails.text}`);const imageRemoval=imageRemovalResult.result.value;
    assert.deepEqual(imageRemoval,{dirty:true,ready:true,removed:true,descriptorRetained:true});
    const clickResult=(await cdp.send('Runtime.evaluate',{expression:`(async()=>{const frame=document.querySelector('iframe'),selectable=frame.contentDocument.querySelector('[data-editor-id]'),link=frame.contentDocument.querySelector('a[href]'),topBefore=location.href,frameBefore=frame.contentWindow.location.href;selectable.click();await new Promise(r=>setTimeout(r,50));const selected=Boolean(document.querySelector('[data-editor-id="'+selectable.dataset.editorId+'"]'));if(link){link.href='https://example.invalid/outbound';link.click();await new Promise(r=>setTimeout(r,50));}return {topBefore,topAfter:location.href,frameBefore,frameAfter:frame.contentWindow.location.href,selected};})()`,awaitPromise:true,returnByValue:true})).result.value;
    assert.equal(clickResult.topAfter,clickResult.topBefore);assert.equal(clickResult.frameAfter,clickResult.frameBefore);assert.equal(clickResult.selected,true);
    const viewportResult=(await cdp.send('Runtime.evaluate',{expression:`(()=>{const result=[];for(const button of document.querySelectorAll('.viewport-switcher [data-width]')){button.click();result.push({label:button.textContent.trim(),width:document.querySelector('.preview-stage').dataset.width,status:document.querySelector('#draft-status').textContent});}return result;})()`,returnByValue:true})).result.value;
    assert.deepEqual(viewportResult,[{label:'桌面',width:'desktop',status:'有未保存更改'},{label:'平板',width:'tablet',status:'有未保存更改'},{label:'手机',width:'mobile',status:'有未保存更改'}]);
    const screenshot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeBrowserScreenshot(f.workspace,Buffer.from(screenshot.data,'base64'));
    assert.equal(requests.some(request=>request.method!=='GET'),false);
    assert.deepEqual([...new Set(cdp.events.slice(eventStart).filter(event=>event.method==='Network.requestWillBeSent').map(event=>new URL(event.params.request.url).origin))],[f.origin]);
    assert.deepEqual(cdp.events.slice(eventStart).filter(event=>event.method==='Runtime.exceptionThrown').map(event=>event.params.exceptionDetails.text),[]);
    assert.equal(await treeHash(f.workspace.root),before);
  } finally { await browser.stop(); }
});
