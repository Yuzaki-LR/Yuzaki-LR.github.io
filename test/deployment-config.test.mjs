import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import { parseAllDocuments } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github', 'workflows', 'deploy.yml');
const configUrl = pathToFileURL(path.join(root, 'astro.config.mjs')).href;
const dynamicPagesOrigin = 'https://${{ github.repository_owner }}.github.io';

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function readWorkflow() {
  const source = readFileSync(workflowPath, 'utf8');
  const documents = parseAllDocuments(source, {
    strict: true,
    uniqueKeys: true,
    version: '1.2',
  });

  assert.equal(documents.length, 1, 'deployment workflow must contain exactly one YAML document');
  assert.deepEqual(documents[0].errors, [], 'deployment workflow must have no YAML parse errors');
  assert.deepEqual(documents[0].warnings, [], 'deployment workflow must have no YAML parse warnings');

  const workflow = documents[0].toJS();
  assert.ok(workflow !== null && typeof workflow === 'object' && !Array.isArray(workflow));
  return workflow;
}

function collectScalars(value, scalars = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectScalars(item, scalars);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectScalars(item, scalars);
  } else {
    scalars.push(value);
  }
  return scalars;
}

function readAstroConfig(siteUrl) {
  const environment = { ...process.env };
  if (siteUrl === undefined) {
    delete environment.SITE_URL;
  } else {
    environment.SITE_URL = siteUrl;
  }

  const program = `
    const config = (await import(${JSON.stringify(configUrl)})).default;
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(config, key);
    process.stdout.write(JSON.stringify({
      hasSite: hasOwn('site'),
      site: config.site,
      output: config.output,
      trailingSlash: config.trailingSlash,
      inlineStylesheets: config.build?.inlineStylesheets,
      hasBase: hasOwn('base'),
      base: config.base,
    }));
  `;

  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
  }));
}

function assertStaticUserSiteConfig(config) {
  assert.equal(config.output, 'static');
  assert.equal(config.trailingSlash, 'always');
  assert.equal(config.inlineStylesheets, 'never');
  assert.ok(!config.hasBase || config.base === '/', 'user site must not use a project subpath base');
}

test('workflow parses as one strict YAML 1.2 mapping', () => {
  readWorkflow();
});

test('workflow exposes only the approved triggers, permissions, and concurrency', () => {
  const workflow = readWorkflow();

  assert.deepEqual(sortedKeys(workflow.on), ['push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.push, { branches: ['main'] });
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  assert.ok(
    workflow.on.workflow_dispatch === null
      || (typeof workflow.on.workflow_dispatch === 'object'
        && !Array.isArray(workflow.on.workflow_dispatch)
        && Object.keys(workflow.on.workflow_dispatch).length === 0),
    'workflow_dispatch must not define inputs',
  );
  assert.deepEqual(workflow.permissions, {
    contents: 'read',
    pages: 'write',
    'id-token': 'write',
  });
  assert.deepEqual(workflow.concurrency, {
    group: 'pages',
    'cancel-in-progress': false,
  });
});

test('workflow defines only build and deploy jobs without job-level permissions', () => {
  const workflow = readWorkflow();

  assert.deepEqual(sortedKeys(workflow.jobs), ['build', 'deploy']);
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.equal(Object.hasOwn(job, 'permissions'), false);
  }
});

test('build executes only checkout v7 then Astro action v6 with the dynamic user-site origin', () => {
  const build = readWorkflow().jobs.build;

  assert.deepEqual(sortedKeys(build), ['runs-on', 'steps']);
  assert.equal(build.steps.length, 2);
  assert.deepEqual(sortedKeys(build.steps[0]), ['name', 'uses']);
  assert.equal(build.steps[0].uses, 'actions/checkout@v7');
  assert.deepEqual(sortedKeys(build.steps[1]), ['env', 'name', 'uses']);
  assert.equal(build.steps[1].uses, 'withastro/action@v6');
  assert.deepEqual(build.steps[1].env, { SITE_URL: dynamicPagesOrigin });
});

test('deploy consumes only build and executes one deploy-pages v5 step', () => {
  const deploy = readWorkflow().jobs.deploy;

  assert.deepEqual(sortedKeys(deploy), ['environment', 'needs', 'runs-on', 'steps']);
  assert.equal(deploy.needs, 'build');
  assert.deepEqual(deploy.environment, {
    name: 'github-pages',
    url: '${{ steps.deployment.outputs.page_url }}',
  });
  assert.equal(deploy.steps.length, 1);
  assert.deepEqual(sortedKeys(deploy.steps[0]), ['id', 'name', 'uses']);
  assert.equal(deploy.steps[0].id, 'deployment');
  assert.equal(deploy.steps[0].uses, 'actions/deploy-pages@v5');
});

test('workflow scalar values contain no placeholders or alternate Pages origins', () => {
  const scalars = collectScalars(readWorkflow());
  const stringScalars = scalars.filter((value) => typeof value === 'string');
  const forbiddenFragments = ['USERNAME', 'YOUR_NAME', 'YOUR-USERNAME', 'REPLACE_ME', 'example.com'];

  for (const fragment of forbiddenFragments) {
    assert.equal(
      stringScalars.some((value) => value.toUpperCase().includes(fragment.toUpperCase())),
      false,
      `workflow must not contain placeholder ${fragment}`,
    );
  }

  assert.deepEqual(
    stringScalars.filter((value) => value.includes('.github.io')),
    [dynamicPagesOrigin],
  );
  assert.equal(
    stringScalars.some((value) => value.includes('${{ github.repository }}')),
    false,
  );
});

test('Astro omits site when SITE_URL is absent and keeps static user-site defaults', () => {
  const config = readAstroConfig(undefined);

  assert.equal(config.hasSite, false);
  assertStaticUserSiteConfig(config);
});

test('Astro forwards SITE_URL exactly in a fresh process and keeps static user-site defaults', () => {
  const sentinel = 'https://task-8-config-sentinel.invalid';
  const config = readAstroConfig(sentinel);

  assert.equal(config.hasSite, true);
  assert.equal(config.site, sentinel);
  assertStaticUserSiteConfig(config);
});
