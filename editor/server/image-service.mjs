import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { validateOriginalImageName } from '../client/image-controls.mjs';

const reserved=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function bad(message){throw Object.assign(new Error(message),{code:'BAD_INPUT',field:'image',details:{reason:'invalid'}});}

export function safeImageName(originalName,sha256){
  try{validateOriginalImageName(originalName);}catch{bad('图片文件名不安全');}
  let stem=originalName.replace(/\.[^.]*$/,'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').replace(/-+/g,'-').slice(0,48);
  if(!stem||reserved.test(stem))stem='image';
  return `${stem}-${sha256.slice(0,8)}.png`;
}

export async function sanitiseImage({bytes,originalName,maxPixels=120_000_000}){
  if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))bad('图片字节无效');
  const source=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength),sha256=createHash('sha256').update(source).digest('hex');
  safeImageName(originalName,sha256);
  try{
    const before=await sharp(source,{limitInputPixels:maxPixels,animated:false,failOn:'error'}).metadata();
    if(!['png','jpeg','webp','tiff'].includes(before.format)||Number(before.pages??1)!==1)bad('仅支持静态 PNG、JPEG、WebP 或 TIFF 图片');
    const image=sharp(source,{limitInputPixels:maxPixels,animated:false,failOn:'error'});
    const output=await image.rotate().png({compressionLevel:9,adaptiveFiltering:true}).toBuffer({resolveWithObject:true});
    const metadata=await sharp(output.data).metadata();
    if(metadata.format!=='png'||metadata.exif||metadata.xmp||metadata.iptc||metadata.icc||metadata.comments?.length||metadata.hasProfile)bad('图片元数据清理失败');
    if(!metadata.width||!metadata.height||metadata.width*metadata.height>maxPixels)bad('图片尺寸超出限制');
    return{bytes:output.data,width:metadata.width,height:metadata.height,mime:'image/png',safeName:safeImageName(originalName,sha256),sha256};
  }catch(error){if(error?.code==='BAD_INPUT')throw error;bad('图片损坏、动画或尺寸超出限制');}
}
