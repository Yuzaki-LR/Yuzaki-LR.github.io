import { createDraftStore, hasUnsavedNavigationWarning, toCandidateBundle } from './draft-store.mjs';
import { renderInspector, findEditable, renderPanel } from './forms.mjs';
import { renderPreview } from './preview.mjs';
import { toPreviewModel } from './preview-model.mjs';
import { createImageSession } from './image-controls.mjs';

async function requestJson(path, { method = 'GET', csrfToken, body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(csrfToken ? { 'X-Editor-CSRF': csrfToken } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let value;
  try { value = await response.json(); } catch { value = { ok: false, messageZh: '编辑服务返回了无效结果。' }; }
  return { status: response.status, ...value };
}

function defaultApi() {
  return {
    bootstrap: async () => {
      const response = await fetch('/api/bootstrap', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('无法读取网站内容');
      return response.json();
    },
    save: (body, csrfToken) => requestJson('/api/save', { method: 'POST', csrfToken, body }),
    archive: (body, csrfToken) => requestJson('/api/drafts/archive', { method: 'POST', csrfToken, body }),
    backups: () => requestJson('/api/backups'),
    diffBackup: (id, csrfToken) => requestJson(`/api/backups/${id}/diff`, { method: 'POST', csrfToken, body: {} }),
    restore: (id, confirmationToken, csrfToken) => requestJson(`/api/backups/${id}/restore`, { method: 'POST', csrfToken, body: { confirmationToken } }),
  };
}

function appendButton(container, text, action) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = text; button.addEventListener('click', action); container.append(button);
  return button;
}

function diffText(diff) {
  const labels = { added: '新增', removed: '删除', changed: '修改' };
  return ['added', 'removed', 'changed'].flatMap((key) => (diff?.[key] ?? []).map((value) => `${labels[key]}：${value}`)).join('\n') || '没有文件差异';
}

export async function startEditorApp({ api = defaultApi() } = {}) {
  const bootstrap = await api.bootstrap();
  const { uploadSessionId, ...draftBootstrap } = bootstrap;
  if (!/^[a-f0-9]{32}$/.test(uploadSessionId ?? '')) throw new Error('上传会话无效');
  const store = createDraftStore(draftBootstrap);
  const imageSession = createImageSession({ csrfToken: draftBootstrap.csrfToken, sessionId: uploadSessionId });
  const iframe = document.querySelector('iframe');
  const stage = document.querySelector('.preview-stage');
  const status = document.querySelector('#draft-status');
  const savePhase = document.querySelector('#save-phase');
  const saveButton = document.querySelector('#save-button');
  const conflictPanel = document.querySelector('#conflict-panel');
  const inspector = document.querySelector('#inspector-fields');
  let route = '/'; let saving = false; let allowNavigation = false;

  function candidate() {
    const state = store.getState(), uploads = imageSession.uploads;
    return toCandidateBundle(state, {
      sessionId: uploadSessionId,
      uploads,
      resolveCanonical: (descriptor) => state.images.some((image) => image.destination === descriptor.destination && image.sha256 === descriptor.sha256),
      resolveUpload: (descriptor) => uploads.some((image) => image.destination === descriptor.destination && image.uploadId === descriptor.uploadId && image.sessionId === descriptor.sessionId),
    });
  }
  const navigate = (next) => { route = next; refresh(); };
  const select = (editorId) => {
    const selected = findEditable(store.getState(), editorId);
    if (selected?.route) navigate(selected.route);
    renderInspector({ container: inspector, selection: selected, store, onNavigate: navigate, imageSession });
    inspector.querySelector(`[data-editor-id="${CSS.escape(editorId)}"]`)?.focus();
  };
  function refresh() {
    renderPreview(toPreviewModel(store.getState(), route), iframe.contentDocument, select);
    status.textContent = store.isDirty() ? '有未保存更改' : '规范内容 · 只在内存中编辑';
    saveButton.disabled = saving || !store.isDirty() || store.getState().saveDisabled;
  }
  function clearConflict() { conflictPanel.hidden = true; conflictPanel.replaceChildren(); }
  function showError(value) { savePhase.textContent = value?.messageZh ?? value?.message ?? '保存失败，请检查内容后重试。'; }
  async function completeSave(value) {
    if (value.status !== 200 || value.ok !== true) return false;
    allowNavigation = true;
    savePhase.textContent = '保存成功，正在重新载入…';
    saveButton.disabled = true;
    location.reload();
    return true;
  }
  async function saveDraft(confirmationToken) {
    if (saving) return;
    saving = true; clearConflict(); savePhase.textContent = '正在验证并生成网站…'; refresh();
    try {
      const value = await api.save({ ...candidate(), ...(confirmationToken ? { conflictResolutionToken: confirmationToken } : {}) }, draftBootstrap.csrfToken);
      if (await completeSave(value)) return;
      if (value.status === 409 && value.code === 'CONTENT_CONFLICT') { showConflict(value); return; }
      showError(value);
    } catch (error) { showError(error); }
    finally { saving = false; if (!allowNavigation) refresh(); }
  }
  function showConflict(value) {
    conflictPanel.hidden = false;
    const message = document.createElement('p'); message.textContent = value.messageZh; conflictPanel.append(message);
    const actions = document.createElement('div'); actions.className = 'conflict-actions'; conflictPanel.append(actions);
    appendButton(actions, '重新载入磁盘版本', () => { allowNavigation = true; location.reload(); });
    appendButton(actions, '把当前草稿保存到备份', async () => {
      if (saving) return; saving = true; refresh(); savePhase.textContent = '正在保存草稿备份…';
      try { const archived = await api.archive(candidate(), draftBootstrap.csrfToken); if (archived.status === 200 && archived.ok) savePhase.textContent = '当前草稿已保存到备份。'; else showError(archived); }
      catch (error) { showError(error); }
      finally { saving = false; refresh(); }
    });
    appendButton(actions, '查看差异后覆盖', () => {
      const pre = document.createElement('pre'); pre.textContent = diffText(value.diff); conflictPanel.append(pre);
      const confirm = appendButton(conflictPanel, '确认覆盖磁盘版本', () => saveDraft(value.confirmation?.token));
      confirm.className = 'danger';
    });
  }

  store.subscribe(refresh); refresh();
  saveButton.addEventListener('click', () => saveDraft());
  const panelForRoute = (next) => next === '/' ? 'about' : next === '/research/' ? 'research' : 'projects';
  for (const button of document.querySelectorAll('[data-route]')) button.addEventListener('click', () => { navigate(button.dataset.route); renderPanel({ container: inspector, panel: panelForRoute(route), store, onNavigate: navigate, imageSession, api, csrfToken: draftBootstrap.csrfToken, onRestored: () => { allowNavigation = true; location.reload(); } }); });
  for (const button of document.querySelectorAll('[data-panel]')) button.addEventListener('click', () => renderPanel({ container: inspector, panel: button.dataset.panel, store, onNavigate: navigate, imageSession, api, csrfToken: draftBootstrap.csrfToken, onRestored: () => { allowNavigation = true; location.reload(); } }));
  for (const button of document.querySelectorAll('.viewport-switcher [data-width]')) button.addEventListener('click', () => { stage.dataset.width = button.dataset.width; for (const item of document.querySelectorAll('.viewport-switcher [data-width]')) item.setAttribute('aria-pressed', String(item === button)); });
  addEventListener('message', (event) => { if (event.origin !== location.origin || event.source !== iframe.contentWindow || event.data?.type !== 'editor/select') return; select(event.data.editorId); });
  addEventListener('beforeunload', (event) => { void imageSession.close(); if (!allowNavigation && hasUnsavedNavigationWarning(store)) event.preventDefault(); });
  return { store, imageSession, getRoute: () => route, save: saveDraft };
}

if (typeof document !== 'undefined') startEditorApp().catch((error) => { document.querySelector('#draft-status').textContent = error.message; });
