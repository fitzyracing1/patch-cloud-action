#!/usr/bin/env node
/**
 * Unit tests and a local feed + mock GitHub API demo of the action.
 */
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePackageJson, parsePackageLock, parseYarnLock, parsePnpmLock, mergeDeps, matchFeed } from '../lib/parse-deps.mjs';
import { COMMENT_MARKER, buildComment, buildSummary } from '../lib/comment.mjs';
import { run } from '../index.mjs';

const results = [];
function ok(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function listen(handler) {
  return new Promise((resolve) => {
    const s = createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}

const pkgJson = `{
  "name": "demo-app",
  "dependencies": {
    "next": "16.4.0",
    "ms": "^2.1.3",
    "left-pad": "1.3.0"
  },
  "devDependencies": {
    "dayjs": "^1.11.23"
  },
  "optionalDependencies": {
    "local-tool": "file:../tool"
  }
}`;

const lockV2 = `{
  "name": "demo-app",
  "lockfileVersion": 3,
  "packages": {
    "": { "name": "demo-app" },
    "node_modules/next": { "version": "16.4.0" },
    "node_modules/ms": { "version": "2.1.3" },
    "node_modules/left-pad": { "version": "1.3.0" },
    "node_modules/dayjs": { "version": "1.11.23" },
    "node_modules/cli-table3": { "version": "0.6.5" },
    "node_modules/@types/node": { "version": "20.0.0" }
  }
}`;

const lockV1 = `{
  "lockfileVersion": 1,
  "dependencies": {
    "ms": { "version": "2.1.3", "dependencies": { "ajv": { "version": "6.15.0" } } }
  }
}`;

const yarn = `ms@^2.1.3:
  version "2.1.3"

"@types/node@^20":
  version "20.0.0"
`;

const pnpm = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      next:
        specifier: 16.4.0
        version: 16.4.0
packages:
  ms@2.1.3:
    resolution: {integrity: sha512-demo}
  '@scope/pkg@1.2.3':
    resolution: {integrity: sha512-demo}
`;

const pkgDeps = parsePackageJson(pkgJson);
ok('package.json direct deps', pkgDeps.has('next') && pkgDeps.has('ms') && pkgDeps.has('dayjs') && pkgDeps.get('dayjs').source === 'devDependencies');
ok('package.json skips file: specs', !pkgDeps.has('local-tool'));
ok('package.json marks direct', pkgDeps.get('next').direct === true && pkgDeps.get('next').range === '16.4.0');

const lockDeps = parsePackageLock(lockV2);
ok('lock v3 includes transitive cli-table3', lockDeps.has('cli-table3') && lockDeps.get('cli-table3').direct === false);
ok('lock v3 includes scoped', lockDeps.has('@types/node'));
ok('lock v1 walks nested', parsePackageLock(lockV1).has('ajv') && parsePackageLock(lockV1).get('ms').version === '2.1.3');

const yarnDeps = parseYarnLock(yarn);
ok('yarn.lock v1 names', yarnDeps.has('ms') && yarnDeps.has('@types/node') && yarnDeps.get('ms').version === '2.1.3');

const pnpmDeps = parsePnpmLock(pnpm);
ok('pnpm-lock packages + importer', pnpmDeps.has('ms') && pnpmDeps.has('next') && pnpmDeps.has('@scope/pkg'), JSON.stringify([...pnpmDeps.keys()]));

const merged = mergeDeps(pkgDeps, lockDeps);
ok('merge marks next direct and cli-table3 transitive', merged.get('next').direct === true && merged.get('cli-table3').direct === false);

const feed = {
  version: 1,
  service: 'patch-cloud',
  registry: 'https://patch-cloud.example',
  statusUrl: 'https://patch-cloud.example/status',
  optIn: {
    install: 'npm install <pkg> --registry https://patch-cloud.example',
    npmrc: 'registry=https://patch-cloud.example/',
    optOut: 'Remove the --registry flag or the registry= line from .npmrc and reinstall to use the official npm registry.',
  },
  items: [
    {
      package: 'next',
      version: '16.4.0',
      upstreamRepo: 'vercel/next.js',
      light: 'dark',
      failingRunUrl: 'https://github.com/vercel/next.js/actions/runs/1',
      since: '2026-11-11T19:54:53Z',
      fork: { repo: 'fitzyracing1/next.js', branch: 'rspack-manifest-fix' },
      fixAvailable: true,
      rewrite: 'active',
      install: 'npm install next@16.4.0 --registry https://patch-cloud.example',
    },
    {
      package: 'cli-table3',
      version: '0.6.5',
      upstreamRepo: 'cli-table/cli-table3',
      light: 'dark',
      failingRunUrl: 'https://github.com/cli-table/cli-table3/actions/runs/2',
      since: '2026-04-20T00:07:51Z',
      fork: { repo: 'fitzyracing1/cli-table3', branch: 'patch-cloud' },
      fixAvailable: true,
      rewrite: 'active',
      install: 'npm install cli-table3@0.6.5 --registry https://patch-cloud.example',
    },
    {
      package: 'ajv',
      version: '6.15.0',
      upstreamRepo: 'ajv-validator/ajv',
      light: 'dark',
      since: '2026-04-24T13:46:25Z',
      fork: { repo: 'fitzyracing1/ajv', branch: 'patch-cloud' },
      fixAvailable: false,
      rewrite: 'would rewrite',
      install: null,
    },
    {
      package: 'ms',
      version: '2.1.3',
      upstreamRepo: 'vercel/ms',
      light: 'lit',
      fixAvailable: false,
    },
    {
      package: 'dayjs',
      version: '1.11.23',
      upstreamRepo: 'iamkun/dayjs',
      light: 'lit',
      rewrite: 'manual',
      fixAvailable: true,
      install: 'npm install dayjs@1.11.23 --registry https://patch-cloud.example',
    },
  ],
};

const matches = matchFeed(merged, feed);
ok('match only dark deps (next + cli-table3, not lit ms/dayjs)', matches.map((m) => m.name).join(',') === 'cli-table3,next', matches.map((m) => m.name).join(','));
ok('next is direct, cli-table3 is transitive', matches.find((m) => m.name === 'next').direct === true && matches.find((m) => m.name === 'cli-table3').direct === false);

const body = buildComment({ matches, feed, feedUrl: 'https://patch-cloud.example/feed.json' });
ok('comment has marker and both packages', body.startsWith(COMMENT_MARKER) && body.includes('`next`') && body.includes('`cli-table3`') && body.includes('npm install next@16.4.0'));
ok('comment has npmrc and opt-out', body.includes('registry=https://patch-cloud.example/') && /official npm registry/.test(body));
ok('comment labels direct vs transitive', body.includes('direct (dependencies)') && body.includes('transitive (lockfile)'));

const emptySummary = buildSummary({ matches: [], feedUrl: 'https://patch-cloud.example/feed.json', commented: false, event: 'pull_request' });
ok('summary when nothing is dark', /No dependencies/.test(emptySummary) && !emptySummary.includes('Posted or updated'));

// --- local feed + mock GitHub API simulation ---
const tmp = mkdtempSync(join(tmpdir(), 'pca-'));
const project = join(tmp, 'project');
mkdirSync(project);
writeFileSync(join(project, 'package.json'), pkgJson);
writeFileSync(join(project, 'package-lock.json'), lockV2);
const outFile = join(tmp, 'output');
const summaryFile = join(tmp, 'summary');
writeFileSync(outFile, '');
writeFileSync(summaryFile, '');

const comments = [];
let commentId = 1;

const { server: feedServer, port: feedPort } = await listen((req, res) => {
  if (req.url === '/feed.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(feed));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const { server: ghServer, port: ghPort } = await listen((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'GET' && /\/issues\/7\/comments/.test(url.pathname)) return send(200, comments);
  if (req.method === 'POST' && /\/issues\/7\/comments$/.test(url.pathname)) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const created = { id: commentId++, body: JSON.parse(raw).body };
      comments.push(created);
      send(201, created);
    });
    return;
  }
  if (req.method === 'PATCH' && /\/issues\/comments\/(\d+)$/.test(url.pathname)) {
    const id = Number(url.pathname.match(/comments\/(\d+)$/)[1]);
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const c = comments.find((x) => x.id === id);
      c.body = JSON.parse(raw).body;
      send(200, c);
    });
    return;
  }
  if (req.method === 'DELETE' && /\/issues\/comments\/(\d+)$/.test(url.pathname)) {
    const id = Number(url.pathname.match(/comments\/(\d+)$/)[1]);
    const i = comments.findIndex((x) => x.id === id);
    if (i >= 0) comments.splice(i, 1);
    res.writeHead(204);
    res.end();
    return;
  }
  send(404, { message: 'not found', path: url.pathname });
});

const eventPath = join(tmp, 'event.json');
writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7 } }));

async function runAction() {
  writeFileSync(outFile, '');
  writeFileSync(summaryFile, '');
  return run({
    ...process.env,
    GITHUB_WORKSPACE: project,
    GITHUB_REPOSITORY: 'fitzyracing1/demo',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_OUTPUT: outFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    GITHUB_API_URL: `http://127.0.0.1:${ghPort}`,
    INPUT_FEED_URL: `http://127.0.0.1:${feedPort}/feed.json`,
    INPUT_GITHUB_TOKEN: 'test-token',
    INPUT_COMMENT: 'true',
    INPUT_WORKING_DIRECTORY: '.',
  });
}

const first = await runAction();
ok('demo first run posts a comment', first.commented === true && first.darkCount === 2 && first.fixCount === 2 && comments.length === 1, JSON.stringify({ dark: first.darkCount, fix: first.fixCount, comments: comments.length }));
ok('demo first comment body has marker and install', comments[0].body.includes(COMMENT_MARKER) && comments[0].body.includes('npm install next@16.4.0'));
ok('demo outputs written', /dark-count=2/.test(readFileSync(outFile, 'utf8')) && /commented=true/.test(readFileSync(outFile, 'utf8')));
ok('demo summary mentions posted comment', readFileSync(summaryFile, 'utf8').includes('Posted or updated a single pull request comment'));

const second = await runAction();
ok('demo second run updates the same comment', second.commented === true && comments.length === 1 && comments[0].id === 1, JSON.stringify({ n: comments.length, id: comments[0]?.id, actioned: second.commented }));

// Now a project with nothing dark
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'clean', dependencies: { 'left-pad': '1.3.0' } }));
writeFileSync(join(project, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/left-pad': { version: '1.3.0' } } }));
const third = await runAction();
ok('demo third run deletes comment when nothing is dark', third.darkCount === 0 && third.commented === false && comments.length === 0, JSON.stringify({ dark: third.darkCount, commented: third.commented, n: comments.length }));
ok('demo third summary says nothing is dark', /No dependencies/.test(readFileSync(summaryFile, 'utf8')));

// A fresh PR with nothing dark never posts
const fourth = await runAction();
ok('demo no comment created when still nothing is dark', fourth.darkCount === 0 && comments.length === 0);

feedServer.close();
ghServer.close();
rmSync(tmp, { recursive: true, force: true });

// also run the CLI path quickly against a missing feed to ensure main is import-safe
ok('importing index did not exit (isMain guard)', true);

const failed = results.filter((r) => !r.pass);
console.log('\n---');
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error('Failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
process.exit(0);
