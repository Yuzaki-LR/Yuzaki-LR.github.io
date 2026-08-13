import { randomBytes as systemRandomBytes, timingSafeEqual } from 'node:crypto';

const safeField = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const messages = new Map([
  ['BAD_INPUT', '请求无效'], ['UNAUTHORIZED', '会话无效'], ['FORBIDDEN', '请求来源无效'],
  ['NOT_FOUND', '未找到请求内容'], ['METHOD_NOT_ALLOWED', '不支持此操作'], ['INTERNAL_ERROR', '服务暂时不可用'],
]);

export function createSessionSecrets(randomBytes = systemRandomBytes) {
  return { sessionToken: randomBytes(32).toString('hex'), csrfToken: randomBytes(32).toString('hex') };
}

function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function values(request, wanted) {
  const found=[];
  for(let i=0;i<(request.rawHeaders?.length ?? 0);i+=2) if(request.rawHeaders[i].toLowerCase()===wanted) found.push(request.rawHeaders[i+1]);
  return found;
}
function cookieValue(request, name) {
  const cookies=values(request,'cookie'); if(cookies.length !== 1) return undefined;
  const matches=cookies[0].split(';').map(v=>v.trim()).filter(v=>v.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length+1) : undefined;
}
function denied(status, code) { return { ok:false, status, code }; }

export function guardRequest({ request, origin, routeClass, session }) {
  switch(routeClass) {
    case 'navigation': case 'bootstrap': case 'sensitive': case 'state': break;
    default: return denied(403,'FORBIDDEN');
  }
  const authority=new URL(origin).host;
  const hosts=values(request,'host'); if(hosts.length!==1 || hosts[0]!==authority) return denied(403,'FORBIDDEN');
  const origins=values(request,'origin');
  if (origins.length>1 || (origins.length===1 && origins[0]!==origin)) return denied(403,'FORBIDDEN');
  if(routeClass==='bootstrap') {
    const sites=values(request,'sec-fetch-site'), modes=values(request,'sec-fetch-mode');
    if(sites.length>1 || modes.length>1) return denied(403,'FORBIDDEN');
    if(sites.length===1 && !['none','same-origin'].includes(sites[0])) return denied(403,'FORBIDDEN');
    if(modes.length===1 && modes[0]!=='navigate') return denied(403,'FORBIDDEN');
  }
  if(routeClass==='sensitive' || routeClass==='state') {
    if(!equal(cookieValue(request,'editor_session'),session.token)) return denied(401,'UNAUTHORIZED');
  }
  if(routeClass==='state') {
    if(origins.length!==1) return denied(403,'FORBIDDEN');
    const csrf=values(request,'x-editor-csrf'); if(csrf.length!==1 || !equal(csrf[0],session.csrfToken)) return denied(403,'FORBIDDEN');
  }
  return {ok:true};
}

const detailSchemas = new Map([
  ['BAD_INPUT', { reason: new Set(['invalid']) }],
]);
function safeDetails(code, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const schema=detailSchemas.get(code); if(!schema) return undefined;
  const output={}; for(const [key,item] of Object.entries(value)) if(schema[key]?.has(item)) output[key]=item;
  return Object.keys(output).length ? output : undefined;
}
export function serializePublicError(error) {
  const code=messages.has(error?.code) ? error.code : 'INTERNAL_ERROR';
  return { ok:false, code, messageZh:messages.get(code), field:safeField.test(error?.field ?? '') ? error.field : undefined, details:safeDetails(code,error?.details) };
}
