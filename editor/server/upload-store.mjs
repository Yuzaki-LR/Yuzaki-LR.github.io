import { randomBytes } from 'node:crypto';

function bad(message){throw Object.assign(new Error(message),{code:'BAD_INPUT',field:'image',details:{reason:'invalid'}});}
const own=(value,key)=>value!==null&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key);
export function createUploadStore({maxFileBytes=200*1024*1024,maxSessionBytes=400*1024*1024,maxUploadCount=12,maxConcurrentDecodes=1,maxPixels=120*1000*1000,sessionId=randomBytes(16).toString('hex')}={}){
  const uploads=new Map();let totalBytes=0,active=0,closed=false;
  return{
    sessionId,maxFileBytes,maxSessionBytes,maxUploadCount,maxConcurrentDecodes,maxPixels,
    beginDecode(declaredBytes){if(closed)bad('上传会话已关闭');if(!Number.isSafeInteger(declaredBytes)||declaredBytes<1||declaredBytes>maxFileBytes)bad('图片文件超出限制');if(uploads.size>=maxUploadCount)bad('上传数量超出限制');if(totalBytes+declaredBytes>maxSessionBytes)bad('会话上传总量超出限制');if(active>=maxConcurrentDecodes)bad('图片正在处理，请稍后重试');active+=1;let done=false;return()=>{if(!done){done=true;active-=1;}};},
    add(image){if(closed)bad('上传会话已关闭');if(!image||typeof image!=='object'||Array.isArray(image)||Object.keys(image).some(key=>!['bytes','width','height','mime','safeName','sha256'].includes(key))||['bytes','width','height','mime','safeName','sha256'].some(key=>!own(image,key)))bad('图片结果无效');if((!Buffer.isBuffer(image.bytes)&&!(image.bytes instanceof Uint8Array))||!Number.isSafeInteger(image.width)||image.width<1||!Number.isSafeInteger(image.height)||image.height<1||image.width*image.height>maxPixels||image.mime!=='image/png'||!/^[a-z0-9](?:[a-z0-9_-]{0,63})-[a-f0-9]{8}\.png$/.test(image.safeName)||!/^[a-f0-9]{64}$/.test(image.sha256))bad('图片结果无效');const bytes=Buffer.from(image.bytes),length=bytes.length;if(length<1||length>maxFileBytes||totalBytes+length>maxSessionBytes||uploads.size>=maxUploadCount)bad('图片文件超出限制');const uploadId=randomBytes(16).toString('hex'),entry={...image,bytes,uploadId,sessionId};uploads.set(uploadId,entry);totalBytes+=length;return{uploadId,width:entry.width,height:entry.height,safeName:entry.safeName};},
    resolveUpload({uploadId,sessionId:value}){return value===sessionId&&uploads.get(uploadId);},
    remove(uploadId){const value=uploads.get(uploadId);if(value){totalBytes-=value.bytes.length;uploads.delete(uploadId);}return Boolean(value);},
    close(){closed=true;uploads.clear();totalBytes=0;},
    get size(){return uploads.size;},get totalBytes(){return totalBytes;},
  };
}
