import { createDraftStore, hasUnsavedNavigationWarning } from './draft-store.mjs';
import { renderInspector, findEditable, renderPanel } from './forms.mjs';
import { renderPreview } from './preview.mjs';
import { toPreviewModel } from './preview-model.mjs';

export async function startEditorApp({api={bootstrap:async()=>{const response=await fetch('/api/bootstrap',{credentials:'same-origin'});if(!response.ok)throw new Error('无法读取网站内容');return response.json();}}}={}) {
  const bootstrap=await api.bootstrap(),store=createDraftStore(bootstrap),iframe=document.querySelector('iframe'),stage=document.querySelector('.preview-stage'),status=document.querySelector('#draft-status'),inspector=document.querySelector('#inspector-fields');let route='/';
  const navigate=next=>{route=next;refresh();};
  const select=editorId=>{const selected=findEditable(store.getState(),editorId);if(selected?.route)navigate(selected.route);renderInspector({container:inspector,selection:selected,store,onNavigate:navigate});inspector.querySelector(`[data-editor-id="${CSS.escape(editorId)}"]`)?.focus();};
  const refresh=()=>{renderPreview(toPreviewModel(store.getState(),route),iframe.contentDocument,select);status.textContent=store.isDirty()?'有未保存更改':'规范内容 · 只在内存中编辑';};store.subscribe(refresh);refresh();
  const panelForRoute=next=>next==='/'?'about':next==='/research/'?'research':next==='/projects/'?'projects':'projects';
  for(const button of document.querySelectorAll('[data-route]'))button.addEventListener('click',()=>{navigate(button.dataset.route);renderPanel({container:inspector,panel:panelForRoute(route),store,onNavigate:navigate});});
  for(const button of document.querySelectorAll('[data-panel]'))button.addEventListener('click',()=>renderPanel({container:inspector,panel:button.dataset.panel,store,onNavigate:navigate}));
  for(const button of document.querySelectorAll('.viewport-switcher [data-width]'))button.addEventListener('click',()=>{stage.dataset.width=button.dataset.width;for(const item of document.querySelectorAll('.viewport-switcher [data-width]'))item.setAttribute('aria-pressed',String(item===button));});
  addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==iframe.contentWindow||event.data?.type!=='editor/select')return;select(event.data.editorId);});
  addEventListener('beforeunload',event=>{if(hasUnsavedNavigationWarning(store))event.preventDefault();});
  return {store,getRoute:()=>route};
}

if(typeof document!=='undefined')startEditorApp().catch(error=>{document.querySelector('#draft-status').textContent=error.message;});
