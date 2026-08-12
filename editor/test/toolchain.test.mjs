import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const projectRoot = new URL('../../', import.meta.url);
const projectRootPath = fileURLToPath(projectRoot);

async function findGit() {
  const executable = process.platform === 'win32' ? 'git.exe' : 'git';
  for (const directory of process.env.PATH.split(path.delimiter)) {
    const candidate = path.join(directory, executable);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue searching the active process PATH.
    }
  }
  throw new Error('Git executable is unavailable on PATH');
}

test('editor toolchain imports and performs a representative image operation', async () => {
  const [
    { z },
    { unified },
    { default: remarkParse },
    { default: remarkStringify },
    { default: remarkGfm },
    { default: sharp },
  ] = await Promise.all([
    import('zod'),
    import('unified'),
    import('remark-parse'),
    import('remark-stringify'),
    import('remark-gfm'),
    import('sharp'),
  ]);

  assert.deepEqual(z.object({ title: z.string() }).parse({ title: 'Editor' }), { title: 'Editor' });
  assert.match(
    String(unified().use(remarkParse).use(remarkGfm).use(remarkStringify).processSync('# Editor\n\n- [x] Ready\n')),
    /\[x\] Ready/,
  );

  const output = await sharp({
    create: { width: 2, height: 3, channels: 3, background: '#ffffff' },
  }).png().toBuffer();
  const metadata = await sharp(output).metadata();
  assert.deepEqual({ width: metadata.width, height: metadata.height, format: metadata.format }, {
    width: 2, height: 3, format: 'png',
  });
});

test('Git ignores local editor state', async () => {
  await run(await findGit(), ['-c', `safe.directory=${projectRootPath}`, 'check-ignore', '--quiet', '.local-editor/state.json'], {
    cwd: projectRootPath,
  });
});
