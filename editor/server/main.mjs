import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { startEditor } from './app.mjs';
import { createRepositoryService } from './repository-service.mjs';

const projectRoot=path.resolve(process.cwd()); const token=randomBytes(32).toString('hex'); const csrfToken=randomBytes(32).toString('hex');
const repositoryService=createRepositoryService({projectRoot,csrfToken});
const editor=await startEditor({projectRoot,preferredPort:0,token,csrfToken,repositoryService});
process.stdout.write(`${editor.origin}/?session=${token}\n`);
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await editor.close();process.exit(0);});
