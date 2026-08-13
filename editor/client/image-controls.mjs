const warning='元数据清理无法检测图片中可见的 Fig.、报告说明或私密像素，保存前请人工检查。';
export function validateOriginalImageName(value){
  if(typeof value!=='string'||!value||value.length>180||/[\x00-\x1f\x7f]/.test(value)||/[\\/:%]/.test(value)||value==='.'||value==='..'||value.includes('..'))throw new Error('图片文件名不安全');
  return value;
}
export function encodeOriginalImageName(value){return encodeURIComponent(validateOriginalImageName(value));}
export function decodeOriginalImageName(value){
  if(typeof value!=='string'||!value||!/^[\x21-\x7e]+$/.test(value))throw new Error('图片文件名不安全');
  let decoded;try{decoded=decodeURIComponent(value);}catch{throw new Error('图片文件名不安全');}
  validateOriginalImageName(decoded);if(encodeURIComponent(decoded)!==value)throw new Error('图片文件名不安全');return decoded;
}
export function createImageSession({csrfToken,sessionId,fetchImpl=fetch,discardImpl,urlApi=URL,discardTimeoutMs=1000}={}){
  if(!/^[a-f0-9]{32}$/.test(sessionId??''))throw new Error('上传会话无效');
  const current=new Map(),pendingDiscard=new Set(),activeStages=new Set();let closing=false,closePromise;
  const prefix=/^(?:site-images|projects\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\/images)$/;
  function revoke(value){try{urlApi.revokeObjectURL(value);}catch{}}
  discardImpl??=((uploadId,{keepalive=false}={})=>fetchImpl(`/api/uploads/${uploadId}`,{method:'DELETE',credentials:'same-origin',headers:{'X-Editor-CSRF':csrfToken},keepalive}));
  async function discard(uploadId,{keepalive=false}={}){pendingDiscard.add(uploadId);let timer;try{const response=await Promise.race([discardImpl(uploadId,{keepalive}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('图片清理超时')),discardTimeoutMs);})]);if(!response?.ok&&response?.status!==404)throw new Error('图片清理失败');pendingDiscard.delete(uploadId);return true;}catch{return false;}finally{clearTimeout(timer);}}
  function stage(file,{key,destinationPrefix}={}){
    if(closing)throw new Error('图片会话已关闭');if(!(file instanceof Blob))throw new Error('请选择本地图片');if(typeof key!=='string'||!key||!prefix.test(destinationPrefix??''))throw new Error('图片位置无效');
    const originalName=encodeOriginalImageName(file.name),previewUrl=urlApi.createObjectURL(file);let stagedUploadId;
    const task=(async()=>{try{
      const response=await fetchImpl('/api/uploads',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream','X-Editor-CSRF':csrfToken,'X-Editor-Filename':originalName,'X-Editor-Content-Length':String(file.size)},body:file}),value=await response.json();
      if(!response.ok)throw new Error(value.messageZh??'图片导入失败');if(/^[a-f0-9]{32}$/.test(value.uploadId??'')){stagedUploadId=value.uploadId;pendingDiscard.add(stagedUploadId);}
      if(!stagedUploadId||!Number.isSafeInteger(value.width)||value.width<1||!Number.isSafeInteger(value.height)||value.height<1||!/^[a-z0-9_-]+-[a-f0-9]{8}\.png$/.test(value.safeName??''))throw new Error('图片导入响应无效');if(closing)throw new Error('图片会话已关闭');
      const reference={kind:'upload',destination:`${destinationPrefix}/${value.safeName}`,uploadId:value.uploadId,sessionId},entry={reference,previewUrl,width:value.width,height:value.height,safeName:value.safeName};let settled=false;
      return{uploadId:value.uploadId,width:value.width,height:value.height,safeName:value.safeName,previewUrl,async commit(){if(settled)throw new Error('图片导入事务已结束');settled=true;if(closing){await discard(value.uploadId);revoke(previewUrl);throw new Error('图片会话已关闭');}const previous=current.get(key);current.set(key,entry);pendingDiscard.delete(value.uploadId);if(previous){await discard(previous.reference.uploadId);revoke(previous.previewUrl);}},async rollback(){if(!settled){settled=true;await discard(value.uploadId);revoke(previewUrl);}}};
    }catch(error){if(stagedUploadId)await discard(stagedUploadId);revoke(previewUrl);throw error;}})();
    activeStages.add(task);const done=()=>activeStages.delete(task);task.then(done,done);return task;
  }
  async function upload(file,options){const transaction=await stage(file,options);await transaction.commit();return{uploadId:transaction.uploadId,width:transaction.width,height:transaction.height,safeName:transaction.safeName,previewUrl:transaction.previewUrl};}
  async function remove(key){const value=current.get(key);if(!value)return;current.delete(key);await discard(value.reference.uploadId);revoke(value.previewUrl);}
  function close(){closing=true;if(closePromise)return closePromise;closePromise=(async()=>{const values=[...current.values()];current.clear();for(const value of values)pendingDiscard.add(value.reference.uploadId);await Promise.allSettled([...activeStages]);await Promise.allSettled([...pendingDiscard].map(uploadId=>discard(uploadId,{keepalive:true})));for(const value of values)revoke(value.previewUrl);return{complete:pendingDiscard.size===0,pending:pendingDiscard.size};})();const done=()=>{closePromise=undefined;};closePromise.then(done,done);return closePromise;}
  function migrateProject(oldSlug,newSlug){const oldPrefix=projectImagePrefix(oldSlug)+'/',newPrefix=projectImagePrefix(newSlug)+'/';const changes=[];for(const[key,value]of current)if(value.reference.destination.startsWith(oldPrefix)){const destination=newPrefix+value.reference.destination.slice(oldPrefix.length);if([...current].some(([otherKey,other])=>otherKey!==key&&other.reference.destination.toLowerCase()===destination.toLowerCase()))throw new Error('图片位置重复');changes.push([key,value,destination]);}return{commit(){for(const[key,value,destination]of changes)current.set(key,{...value,reference:{...value.reference,destination}});}};}
  return{upload,stage,remove,close,migrateProject,get uploads(){return[...current.values()].map(value=>({...value.reference}));},getPreview:key=>current.get(key)?.previewUrl,getUpload:key=>{const value=current.get(key);return value&&{...value.reference,width:value.width,height:value.height,safeName:value.safeName};},warning};
}
export function imagePrivacyWarning(){return warning;}

function projectImagePrefix(projectSlug){
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(projectSlug??''))throw new Error('图片位置无效');
  return `projects/${projectSlug}/images`;
}

export async function applyProjectImageImport({file,key,projectSlug,path,alt,caption,store,imageSession}){
  if(!Array.isArray(path)||typeof key!=='string'||!key||!store?.dispatch||!imageSession?.stage)throw new Error('图片操作无效');
  const result=await imageSession.stage(file,{key,destinationPrefix:projectImagePrefix(projectSlug)});
  try{store.dispatch({type:'field/set',path:[...path,'markdown'],value:`![${alt}](./images/${result.safeName})${caption?`\n${caption}`:''}`});await result.commit();}catch(error){await result.rollback();throw error;}
  return result;
}

export async function removeProjectImageImport({key,path,id,store,imageSession}){
  if(typeof key!=='string'||!key||!Array.isArray(path)||typeof id!=='string'||!id||!store?.dispatch||!imageSession?.remove)throw new Error('图片操作无效');
  store.dispatch({type:'item/remove',path:[...path],id});
  await imageSession.remove(key);
}

export async function applyAvatarImageImport({file,alt,store,imageSession}){
  const result=await imageSession.stage(file,{key:'avatar',destinationPrefix:'site-images'});
  try{store.dispatch({type:'avatar/transition',mode:'image',src:`./site-images/${result.safeName}`,alt});await result.commit();}catch(error){await result.rollback();throw error;}
  return result;
}

export function confirmProjectSlugChange({store,imageSession,slug}){if(!store?.dispatch||!imageSession?.migrateProject)throw new Error('图片操作无效');const pending=store.getState?.().pendingSlugChange;if(pending?.slug!==slug)throw new Error('需要再次确认项目网址');const migration=imageSession.migrateProject(slug,pending.candidate);store.dispatch({type:'project/confirm-slug-change',slug});migration.commit();}

export async function leaveAvatarImageMode({mode,store,imageSession}){
  if(mode!=='initials'&&mode!=='hidden')throw new Error('头像模式无效');
  store.dispatch({type:'avatar/transition',mode});
  await imageSession.remove('avatar');
}
