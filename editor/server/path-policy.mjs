import * as nodeFsSync from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';

const reserved=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const operations=new Set(['walker','read','copy','rename','delete']);
function fail(message='路径不安全') { const error=new Error(message); error.code='BAD_INPUT'; throw error; }
function relativeSegments(value) {
  if(typeof value!=='string' || !value || value.includes('\0') || value.includes('\\') || value.includes('%')) fail();
  if(path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith('//')) fail();
  const parts=value.split('/');
  if(parts.some(s=>!s || s==='.' || s==='..' || /[:\x00-\x1f]/.test(s) || /[. ]$/.test(s) || reserved.test(s))) fail();
  return parts;
}
function contained(root,target) { const rel=path.relative(root,target); return rel==='' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }

export async function assertConfinedPath({ root, relativePath, mustExist, operation, filesystem = nodeFs }) {
  if(!operations.has(operation)) fail('路径操作不安全');
  const parts=relativeSegments(relativePath); const rootReal=await filesystem.realpath(root); const rootInfo=await filesystem.lstat(root);
  if(!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('网站目录不安全');
  let current=rootReal;
  for(let index=0; index<parts.length; index++) {
    current=path.join(current,parts[index]);
    try {
      const info=await filesystem.lstat(current);
      if(info.isSymbolicLink()) fail('路径包含重解析点');
      const resolved=await filesystem.realpath(current);
      if(!contained(rootReal,resolved)) fail('路径超出网站目录');
      current=resolved;
    } catch(error) {
      if(error?.code!=='ENOENT') throw error;
      if(mustExist) throw error;
      const remainder=parts.slice(index); current=path.join(path.dirname(current),...remainder); break;
    }
  }
  if(!contained(rootReal,current)) fail('路径超出网站目录');
  return current;
}

function assertConfinedPathSync({ root, relativePath, mustExist, operation, filesystem }) {
  if(!operations.has(operation)) fail('路径操作不安全');
  const parts=relativeSegments(relativePath); const rootReal=filesystem.realpathSync(root); const rootInfo=filesystem.lstatSync(root);
  if(!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('网站目录不安全');
  let current=rootReal;
  for(let index=0; index<parts.length; index++) {
    current=path.join(current,parts[index]);
    try {
      const info=filesystem.lstatSync(current);
      if(info.isSymbolicLink()) fail('路径包含重解析点');
      const resolved=filesystem.realpathSync(current);
      if(!contained(rootReal,resolved)) fail('路径超出网站目录');
      current=resolved;
    } catch(error) {
      if(error?.code!=='ENOENT') throw error;
      if(mustExist) throw error;
      const remainder=parts.slice(index); current=path.join(path.dirname(current),...remainder); break;
    }
  }
  if(!contained(rootReal,current)) fail('路径超出网站目录');
  return current;
}

export function createConfinedFileSystem({ root, filesystem = nodeFs, synchronousFilesystem = nodeFsSync }) {
  const confined=(relativePath,mustExist,operation)=>assertConfinedPath({root,relativePath,mustExist,operation,filesystem});
  const confinedSync=(relativePath,mustExist,operation)=>assertConfinedPathSync({root,relativePath,mustExist,operation,filesystem:synchronousFilesystem});
  return {
    async readFile(relativePath, ...args) {
      const target=await confined(relativePath,true,'read');
      return filesystem.readFile(target,...args);
    },
    async readdir(relativePath, ...args) {
      const target=await confined(relativePath,true,'walker');
      return filesystem.readdir(target,...args);
    },
    async realpath(relativePath, operation='walker') {
      const target=await confined(relativePath,true,operation);
      return filesystem.realpath(target);
    },
    async lstat(relativePath, operation='walker') {
      const target=await confined(relativePath,true,operation);
      return filesystem.lstat(target);
    },
    async stat(relativePath, operation='walker') {
      const target=await confined(relativePath,true,operation);
      return filesystem.stat(target);
    },
    async copyFile(sourceRelativePath, destinationRelativePath, ...args) {
      await confined(sourceRelativePath,true,'copy');
      await confined(destinationRelativePath,false,'copy');
      const source=confinedSync(sourceRelativePath,true,'copy');
      const destination=confinedSync(destinationRelativePath,false,'copy');
      return synchronousFilesystem.copyFileSync(source,destination,...args);
    },
    async rename(sourceRelativePath, destinationRelativePath) {
      await confined(sourceRelativePath,true,'rename');
      await confined(destinationRelativePath,false,'rename');
      const source=confinedSync(sourceRelativePath,true,'rename');
      const destination=confinedSync(destinationRelativePath,false,'rename');
      return synchronousFilesystem.renameSync(source,destination);
    },
    async rm(relativePath, ...args) {
      const target=await confined(relativePath,true,'delete');
      return filesystem.rm(target,...args);
    },
  };
}
