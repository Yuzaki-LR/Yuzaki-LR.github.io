import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../test/helpers.mjs';
import { startEditor } from '../server/app.mjs';
import { createRepositoryService } from '../server/repository-service.mjs';
import { createTransactionService } from '../server/transaction-service.mjs';

const windowsPath = (...segments) => ['C:', ...segments].join('\\');
const browserCandidates = process.platform === 'win32'
  ? [windowsPath('Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'), windowsPath('Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

async function findBrowser() {
  for (const candidate of [process.env.EDITOR_TEST_BROWSER, ...browserCandidates]) {
    if (!candidate) continue;
    try { await access(candidate); return candidate; } catch {}
  }
  throw new Error('真实 Chromium 浏览器不可用；设置 EDITOR_TEST_BROWSER');
}
async function waitFor(read, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { return await read(); } catch (error) { last = error; await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  throw last ?? new Error('等待浏览器超时');
}
async function raw(origin, target) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { Host: url.host } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end();
  });
}
class Cdp {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map(); this.events = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) { const pending = this.pending.get(message.id); this.pending.delete(message.id); if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result); }
      else this.events.push(message);
    });
  }
  static async connect(url) { const socket = new WebSocket(url); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); }); return new Cdp(socket); }
  send(method, params = {}) { const id = this.nextId++; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  async wait(method, after = 0, timeout = 10_000) { return waitFor(() => { const found = this.events.slice(after).find((event) => event.method === method); if (!found) throw new Error(`等待 ${method}`); return found; }, timeout); }
  close() { this.socket.close(); }
}
async function waitForExit(exited, timeout, message) {
  let timer;
  try {
    await Promise.race([
      exited,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function terminateBrowser(child, exited, hasExited) {
  if (hasExited()) return;
  child.kill();
  try { await waitForExit(exited, 2_000, 'browser did not exit after termination'); }
  catch {
    if (!hasExited()) child.kill('SIGKILL');
    await waitForExit(exited, 2_000, 'browser did not confirm forced exit');
  }
}
async function startBrowser(profileRoot, { spawnBrowser = spawn, observeDebugOrigin = () => {}, connectBrowser = Cdp.connect } = {}) {
  const executable = await findBrowser();
  const profile = path.join(profileRoot, 'task11-browser-profile');
  const child = spawnBrowser(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--metrics-recording-only', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let exitConfirmed = false;
  const exited = new Promise((resolve) => child.once('exit', (...values) => { exitConfirmed = true; resolve(values); }));
  let cdp;
  try {
    const active = path.join(profile, 'DevToolsActivePort');
    const [portText] = await waitFor(async () => { const lines = (await readFile(active, 'utf8')).trim().split(/\r?\n/); if (lines.length < 2) throw new Error('浏览器调试端口尚未就绪'); return lines; });
    const debugOrigin = `http://127.0.0.1:${portText}`;
    observeDebugOrigin(debugOrigin);
    const pages = await waitFor(async () => { const result = JSON.parse((await raw(debugOrigin, '/json/list')).body).find((value) => value.type === 'page' && value.webSocketDebuggerUrl); if (!result) throw new Error('浏览器页面尚未就绪'); return result; });
    cdp = await connectBrowser(pages.webSocketDebuggerUrl);
  } catch (setupError) {
    let cleanupError;
    try { await terminateBrowser(child, exited, () => exitConfirmed); } catch (error) { cleanupError = error; }
    try { await rm(profile, { recursive: true, force: true }); } catch (error) { cleanupError ??= error; }
    if (cleanupError) throw new AggregateError([setupError, cleanupError], 'browser setup cleanup failed');
    throw setupError;
  }
  let stopped = false;
  return { cdp, stop: async () => {
    if (stopped) return;
    stopped = true;
    try { await cdp.send('Browser.close'); } catch {}
    try { await waitForExit(exited, 2_000, 'browser close did not confirm exit'); }
    catch { await terminateBrowser(child, exited, () => exitConfirmed); }
    finally { cdp.close(); }
    await rm(profile, { recursive: true, force: true });
  } };
}
async function cleanupBrowserFixture({ browser, editor, workspace }) {
  const errors = [];
  for (const cleanup of [
    () => browser?.stop(),
    () => editor?.close(),
    () => workspace.cleanup(),
  ]) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'browser fixture cleanup failed');
}

test('a browser setup failure closes its DevTools listener and removes its owned profile', { timeout: 10_000 }, async () => {
  const workspace = await createTestWorkspace();
  const profile = path.join(workspace.parent, 'task11-browser-profile');
  const setupFailure = new Error('browser setup failure sentinel');
  let ownedChild;
  let ownedExitConfirmed = false;
  let ownedExited;
  let debugOrigin;
  let setup;
  let startedBrowser;
  try {
    setup = startBrowser(workspace.parent, {
      spawnBrowser: (...arguments_) => {
        ownedChild = spawn(...arguments_);
        ownedExited = new Promise((resolve) => ownedChild.once('exit', (...values) => { ownedExitConfirmed = true; resolve(values); }));
        return ownedChild;
      },
      observeDebugOrigin: (origin) => { debugOrigin = origin; },
      connectBrowser: async () => { throw setupFailure; },
    });
    setup.catch(() => {});
    let setupTimer;
    let observedError;
    try {
      startedBrowser = await Promise.race([
        setup,
        new Promise((_, reject) => { setupTimer = setTimeout(() => reject(new Error('outer browser setup cleanup timeout')), 3_000); }),
      ]);
    } catch (error) {
      observedError = error;
    } finally { clearTimeout(setupTimer); }
    assert.equal(observedError, setupFailure);
    assert.ok(debugOrigin, 'debug origin must be captured before the injected connection failure');
    assert.equal(ownedExitConfirmed, true, 'startBrowser must confirm its owned child exit');
    await assert.rejects(raw(debugOrigin, '/json/list'));
    await assert.rejects(access(profile));
  } finally {
    await startedBrowser?.stop().catch(() => {});
    if (ownedChild && !ownedExitConfirmed) await terminateBrowser(ownedChild, ownedExited, () => ownedExitConfirmed);
    await setup?.catch(() => {});
    if (debugOrigin) {
      try {
        const page = JSON.parse((await raw(debugOrigin, '/json/list')).body).find((value) => value.type === 'page' && value.webSocketDebuggerUrl);
        if (page) {
          const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
          try { await cdp.send('Browser.close'); } finally { cdp.close(); }
        }
      } catch {}
      await waitFor(async () => {
        try { await raw(debugOrigin, '/json/list'); } catch { return true; }
        throw new Error('leaked browser listener still active');
      });
    }
    await waitFor(async () => { await rm(profile, { recursive: true, force: true }); return true; });
    await workspace.cleanup();
  }
});
test('browser fixture cleanup attempts every acquired resource when an earlier cleanup fails', async () => {
  const browserError = new Error('browser stop failure sentinel');
  let editorClosed = false;
  let workspaceCleaned = false;
  let observedError;
  try {
    await cleanupBrowserFixture({
      browser: { stop: async () => { throw browserError; } },
      editor: { close: async () => { editorClosed = true; } },
      workspace: { cleanup: async () => { workspaceCleaned = true; } },
    });
  } catch (error) {
    observedError = error;
  }
  assert.equal(editorClosed, true);
  assert.equal(workspaceCleaned, true);
  assert.ok(observedError instanceof AggregateError);
  assert.equal(observedError.message, 'browser fixture cleanup failed');
  assert.deepEqual(observedError.errors, [browserError]);
});
async function treeHash(root) {
  const hash = createHash('sha256');
  async function visit(directory) { for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const target = path.join(directory, entry.name); hash.update(path.relative(root, target)); if (entry.isDirectory()) await visit(target); else hash.update(await readFile(target)); } }
  await visit(root); return hash.digest('hex');
}

async function browserFixture(t, { failBuild = false } = {}) {
  const workspace = await createTestWorkspace();
  let editor;
  let browser;
  t.after(async () => cleanupBrowserFixture({ browser, editor, workspace }));
  const contentRoot = path.join(workspace.root, 'src', 'content');
  const distRoot = path.join(workspace.root, 'dist');
  const backupRoot = path.join(workspace.root, '.local-editor', 'backups');
  await mkdir(distRoot, { recursive: true }); await mkdir(backupRoot, { recursive: true });
  await writeFile(path.join(distRoot, 'index.html'), await readFile(path.join(contentRoot, 'site.yml')));
  const repositoryService = createRepositoryService({ projectRoot: workspace.root, csrfToken: 'csrf-A' });
  const transactionService = createTransactionService({ projectRoot: workspace.root, contentRoot, distRoot, backupRoot, buildCandidate: async ({ contentRoot: candidateContentRoot, distRoot: candidateDistRoot }) => { if (failBuild) throw new Error(`FORBIDDEN-${windowsPath('private', 'build-secret')}`); await writeFile(path.join(candidateDistRoot, 'index.html'), await readFile(path.join(candidateContentRoot, 'site.yml'))); } });
  editor = await startEditor({ projectRoot: workspace.root, token: 'startup-A', csrfToken: 'csrf-A', repositoryService, transactionService });
  browser = await startBrowser(workspace.parent);
  return { workspace, contentRoot, distRoot, editor, cdp: browser.cdp };
}

test('real Chromium keeps edits in memory until manual save, warns on refresh, then reloads the saved canonical preview', { timeout: 25_000 }, async (t) => {
  const value = await browserFixture(t);
  const { cdp } = value;
  await cdp.send('Network.enable'); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const eventStart = cdp.events.length;
  await cdp.send('Page.navigate', { url: `${value.editor.origin}/?session=startup-A` });
  await cdp.wait('Page.loadEventFired', eventStart);
  const before = { content: await treeHash(value.contentRoot), dist: await treeHash(value.distRoot) };
  const edited = await waitFor(async () => {
    const result = await cdp.send('Runtime.evaluate', { expression: `(async()=>{const wait=()=>new Promise(resolve=>setTimeout(resolve,25));document.querySelector('[data-panel="site"]')?.click();await wait();const input=document.querySelector('[name="site-name"]'),save=document.querySelector('#save-button');if(!input||!save)throw new Error('save UI unavailable');const original=input.value;input.value='浏览器保存后的姓名';input.dispatchEvent(new Event('change',{bubbles:true}));await wait();const warning=new Event('beforeunload',{cancelable:true});dispatchEvent(warning);return{label:save.textContent.trim(),disabled:save.disabled,status:document.querySelector('#draft-status').textContent,warning:warning.defaultPrevented,original};})()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  });
  const { original, ...editedState } = edited;
  assert.ok(original);
  assert.deepEqual(editedState, { label: '保存并生成网站', disabled: false, status: '有未保存更改', warning: true });
  assert.deepEqual({ content: await treeHash(value.contentRoot), dist: await treeHash(value.distRoot) }, before);
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#save-button').click()` });
  const reloaded = await waitFor(async () => {
    const result = await cdp.send('Runtime.evaluate', { expression: `(()=>{if(!document.querySelector('[name="site-name"]'))document.querySelector('[data-panel="site"]')?.click();return{name:document.querySelector('[name="site-name"]')?.value,status:document.querySelector('#draft-status')?.textContent,label:document.querySelector('#save-button')?.textContent?.trim()};})()`, returnByValue: true });
    const state = result.result.value;
    if (state?.name !== '浏览器保存后的姓名' || state.status !== '规范内容 · 只在内存中编辑') throw new Error(`保存后页面尚未就绪: ${JSON.stringify(state)}`);
    return state;
  }, 15_000);
  assert.equal(reloaded.label, '保存并生成网站');
  assert.notDeepEqual({ content: await treeHash(value.contentRoot), dist: await treeHash(value.distRoot) }, before);
  assert.match(await readFile(path.join(value.distRoot, 'index.html'), 'utf8'), /浏览器保存后的姓名/);
  const requests = cdp.events.slice(eventStart).filter((event) => event.method === 'Network.requestWillBeSent' && /^https?:/.test(event.params.request.url)).map((event) => event.params.request);
  assert.deepEqual([...new Set(requests.map((request) => new URL(request.url).origin))], [value.editor.origin]);
  assert.equal(requests.filter((request) => request.url === `${value.editor.origin}/api/save` && request.method === 'POST').length, 1);

  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-panel="backup"]').click()` });
  const backup = await waitFor(async () => {
    const result = await cdp.send('Runtime.evaluate', { expression: `(()=>{const button=[...document.querySelectorAll('#inspector-fields button')].find(value=>value.textContent.trim()==='查看差异');return{text:document.querySelector('#inspector-fields')?.textContent??'',ready:Boolean(button)};})()`, returnByValue: true });
    if (!result.result.value.ready) throw new Error('备份列表尚未就绪');
    return result.result.value;
  });
  assert.match(backup.text, /保存|save/);
  await cdp.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('#inspector-fields button')].find(value=>value.textContent.trim()==='查看差异').click()` });
  const restoreReady = await waitFor(async () => {
    const result = await cdp.send('Runtime.evaluate', { expression: `(()=>{const button=[...document.querySelectorAll('#inspector-fields button')].find(value=>value.textContent.trim()==='确认恢复');return{text:document.querySelector('#inspector-fields')?.textContent??'',ready:Boolean(button)};})()`, returnByValue: true });
    if (!result.result.value.ready) throw new Error('恢复确认尚未就绪');
    return result.result.value;
  });
  assert.match(restoreReady.text, /site\.yml/);
  await cdp.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('#inspector-fields button')].find(value=>value.textContent.trim()==='确认恢复').click()` });
  await waitFor(async () => {
    const result = await cdp.send('Runtime.evaluate', { expression: `(()=>{if(!document.querySelector('[name="site-name"]'))document.querySelector('[data-panel="site"]')?.click();return document.querySelector('[name="site-name"]')?.value;})()`, returnByValue: true });
    if (result.result.value !== original) throw new Error('恢复后页面尚未就绪');
    return result.result.value;
  }, 15_000);
  assert.deepEqual({ content: await treeHash(value.contentRoot), dist: await treeHash(value.distRoot) }, before);
});

test('real Chromium keeps a failed build dirty and shows only the Chinese public error', { timeout: 25_000 }, async (t) => {
  const value = await browserFixture(t, { failBuild: true }), { cdp } = value;
  await cdp.send('Network.enable'); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const eventStart = cdp.events.length; await cdp.send('Page.navigate', { url: `${value.editor.origin}/?session=startup-A` }); await cdp.wait('Page.loadEventFired', eventStart);
  await waitFor(async () => { const result = await cdp.send('Runtime.evaluate', { expression: `(()=>{document.querySelector('[data-panel="site"]')?.click();const input=document.querySelector('[name="site-name"]');if(!input)throw new Error('site form unavailable');input.value='构建失败草稿';input.dispatchEvent(new Event('change',{bubbles:true}));return document.querySelector('#draft-status').textContent;})()`, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; });
  const before = { content: await treeHash(value.contentRoot), dist: await treeHash(value.distRoot) };
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#save-button').click()` });
  const failure = await waitFor(async () => { const result = await cdp.send('Runtime.evaluate', { expression: `(()=>{const warning=new Event('beforeunload',{cancelable:true});dispatchEvent(warning);return{phase:document.querySelector('#save-phase')?.textContent,status:document.querySelector('#draft-status')?.textContent,disabled:document.querySelector('#save-button')?.disabled,warning:warning.defaultPrevented};})()`, returnByValue: true }); const state = result.result.value; if (state?.phase !== '网站生成失败，请修正内容后重试。' || state.disabled) throw new Error(`构建失败状态尚未就绪: ${JSON.stringify(state)}`); return state; });
  assert.deepEqual(failure, { phase: '网站生成失败，请修正内容后重试。', status: '有未保存更改', disabled: false, warning: true });
  assert.deepEqual({ content: await treeHash(value.contentRoot), dist: await treeHash(value.distRoot) }, before);
  assert.equal(JSON.stringify(failure).includes('FORBIDDEN'), false);
  assert.deepEqual([...new Set(cdp.events.slice(eventStart).filter((event) => event.method === 'Network.requestWillBeSent' && /^https?:/.test(event.params.request.url)).map((event) => new URL(event.params.request.url).origin))], [value.editor.origin]);
});

test('real Chromium conflict offers three choices and archives the stale draft without promotion', { timeout: 25_000 }, async (t) => {
  const value = await browserFixture(t), { cdp } = value;
  await cdp.send('Network.enable'); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const eventStart = cdp.events.length; await cdp.send('Page.navigate', { url: `${value.editor.origin}/?session=startup-A` }); await cdp.wait('Page.loadEventFired', eventStart);
  const originalName = await waitFor(async () => { const result = await cdp.send('Runtime.evaluate', { expression: `(()=>{document.querySelector('[data-panel="site"]')?.click();const input=document.querySelector('[name="site-name"]');if(!input)throw new Error('site form unavailable');const original=input.value;input.value='需要备份的冲突草稿';input.dispatchEvent(new Event('change',{bubbles:true}));return original;})()`, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; });
  const sitePath = path.join(value.contentRoot, 'site.yml');
  await writeFile(sitePath, (await readFile(sitePath, 'utf8')).replace(originalName, '磁盘外部修改'));
  const before = { content: await treeHash(value.contentRoot), dist: await treeHash(value.distRoot) };
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#save-button').click()` });
  const choices = await waitFor(async () => { const result = await cdp.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('#conflict-panel button')].map(value=>value.textContent.trim())`, returnByValue: true }); if (result.result.value.length !== 3) throw new Error('冲突选择尚未就绪'); return result.result.value; });
  assert.deepEqual(choices, ['重新载入磁盘版本', '把当前草稿保存到备份', '查看差异后覆盖']);
  await cdp.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('#conflict-panel button')].find(value=>value.textContent.trim()==='把当前草稿保存到备份').click()` });
  await waitFor(async () => { const result = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#save-phase').textContent`, returnByValue: true }); if (result.result.value !== '当前草稿已保存到备份。') throw new Error('冲突草稿备份尚未完成'); return result.result.value; });
  assert.deepEqual({ content: await treeHash(value.contentRoot), dist: await treeHash(value.distRoot) }, before);
  await cdp.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('#conflict-panel button')].find(value=>value.textContent.trim()==='查看差异后覆盖').click()` });
  const confirmation = await waitFor(async () => { const result = await cdp.send('Runtime.evaluate', { expression: `({confirm:[...document.querySelectorAll('#conflict-panel button')].some(value=>value.textContent.trim()==='确认覆盖磁盘版本'),diff:document.querySelector('#conflict-panel pre')?.textContent??''})`, returnByValue: true }); if (!result.result.value.confirm) throw new Error('覆盖确认尚未就绪'); return result.result.value; });
  assert.equal(confirmation.confirm, true); assert.match(confirmation.diff, /site\.yml/);
  assert.deepEqual({ content: await treeHash(value.contentRoot), dist: await treeHash(value.distRoot) }, before);
  assert.deepEqual([...new Set(cdp.events.slice(eventStart).filter((event) => event.method === 'Network.requestWillBeSent' && /^https?:/.test(event.params.request.url)).map((event) => new URL(event.params.request.url).origin))], [value.editor.origin]);
});
