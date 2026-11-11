#!/usr/bin/env node
/**
 * patch-cloud GitHub Action entrypoint.
 * Reads package.json + lockfile, compares them to the public feed, writes a
 * job summary, and (on pull_request) posts or updates a single comment.
 */
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePackageJson,
  parsePackageLock,
  parseYarnLock,
  parsePnpmLock,
  mergeDeps,
  matchFeed,
} from './lib/parse-deps.mjs';
import { COMMENT_MARKER, buildComment, buildSummary } from './lib/comment.mjs';
import { syncPullRequestComment } from './lib/github.mjs';

export function input(name, fallback = '', env = process.env) {
  const upper = name.replaceAll(' ', '_').toUpperCase();
  const keys = [`INPUT_${upper}`, `INPUT_${upper.replaceAll('-', '_')}`];
  for (const key of keys) {
    const v = env[key];
    if (v != null && v !== '') return v;
  }
  return fallback;
}

export function truthy(value) {
  return !['false', '0', 'off', 'no', ''].includes(String(value ?? 'true').trim().toLowerCase());
}

export function loadProjectDeps(root) {
  const maps = [];
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    return { deps: new Map(), files: [], warning: `No package.json in ${root}` };
  }
  maps.push(parsePackageJson(readFileSync(pkgPath, 'utf8')));
  const files = ['package.json'];
  const lockers = [
    ['package-lock.json', parsePackageLock],
    ['npm-shrinkwrap.json', parsePackageLock],
    ['yarn.lock', parseYarnLock],
    ['pnpm-lock.yaml', parsePnpmLock],
  ];
  for (const [name, parse] of lockers) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    files.push(name);
    maps.push(parse(readFileSync(p, 'utf8'), name));
  }
  return { deps: mergeDeps(...maps), files, warning: null };
}

export async function fetchFeed(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'patch-cloud-action' } });
  if (!res.ok) throw new Error(`Failed to fetch feed ${url}: ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.items)) {
    throw new Error(`Feed ${url} is not a patch-cloud JSON feed (missing items[])`);
  }
  return data;
}

function setOutput(name, value, env = process.env) {
  const out = env.GITHUB_OUTPUT;
  if (!out) return;
  appendFileSync(out, `${name}=${value}\n`);
}

function writeSummary(text, env = process.env) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, text);
  else console.log(text);
}

export async function run(env = process.env) {
  const workspace = env.GITHUB_WORKSPACE || process.cwd();
  const workdir = input('working-directory', '.', env);
  const root = resolve(workspace, workdir);
  const feedUrl = input('feed-url', 'https://patch-cloud-production.up.railway.app/feed.json', env);
  const token = input('github-token', env.GITHUB_TOKEN || '', env);
  const wantComment = truthy(input('comment', 'true', env));
  const apiBase = env.GITHUB_API_URL || 'https://api.github.com';
  const eventName = env.GITHUB_EVENT_NAME || '';
  const repo = env.GITHUB_REPOSITORY || '';

  let prNumber = null;
  if (env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH)) {
    try {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
      prNumber = event.pull_request?.number || event.issue?.number || null;
    } catch {
      /* ignore */
    }
  }
  if (!prNumber && env.PR_NUMBER) prNumber = Number(env.PR_NUMBER) || null;

  const { deps, files, warning } = loadProjectDeps(root);
  if (warning) console.warn(warning);
  console.log(`Scanned ${files.join(', ') || 'no manifest'} (${deps.size} packages)`);

  const feed = await fetchFeed(feedUrl);
  const matches = matchFeed(deps, feed);
  const darkCount = matches.length;
  const fixCount = matches.filter((m) => m.feed?.fixAvailable).length;
  setOutput('dark-count', String(darkCount), env);
  setOutput('fix-count', String(fixCount), env);

  let commented = false;
  const isPr = eventName === 'pull_request' || eventName === 'pull_request_target';
  if (isPr && wantComment && token && repo && prNumber) {
    const body = buildComment({ matches, feed, feedUrl });
    const result = await syncPullRequestComment({
      token,
      repo,
      issueNumber: prNumber,
      marker: COMMENT_MARKER,
      body,
      shouldComment: darkCount > 0,
      opts: { apiBase },
    });
    commented = result.action === 'created' || result.action === 'updated';
    console.log(`PR comment: ${result.action}${result.id ? ` #${result.id}` : ''}`);
  } else if (isPr && wantComment && !token) {
    console.warn('Skipping PR comment: no github-token / GITHUB_TOKEN');
  } else if (isPr && wantComment && !prNumber) {
    console.warn('Skipping PR comment: no pull request number');
  }

  setOutput('commented', commented ? 'true' : 'false', env);
  writeSummary(buildSummary({ matches, feedUrl, commented, event: eventName }), env);
  return { darkCount, fixCount, commented, matches };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
