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

function oneHeader(request,name){const values=[];for(let index=0;index<(request.rawHeaders?.length??0);index+=2)if(request.rawHeaders[index].toLowerCase()===name)values.push(request.rawHeaders[index+1]);return values.length===1?values[0]:undefined;}
async function readDeclared(request,length){const chunks=[];let total=0;for await(const chunk of request){total+=chunk.length;if(total>length)throw Object.assign(new Error('上传字节超出声明长度'),{code:'BAD_INPUT',field:'image',details:{reason:'invalid'}});chunks.push(chunk);}if(total!==length)throw Object.assign(new Error('上传字节与声明长度不一致'),{code:'BAD_INPUT',field:'image',details:{reason:'invalid'}});return Buffer.concat(chunks,total);}

export async function startEditor({ projectRoot, preferredPort=0, token, csrfToken, repositoryService, uploadStore=createUploadStore(), imageDecoder=sanitiseImage }) {
  void projectRoot;
  const generated=createSessionSecrets(); token ??= generated.sessionToken; csrfToken ??= generated.csrfToken;
  const session={token:createSessionSecrets().sessionToken,csrfToken}; let startupToken=token; let origin;
  const server=http.createServer((request,response)=>void handle(request,response).catch(()=>error(response,500,'INTERNAL_ERROR')));
  server.on('clientError',(_value,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
  async function handle(request,response) {
    securityHeaders(response);
    const url=new URL(request.url,'http://local.invalid');
    const uploadDelete=/^\/api\/uploads\/([a-f0-9]{32})$/.exec(url.pathname);
    if(uploadDelete&&!url.search){response.setHeader('Connection','close');if(request.method!=='DELETE')return error(response,405,'METHOD_NOT_ALLOWED');const guarded=guardRequest({request,origin,routeClass:'state',session});if(!guarded.ok)return error(response,guarded.status,guarded.code);if(!uploadStore.remove(uploadDelete[1]))return error(response,404,'NOT_FOUND');response.statusCode=204;return response.end();}
    if(url.pathname==='/api/uploads'&&url.search)return error(response,404,'NOT_FOUND');
    if(url.pathname==='/api/uploads'){
      response.setHeader('Connection','close');
      if(request.method!=='POST')return error(response,405,'METHOD_NOT_ALLOWED');
      const guarded=guardRequest({request,origin,routeClass:'state',session});if(!guarded.ok)return error(response,guarded.status,guarded.code);
      const type=oneHeader(request,'content-type'),lengthText=oneHeader(request,'content-length'),applicationLengthText=oneHeader(request,'x-editor-content-length'),transportName=oneHeader(request,'x-editor-filename');let originalName;
      try{originalName=decodeOriginalImageName(transportName);}catch(value){return error(response,400,value);}
      if(type!=='application/octet-stream'||!/^[1-9]\d*$/.test(lengthText??'')||!/^[1-9]\d*$/.test(applicationLengthText??''))return error(response,400,{code:'BAD_INPUT',field:'image',details:{reason:'invalid'}});
      let release;try{const length=Number(lengthText),applicationLength=Number(applicationLengthText);if(!Number.isSafeInteger(length)||!Number.isSafeInteger(applicationLength)||length!==applicationLength||!Number.isSafeInteger(uploadStore.maxFileBytes)||length>uploadStore.maxFileBytes)throw Object.assign(new Error('上传长度声明不一致'),{code:'BAD_INPUT',field:'image',details:{reason:'invalid'}});release=uploadStore.beginDecode(length);const bytes=await readDeclared(request,length);const image=await imageDecoder({bytes,originalName,maxPixels:uploadStore.maxPixels});const result=uploadStore.add(image);return send(response,201,JSON.stringify(result));}catch(value){return error(response,400,value);}finally{release?.();}
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
