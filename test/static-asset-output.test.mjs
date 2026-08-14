import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, lstat, open, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { acquireAstroBuildLock, createAstroCandidateWorkspace, createTestWorkspace, distRoot, projectRoot, withAstroBuildLock, withCanonicalDistInvariant } from './helpers.mjs';
import { loadSiteRepository } from '../src/lib/content/repository.mjs';

function run(args, options) {
  const child = spawn(process.execPath, args, options);
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  return once(child, 'close').then(([code]) => ({ code, stderr }));
}

function startIncompleteBuildLockFixture({ timeoutMs = 10_000 } = {}) {
  const lockPath = path.join(projectRoot, '.astro-build-test-lock');
  const deadline = Date.now() + timeoutMs;
  let markAttempted;
  let attemptedMarked = false;
  const attempted = new Promise((resolve) => { markAttempted = resolve; });
  const signalAttempted = () => {
    if (attemptedMarked) return;
    attemptedMarked = true;
    markAttempted();
  };
  const acquired = (async () => {
    let handle;
    while (!handle) {
      try {
        handle = await open(lockPath, 'wx');
        signalAttempted();
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        signalAttempted();
        if (Date.now() >= deadline) throw new Error('timed out waiting to create incomplete build lock fixture');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    const ownedEntry = await handle.stat();
    let released = false;
    return {
      release: async () => {
        if (released) return;
        assert.equal((await handle.stat()).size, 0, 'owned incomplete lock must remain empty');
        await handle.close();
        const currentEntry = await lstat(lockPath);
        assert.equal(currentEntry.isFile() && !currentEntry.isSymbolicLink(), true, 'owned incomplete lock must remain a regular file');
        assert.equal(currentEntry.size, 0, 'owned incomplete lock path must remain empty');
        assert.equal(currentEntry.dev, ownedEntry.dev, 'owned incomplete lock device changed');
        assert.equal(currentEntry.ino, ownedEntry.ino, 'owned incomplete lock identity changed');
        await unlink(lockPath);
        released = true;
      },
    };
  })();
  return { attempted, acquired };
}

function startValidOwnerObservation({ startFixture = startIncompleteBuildLockFixture, afterFixtureAttempt } = {}) {
  let fixture;
  const completed = withAstroBuildLock(async () => {
    const lockPath = path.join(projectRoot, '.astro-build-test-lock');
    const metadata = await readFile(lockPath, 'utf8');
    fixture = startFixture();
    await fixture.attempted;
    if (afterFixtureAttempt) await afterFixtureAttempt();
    const observedMetadata = await readFile(lockPath, 'utf8');
    return { fixture, metadata, observedMetadata };
  });
  let cleanupPromise;
  return {
    completed,
    cleanup: () => {
      cleanupPromise ??= (async () => {
        let completedError;
        let fixtureCleanupError;
        try {
          await completed;
        } catch (error) {
          completedError = error;
        }
        if (fixture) {
          try {
            const fixtureOwner = await fixture.acquired;
            await fixtureOwner.release();
          } catch (error) {
            fixtureCleanupError = error;
          }
        }
        if (completedError && fixtureCleanupError) {
          throw new AggregateError([completedError, fixtureCleanupError], 'valid-owner observation and fixture cleanup both failed');
        }
        if (completedError) throw completedError;
        if (fixtureCleanupError) throw fixtureCleanupError;
      })();
      return cleanupPromise;
    },
  };
}

test('the canonical build copies every visible project asset byte-identically', async () => {
  const images = (await loadSiteRepository()).images.filter(({ kind }) => kind === 'project');
  assert.ok(images.length > 0);
  for (const image of images) {
    const outputPath = `assets/projects/${image.slug}/${image.name}`;
    const [source, emitted] = await Promise.all([
      readFile(image.sourcePath),
      readFile(path.join(distRoot, ...outputPath.split('/'))),
    ]);
    assert.equal(createHash('sha256').update(emitted).digest('hex'), createHash('sha256').update(source).digest('hex'), outputPath);
  }
});

test('candidate environment cannot override its required isolation roots', async (t) => {
  const workspace = await createAstroCandidateWorkspace();
  t.after(workspace.cleanup);
  const environment = workspace.environment({
    base: '/repo/',
    BASE: '/repo/',
    EDITOR_CANDIDATE_BUILD: '0',
    EDITOR_OPERATION_ROOT: path.join(projectRoot, 'outside-operation'),
    EDITOR_CONTENT_ROOT: path.join(projectRoot, 'outside-content'),
    EDITOR_OUT_DIR: distRoot,
    EDITOR_CACHE_DIR: path.join(projectRoot, '.astro'),
  });
  assert.deepEqual({
    candidate: environment.EDITOR_CANDIDATE_BUILD,
    operation: environment.EDITOR_OPERATION_ROOT,
    content: environment.EDITOR_CONTENT_ROOT,
    output: environment.EDITOR_OUT_DIR,
    cache: environment.EDITOR_CACHE_DIR,
  }, {
    candidate: '1',
    operation: workspace.root,
    content: workspace.contentRoot,
    output: workspace.outputRoot,
    cache: workspace.cacheRoot,
  });
  assert.equal(environment.BASE, '/repo/');
});

test('canonical dist comparison remains inside the real build lock', async () => {
  const order = [];
  let contender = Promise.resolve();
  await withCanonicalDistInvariant(async () => {}, {
    afterCompare: async () => {
      contender = withAstroBuildLock(async () => { order.push('contender'); });
      await new Promise((resolve) => setTimeout(resolve, 75));
      order.push('comparison');
    },
  });
  await contender;
  assert.deepEqual(order, ['comparison', 'contender']);
});

test('Astro build lock retries when its observed owner releases before recovery read', async () => {
  const releaseOwner = await acquireAstroBuildLock();
  let ownerReleased = false;
  let releaseContender;
  try {
    releaseContender = await acquireAstroBuildLock({
      afterLockExists: async () => {
        await releaseOwner();
        ownerReleased = true;
      },
    });
  } finally {
    if (releaseContender) await releaseContender();
    if (!ownerReleased) await releaseOwner();
  }
  assert.equal(ownerReleased, true);
});

test('Astro build lock waits while observed owner metadata is incomplete', async () => {
  const fixture = startIncompleteBuildLockFixture();
  await fixture.attempted;
  const incompleteOwner = await fixture.acquired;
  let observations = 0;
  let releaseContender;
  try {
    releaseContender = await acquireAstroBuildLock({
      afterLockExists: async () => {
        observations += 1;
        if (observations === 2) await incompleteOwner.release();
      },
    });
  } finally {
    if (releaseContender) await releaseContender();
    await incompleteOwner.release();
  }
  assert.equal(observations, 2);
});

test('incomplete lock fixture preserves a legitimate owner before acquiring', async () => {
  const observation = startValidOwnerObservation();
  try {
    const { metadata, observedMetadata } = await observation.completed;
    assert.equal(observedMetadata, metadata);
  } finally {
    await observation.cleanup();
  }
});

test('valid-owner observation releases its lock when fixture setup throws', async () => {
  const observation = startValidOwnerObservation({
    startFixture: () => { throw new Error('incomplete fixture setup failed'); },
  });
  let cleanupError;
  let reacquireError;
  let releaseReacquired;
  try {
    await assert.rejects(observation.completed, /incomplete fixture setup failed/);
    try {
      await observation.cleanup();
    } catch (error) {
      cleanupError = error;
    }
    try {
      releaseReacquired = await acquireAstroBuildLock({ timeoutMs: 100 });
    } catch (error) {
      reacquireError = error;
    }
  } finally {
    if (releaseReacquired) await releaseReacquired();
  }
  assert.equal(reacquireError, undefined, `setup failure must release the valid owner: ${reacquireError?.message}`);
  assert.equal(cleanupError?.message, 'incomplete fixture setup failed');
});

test('observation cleanup releases a post-attempt fixture and preserves both failures', async () => {
  let rawFixture;
  let rawOwner;
  const observation = startValidOwnerObservation({
    startFixture: () => {
      rawFixture = startIncompleteBuildLockFixture();
      return {
        attempted: rawFixture.attempted,
        acquired: rawFixture.acquired.then((owner) => ({
          release: async () => {
            await owner.release();
            throw new Error('incomplete fixture cleanup failed');
          },
        })),
      };
    },
    afterFixtureAttempt: () => { throw new Error('post-attempt observation failed'); },
  });
  let cleanupError;
  let reacquireError;
  let releaseReacquired;
  try {
    await assert.rejects(observation.completed, /post-attempt observation failed/);
    rawOwner = await rawFixture.acquired;
    try {
      await observation.cleanup();
    } catch (error) {
      cleanupError = error;
    }
    try {
      releaseReacquired = await acquireAstroBuildLock({ timeoutMs: 100 });
    } catch (error) {
      reacquireError = error;
    }
  } finally {
    if (releaseReacquired) await releaseReacquired();
    if (rawOwner) await rawOwner.release();
  }
  assert.equal(reacquireError, undefined, `post-attempt cleanup must release the fixture lock: ${reacquireError?.message}`);
  assert.equal(cleanupError instanceof AggregateError, true);
  assert.deepEqual(cleanupError.errors.map((error) => error.message), [
    'post-attempt observation failed',
    'incomplete fixture cleanup failed',
  ]);
});

test('a failed build still completes its canonical dist comparison', async () => {
  let compared = false;
  await assert.rejects(withCanonicalDistInvariant(async () => { throw new Error('fixture build failed'); }, {
    afterCompare: async () => { compared = true; },
  }), /fixture build failed/);
  assert.equal(compared, true);
});

test('candidate workspace initialization failure removes its owned directory', async () => {
  let ownedParent;
  await assert.rejects(createAstroCandidateWorkspace({
    afterCreate: async ({ root }) => {
      ownedParent = path.dirname(root);
      await writeFile(path.join(root, '.astro'), 'collision\n');
    },
  }), { code: 'EEXIST' });
  await assert.rejects(access(ownedParent), { code: 'ENOENT' });
});

test('candidate workspace ignores arbitrary workspace factories and remains task-owned', async (t) => {
  let injectedFactoryCalled = false;
  const workspace = await createAstroCandidateWorkspace({
    createWorkspace: async () => {
      injectedFactoryCalled = true;
      return createTestWorkspace();
    },
  });
  t.after(workspace.cleanup);
  assert.equal(injectedFactoryCalled, false);
  const [ownedParent, testsRoot] = await Promise.all([
    realpath(workspace.parent),
    realpath(path.join(projectRoot, '.local-editor', 'runtime', 'tests')),
  ]);
  assert.equal(path.dirname(ownedParent), testsRoot);
  assert.match(path.basename(ownedParent), /^task7-/);
});

test('a fresh build emits the confined project PNG byte-identically without source metadata', async (t) => {
  const workspace = await createAstroCandidateWorkspace();
  t.after(workspace.cleanup);
  await rm(workspace.contentRoot, { recursive: true });
  await cp(path.join(projectRoot, 'test', 'fixtures', 'content-v2', 'one-image'), workspace.contentRoot, { recursive: true });
    const { code, stderr } = await withCanonicalDistInvariant(() => run([path.join(projectRoot, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], {
      cwd: projectRoot,
      env: workspace.environment(),
      stdio: 'pipe',
    }));
    assert.equal(code, 0, `fixture content build should succeed: ${stderr}`);
    const [emitted, source] = await Promise.all([
      readFile(path.join(workspace.outputRoot, 'assets', 'projects', 'sample-project', 'result.png')),
      readFile(path.join(workspace.contentRoot, 'projects', 'sample-project', 'images', 'result.png')),
    ]);
    assert.equal(createHash('sha256').update(emitted).digest('hex'), createHash('sha256').update(source).digest('hex'));
    assert.doesNotMatch(emitted.toString('latin1'), /sample-project|projects[\\/]|src[\\/]|content[\\/]/i);
});

test('fresh build under an Astro base emits base-aware internal navigation and focus tokens', async (t) => {
  const workspace = await createAstroCandidateWorkspace();
  t.after(workspace.cleanup);
  const { code, stderr } = await withCanonicalDistInvariant(() => run([path.join(projectRoot, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], {
    cwd: projectRoot, env: workspace.environment({ base: '/repo/' }), stdio: 'pipe',
  }));
  assert.equal(code, 0, stderr);
  const html = await readFile(path.join(workspace.outputRoot, 'index.html'), 'utf8');
  assert.match(html, /href="\/repo\/"/);
  assert.doesNotMatch(html, /href="\/\/repo\//);
  const css = (await readFile(path.join(workspace.outputRoot, '_astro', (await (await import('node:fs/promises')).readdir(path.join(workspace.outputRoot, '_astro'))).find((name) => name.endsWith('.css'))), 'utf8'));
  assert.match(css, /outline:3px solid var\(--focus\)/);
  const projectEntries = await readdir(path.join(workspace.outputRoot, 'projects'), { withFileTypes: true });
  const projectHtml = await Promise.all(projectEntries.filter((entry) => entry.isDirectory()).map((entry) => readFile(path.join(workspace.outputRoot, 'projects', entry.name, 'index.html'), 'utf8')));
  const evidenceSources = projectHtml.flatMap((document) => [...document.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]).filter((source) => source.includes('/assets/')));
  const expectedImageCount = (await loadSiteRepository()).images.filter(({ kind }) => kind === 'project').length;
  assert.equal(evidenceSources.length, expectedImageCount);
  assert.ok(evidenceSources.every((source) => source.startsWith('/repo/assets/')));
  assert.ok(evidenceSources.every((source) => !source.startsWith('/assets/')));
});
