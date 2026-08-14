import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createSessionSecrets, guardRequest, serializePublicError } from './auth.mjs';
import { createUploadStore } from './upload-store.mjs';
import { sanitiseImage } from './image-service.mjs';
import { decodeOriginalImageName } from '../client/image-controls.mjs';

const clientRoot=new URL('../client/',import.meta.url);
const staticAssets=new Map([
  ['/assets/styles.css',{file:new URL('styles.css',clientRoot),type:'text/css; charset=utf-8'}],
  ['/assets/public-global.css',{file:new URL('../../src/styles/global.css',import.meta.url),type:'text/css; charset=utf-8'}],
  ['/modules/app.mjs',{file:new URL('app.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/modules/draft-store.mjs',{file:new URL('draft-store.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/modules/forms.mjs',{file:new URL('forms.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/modules/preview.mjs',{file:new URL('preview.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/modules/image-controls.mjs',{file:new URL('image-controls.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/modules/preview-model.mjs',{file:new URL('../shared/preview-model.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/src/lib/content/contrast.mjs',{file:new URL('../../src/lib/content/contrast.mjs',import.meta.url),type:'text/javascript; charset=utf-8'}],
]);
const csp="default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";
function securityHeaders(response) { response.setHeader('Cache-Control','no-store'); response.setHeader('Referrer-Policy','no-referrer'); response.setHeader('X-Content-Type-Options','nosniff'); response.setHeader('Content-Security-Policy',csp); }
function send(response,status,body='',type='application/json; charset=utf-8') { response.statusCode=status; response.setHeader('Content-Type',type); response.end(body); }
function error(response,status,value) { send(response,status,JSON.stringify(serializePublicError(typeof value==='string'?{code:value}:value))); }
function recoveryRequired() { const messageZh='检测到无法自动恢复的编辑记录，请保留现场并人工检查。'; return Object.assign(new Error(messageZh),{code:'RECOVERY_REQUIRED',messageZh}); }

function oneHeader(request,name){const values=[];for(let index=0;index<(request.rawHeaders?.length??0);index+=2)if(request.rawHeaders[index].toLowerCase()===name)values.push(request.rawHeaders[index+1]);return values.length===1?values[0]:undefined;}
async function readDeclared(request,length){const chunks=[];let total=0;for await(const chunk of request){total+=chunk.length;if(total>length)throw Object.assign(new Error('上传字节超出声明长度'),{code:'BAD_INPUT',field:'image',details:{reason:'invalid'}});chunks.push(chunk);}if(total!==length)throw Object.assign(new Error('上传字节与声明长度不一致'),{code:'BAD_INPUT',field:'image',details:{reason:'invalid'}});return Buffer.concat(chunks,total);}

async function readJson(request,limit){
  const type=oneHeader(request,'content-type'),lengthText=oneHeader(request,'content-length');
  if(type!=='application/json')throw Object.assign(new Error('invalid content type'),{code:'UNSUPPORTED_MEDIA_TYPE',status:415});
  if(!/^[1-9]\d*$/.test(lengthText??''))throw Object.assign(new Error('invalid content length'),{code:'BAD_INPUT',status:422});
  const length=Number(lengthText);
  if(!Number.isSafeInteger(length)||length>limit)throw Object.assign(new Error('request body too large'),{code:'PAYLOAD_TOO_LARGE',status:413});
  const chunks=[];let total=0;
  for await(const chunk of request){total+=chunk.length;if(total>length||total>limit)throw Object.assign(new Error('request body too large'),{code:'PAYLOAD_TOO_LARGE',status:413});chunks.push(chunk);}
  if(total!==length)throw Object.assign(new Error('invalid content length'),{code:'BAD_INPUT',status:422});
  let value;
  try{value=JSON.parse(Buffer.concat(chunks,total).toString('utf8'));}catch{throw Object.assign(new Error('invalid JSON'),{code:'BAD_INPUT',status:422});}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('invalid JSON object'),{code:'BAD_INPUT',status:422});
  return value;
}

const task11Routes=[
  {name:'save',method:'POST',path:'/api/save',routeClass:'state',bodyLimit:2*1024*1024},
  {name:'archive',method:'POST',path:'/api/drafts/archive',routeClass:'state',bodyLimit:2*1024*1024},
  {name:'backups',method:'GET',path:'/api/backups',routeClass:'sensitive'},
  {name:'diff',method:'POST',match:/^\/api\/backups\/(\d{8}T\d{6}Z-\d{4})\/diff$/,routeClass:'state',bodyLimit:1024},
  {name:'restore',method:'POST',match:/^\/api\/backups\/(\d{8}T\d{6}Z-\d{4})\/restore$/,routeClass:'state',bodyLimit:1024},
];
const task11Messages=new Map([
  ['BAD_INPUT','请求无效。'],['UNAUTHORIZED','编辑会话无效。'],['FORBIDDEN','请求来源或确认记录无效。'],
  ['NOT_FOUND','未找到请求的备份。'],['METHOD_NOT_ALLOWED','不支持此操作。'],['PAYLOAD_TOO_LARGE','请求内容过大。'],
  ['UNSUPPORTED_MEDIA_TYPE','请求内容类型无效。'],['CONTENT_CONFLICT','磁盘内容已在编辑器外修改，未覆盖任何文件。'],
  ['CANDIDATE_BUILD_FAILED','网站生成失败，请修正内容后重试。'],['INTERNAL_ERROR','编辑服务暂时不可用。'],
]);
const safeField=/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const operationId=/^\d{8}T\d{6}Z-\d{4}$/;
const sha256=/^[a-f0-9]{64}$/;
function task11Error(value,codeOverride){
  let code=codeOverride??value?.code;
  if(code==='CONFLICT')code='CONTENT_CONFLICT';
  if(!task11Messages.has(code))code='INTERNAL_ERROR';
  return{ok:false,code,messageZh:task11Messages.get(code),field:safeField.test(value?.field??'')?value.field:null,details:[]};
}
function task11ErrorResponse(response,status,value,codeOverride){return send(response,status,JSON.stringify(task11Error(typeof value==='string'?{code:value}:value,codeOverride)));}
function safeLogicalPath(value){return typeof value==='string'&&value.length<=256&&!value.includes('\\')&&!value.startsWith('/')&&!value.split('/').includes('..')&&/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value);}
function publicDiff(value){
  const result={};
  for(const key of ['added','removed','changed']){
    if(!Array.isArray(value?.[key])||value[key].some(item=>!safeLogicalPath(item)))throw Object.assign(new Error('invalid diff'),{code:'INTERNAL_ERROR'});
    result[key]=[...value[key]];
  }
  return result;
}
function publicConfirmation(value){
  if(!sha256.test(value?.token??'')||typeof value?.expiresAt!=='string'||Number.isNaN(Date.parse(value.expiresAt)))throw Object.assign(new Error('invalid confirmation'),{code:'INTERNAL_ERROR'});
  return{token:value.token,expiresAt:value.expiresAt};
}
function publicMutationResult(value){
  if(value?.ok!==true||!operationId.test(value.operationId??'')||!sha256.test(value.manifestHash??''))throw Object.assign(new Error('invalid mutation result'),{code:'INTERNAL_ERROR'});
  return{ok:true,operationId:value.operationId,manifestHash:value.manifestHash};
}
function publicBackup(value){
  if(!operationId.test(value?.id??'')||!['save','archive','restore'].includes(value?.kind)||!['complete','candidate-failed','recovered-old','conflict-before-promotion','conflict-restored-before-content-promotion','conflict-restored-before-dist-promotion'].includes(value?.phase)||typeof value?.createdAt!=='string'||Number.isNaN(Date.parse(value.createdAt)))throw Object.assign(new Error('invalid backup summary'),{code:'INTERNAL_ERROR'});
  return{id:value.id,kind:value.kind,status:value.phase,createdAt:value.createdAt};
}
function candidatePayload(value,{allowConflict=false}={}){
  const allowed=new Set(['baseManifestHash','sessionId','content','images',...(allowConflict?['conflictResolutionToken']:[])]);
  if(Object.keys(value).some(key=>!allowed.has(key)))throw Object.assign(new Error('invalid candidate request'),{code:'BAD_INPUT',status:422});
  const{conflictResolutionToken,...bundle}=value;
  if(conflictResolutionToken!==undefined&&!sha256.test(conflictResolutionToken))throw Object.assign(new Error('invalid confirmation token'),{code:'BAD_INPUT',status:422});
  return{bundle,conflictResolutionToken};
}

export async function startEditor({ projectRoot, preferredPort=0, token, csrfToken, repositoryService, transactionService, uploadStore=createUploadStore(), imageDecoder=sanitiseImage }) {
  void projectRoot;
  if(!transactionService || typeof transactionService.recoverBeforeListen!=='function' || typeof transactionService.runMutation!=='function'){
    try{uploadStore.close();}catch{}
    throw recoveryRequired();
  }
  let startup;
  try{startup=await transactionService.recoverBeforeListen();}
  catch{try{uploadStore.close();}catch{}throw recoveryRequired();}
  if(!startup?.ok || startup.recoveryOnly){
    try{uploadStore.close();}catch{}
    throw recoveryRequired();
  }
  const generated=createSessionSecrets(); token ??= generated.sessionToken; csrfToken ??= generated.csrfToken;
  const session={token:createSessionSecrets().sessionToken,transactionId:uploadStore.sessionId,csrfToken}; let startupToken=token; let origin;
  const server=http.createServer((request,response)=>void handle(request,response).catch(()=>error(response,500,'INTERNAL_ERROR')));
  server.on('clientError',(_value,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
  async function runMutation(action){
    return transactionService.runMutation(action);
  }
  async function handle(request,response) {
    securityHeaders(response);
    const url=new URL(request.url,'http://local.invalid');
    const knownTask11Route=task11Routes.find(route=>route.path===url.pathname||route.match?.test(url.pathname));
    if(knownTask11Route){
      response.setHeader('Connection','close');
      if(url.search)return task11ErrorResponse(response,404,'NOT_FOUND');
      if(request.method!==knownTask11Route.method)return task11ErrorResponse(response,405,'METHOD_NOT_ALLOWED');
      const guarded=guardRequest({request,origin,routeClass:knownTask11Route.routeClass,session});if(!guarded.ok)return task11ErrorResponse(response,guarded.status,guarded.code);
      try{
        const match=knownTask11Route.match?.exec(url.pathname),id=match?.[1];
        if(knownTask11Route.name==='backups'){
          const backups=(await transactionService.listBackups()).map(publicBackup);
          return send(response,200,JSON.stringify({ok:true,backups}));
        }
        const payload=await readJson(request,knownTask11Route.bodyLimit);
        if(knownTask11Route.name==='save'){
          const{bundle,conflictResolutionToken}=candidatePayload(payload,{allowConflict:true});
          try{
            const result=await transactionService.save({baseManifestHash:bundle.baseManifestHash,bundle,uploads:uploadStore,sessionId:session.transactionId,...(conflictResolutionToken?{conflictResolutionToken}: {})});
            return send(response,200,JSON.stringify(publicMutationResult(result)));
          }catch(value){
            if(value?.code!=='CONFLICT')throw value;
            const confirmation=transactionService.issueConfirmation({sessionId:session.transactionId,action:'conflict',...value.confirmationContext,now:new Date()});
            return send(response,409,JSON.stringify({...task11Error(value,'CONTENT_CONFLICT'),diff:publicDiff(value.diff),confirmation:publicConfirmation(confirmation)}));
          }
        }
        if(knownTask11Route.name==='archive'){
          const{bundle}=candidatePayload(payload);
          const backup=publicBackup(await transactionService.archiveDraft({baseManifestHash:bundle.baseManifestHash,bundle,uploads:uploadStore,sessionId:session.transactionId}));
          return send(response,200,JSON.stringify({ok:true,backup}));
        }
        if(knownTask11Route.name==='diff'){
          if(Object.keys(payload).length)throw Object.assign(new Error('invalid diff request'),{code:'BAD_INPUT',status:422});
          const result=await transactionService.diffBackup(id,{sessionId:session.transactionId});
          return send(response,200,JSON.stringify({ok:true,id,diff:publicDiff(result.diff),confirmation:publicConfirmation(result.confirmation)}));
        }
        if(knownTask11Route.name==='restore'){
          if(Object.keys(payload).length!==1||!sha256.test(payload.confirmationToken??''))throw Object.assign(new Error('invalid restore request'),{code:'BAD_INPUT',status:422});
          const result=await transactionService.restore({id,sessionId:session.transactionId,confirmationToken:payload.confirmationToken});
          return send(response,200,JSON.stringify(publicMutationResult(result)));
        }
      }catch(value){
        const status=value?.status??(value?.code==='BAD_INPUT'?422:value?.code==='FORBIDDEN'?403:value?.code==='NOT_FOUND'?404:value?.code==='CONFLICT'?409:value?.code==='CANDIDATE_BUILD_FAILED'?422:value?.code==='RECOVERY_REQUIRED'?503:500);
        return task11ErrorResponse(response,status,value);
      }
    }
    const uploadDelete=/^\/api\/uploads\/([a-f0-9]{32})$/.exec(url.pathname);
    if(uploadDelete&&!url.search){response.setHeader('Connection','close');if(request.method!=='DELETE')return error(response,405,'METHOD_NOT_ALLOWED');const guarded=guardRequest({request,origin,routeClass:'state',session});if(!guarded.ok)return error(response,guarded.status,guarded.code);try{return await runMutation(()=>{if(!uploadStore.remove(uploadDelete[1]))return error(response,404,'NOT_FOUND');response.statusCode=204;return response.end();});}catch(value){return error(response,value?.code==='RECOVERY_REQUIRED'?503:500,value?.code==='RECOVERY_REQUIRED'?'INTERNAL_ERROR':value);}}
    if(url.pathname==='/api/uploads'&&url.search)return error(response,404,'NOT_FOUND');
    if(url.pathname==='/api/uploads'){
      response.setHeader('Connection','close');
      if(request.method!=='POST')return error(response,405,'METHOD_NOT_ALLOWED');
      const guarded=guardRequest({request,origin,routeClass:'state',session});if(!guarded.ok)return error(response,guarded.status,guarded.code);
      const type=oneHeader(request,'content-type'),lengthText=oneHeader(request,'content-length'),applicationLengthText=oneHeader(request,'x-editor-content-length'),transportName=oneHeader(request,'x-editor-filename');let originalName;
      try{originalName=decodeOriginalImageName(transportName);}catch(value){return error(response,400,value);}
      if(type!=='application/octet-stream'||!/^[1-9]\d*$/.test(lengthText??'')||!/^[1-9]\d*$/.test(applicationLengthText??''))return error(response,400,{code:'BAD_INPUT',field:'image',details:{reason:'invalid'}});
      try{return await runMutation(async()=>{let release;try{const length=Number(lengthText),applicationLength=Number(applicationLengthText);if(!Number.isSafeInteger(length)||!Number.isSafeInteger(applicationLength)||length!==applicationLength||!Number.isSafeInteger(uploadStore.maxFileBytes)||length>uploadStore.maxFileBytes)throw Object.assign(new Error('上传长度声明不一致'),{code:'BAD_INPUT',field:'image',details:{reason:'invalid'}});release=uploadStore.beginDecode(length);const bytes=await readDeclared(request,length);const image=await imageDecoder({bytes,originalName,maxPixels:uploadStore.maxPixels});const result=uploadStore.add(image);return send(response,201,JSON.stringify(result));}finally{release?.();}});}catch(value){return error(response,value?.code==='RECOVERY_REQUIRED'?503:400,value?.code==='RECOVERY_REQUIRED'?'INTERNAL_ERROR':value);}
    }
    if(request.method!=='GET') return error(response,405,'METHOD_NOT_ALLOWED');
    if(url.pathname==='/' && url.searchParams.has('session')) {
      const guarded=guardRequest({request,origin,routeClass:'bootstrap',session}); if(!guarded.ok) return error(response,guarded.status,guarded.code);
      if(startupToken===undefined || url.searchParams.get('session')!==startupToken) return error(response,401,'UNAUTHORIZED');
      startupToken=undefined; response.setHeader('Set-Cookie',`editor_session=${session.token}; HttpOnly; SameSite=Strict; Path=/`); response.statusCode=302; response.setHeader('Location','/'); return response.end();
    }
    if(url.pathname==='/api/health') { const guarded=guardRequest({request,origin,routeClass:'navigation',session}); if(!guarded.ok)return error(response,guarded.status,guarded.code); return send(response,200,JSON.stringify({ok:true})); }
    if(url.pathname==='/api/bootstrap') { const guarded=guardRequest({request,origin,routeClass:'sensitive',session}); if(!guarded.ok)return error(response,guarded.status,guarded.code); return send(response,200,JSON.stringify({...await repositoryService.bootstrap(),uploadSessionId:uploadStore.sessionId})); }
    if(url.pathname==='/' && !url.search) { const guarded=guardRequest({request,origin,routeClass:'navigation',session}); if(!guarded.ok)return error(response,guarded.status,guarded.code); return send(response,200,await readFile(new URL('index.html',clientRoot),'utf8'),'text/html; charset=utf-8'); }
    const asset=staticAssets.get(url.pathname);
    if(asset) { const guarded=guardRequest({request,origin,routeClass:'navigation',session}); if(!guarded.ok)return error(response,guarded.status,guarded.code); return send(response,200,await readFile(asset.file,'utf8'),asset.type); }
    return error(response,404,'NOT_FOUND');
  }
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:preferredPort},resolve);});
  const address=server.address(); if(!address || typeof address==='string' || address.address!=='127.0.0.1') { server.close(); throw new Error('editor did not bind loopback'); }
  origin=`http://${address.address}:${address.port}`;
  let closed=false; const close=()=>new Promise((resolve,reject)=>{if(closed||!server.listening){closed=true;uploadStore.close();return resolve();}server.close(e=>{if(e)reject(e);else{closed=true;uploadStore.close();resolve();}});});
  return {server,origin,close,uploadStore};
}
