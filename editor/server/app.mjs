import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createSessionSecrets, guardRequest, serializePublicError } from './auth.mjs';

const clientRoot=new URL('../client/',import.meta.url);
const staticAssets=new Map([
  ['/assets/styles.css',{file:new URL('styles.css',clientRoot),type:'text/css; charset=utf-8'}],
  ['/assets/public-global.css',{file:new URL('../../src/styles/global.css',import.meta.url),type:'text/css; charset=utf-8'}],
  ['/modules/app.mjs',{file:new URL('app.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/modules/draft-store.mjs',{file:new URL('draft-store.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/modules/forms.mjs',{file:new URL('forms.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/modules/preview.mjs',{file:new URL('preview.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/modules/preview-model.mjs',{file:new URL('../shared/preview-model.mjs',clientRoot),type:'text/javascript; charset=utf-8'}],
  ['/src/lib/content/contrast.mjs',{file:new URL('../../src/lib/content/contrast.mjs',import.meta.url),type:'text/javascript; charset=utf-8'}],
]);
const csp="default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";
function securityHeaders(response) { response.setHeader('Cache-Control','no-store'); response.setHeader('Referrer-Policy','no-referrer'); response.setHeader('X-Content-Type-Options','nosniff'); response.setHeader('Content-Security-Policy',csp); }
function send(response,status,body='',type='application/json; charset=utf-8') { response.statusCode=status; response.setHeader('Content-Type',type); response.end(body); }
function error(response,status,code) { const value=serializePublicError({code}); send(response,status,JSON.stringify(value)); }

export async function startEditor({ projectRoot, preferredPort=0, token, csrfToken, repositoryService }) {
  void projectRoot;
  const generated=createSessionSecrets(); token ??= generated.sessionToken; csrfToken ??= generated.csrfToken;
  const session={token:createSessionSecrets().sessionToken,csrfToken}; let startupToken=token; let origin;
  const server=http.createServer((request,response)=>void handle(request,response).catch(()=>error(response,500,'INTERNAL_ERROR')));
  async function handle(request,response) {
    securityHeaders(response);
    const url=new URL(request.url,'http://local.invalid');
    if(request.method!=='GET') return error(response,405,'METHOD_NOT_ALLOWED');
    if(url.pathname==='/' && url.searchParams.has('session')) {
      const guarded=guardRequest({request,origin,routeClass:'bootstrap',session}); if(!guarded.ok) return error(response,guarded.status,guarded.code);
      if(startupToken===undefined || url.searchParams.get('session')!==startupToken) return error(response,401,'UNAUTHORIZED');
      startupToken=undefined; response.setHeader('Set-Cookie',`editor_session=${session.token}; HttpOnly; SameSite=Strict; Path=/`); response.statusCode=302; response.setHeader('Location','/'); return response.end();
    }
    if(url.pathname==='/api/health') { const guarded=guardRequest({request,origin,routeClass:'navigation',session}); if(!guarded.ok)return error(response,guarded.status,guarded.code); return send(response,200,JSON.stringify({ok:true})); }
    if(url.pathname==='/api/bootstrap') { const guarded=guardRequest({request,origin,routeClass:'sensitive',session}); if(!guarded.ok)return error(response,guarded.status,guarded.code); return send(response,200,JSON.stringify(await repositoryService.bootstrap())); }
    if(url.pathname==='/' && !url.search) { const guarded=guardRequest({request,origin,routeClass:'navigation',session}); if(!guarded.ok)return error(response,guarded.status,guarded.code); return send(response,200,await readFile(new URL('index.html',clientRoot),'utf8'),'text/html; charset=utf-8'); }
    const asset=staticAssets.get(url.pathname);
    if(asset) { const guarded=guardRequest({request,origin,routeClass:'navigation',session}); if(!guarded.ok)return error(response,guarded.status,guarded.code); return send(response,200,await readFile(asset.file,'utf8'),asset.type); }
    return error(response,404,'NOT_FOUND');
  }
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:preferredPort},resolve);});
  const address=server.address(); if(!address || typeof address==='string' || address.address!=='127.0.0.1') { server.close(); throw new Error('editor did not bind loopback'); }
  origin=`http://${address.address}:${address.port}`;
  let closed=false; const close=()=>new Promise((resolve,reject)=>{if(closed||!server.listening){closed=true;return resolve();}server.close(e=>{if(e)reject(e);else{closed=true;resolve();}});});
  return {server,origin,close};
}
