import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import { createConfinedFileSystem } from './path-policy.mjs';
import { loadSiteRepository } from '../../src/lib/content/repository.mjs';

export function createRepositoryService({ projectRoot, csrfToken, filesystem = nodeFs }) {
  const confined=createConfinedFileSystem({root:projectRoot,filesystem});
  function relative(value) {
    const result=path.relative(projectRoot,path.resolve(value));
    if(!result || result.startsWith('..') || path.isAbsolute(result)) throw Object.assign(new Error('路径超出网站目录'),{code:'BAD_INPUT'});
    return result.replace(/\\/g,'/');
  }
  const io={
    realpath:(value)=>confined.realpath(relative(value)),
    lstat:(value)=>confined.lstat(relative(value)),
    stat:(value)=>confined.stat(relative(value)),
    readdir:(value,...args)=>confined.readdir(relative(value),...args),
    readFile:(value,...args)=>confined.readFile(relative(value),...args),
  };
  return {
    async bootstrap() {
      const contentRoot=path.join(projectRoot,'src','content');
      const repository=await loadSiteRepository({contentRoot,io});
      return {
        baseManifestHash: repository.manifest.hash,
        csrfToken,
        site: repository.site,
        about: repository.about,
        research: repository.research.map(({slug,document})=>({slug,document})),
        projects: repository.projects.map(({slug,document})=>({slug,document})),
      };
    },
  };
}
