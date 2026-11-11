/**
 * Collect npm package names from package.json and common lockfiles.
 * Direct dependencies come from package.json; lockfiles add resolved
 * (including transitive) names. workspace:/file:/link: specs are skipped.
 */

const DIRECT_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

function skippedSpec(spec) {
  if (typeof spec !== 'string') return false;
  return /^(workspace:|file:|link:|portal:)/.test(spec);
}

export function parsePackageJson(text, source = 'package.json') {
  const pkg = JSON.parse(text);
  const deps = new Map();
  for (const field of DIRECT_FIELDS) {
    const block = pkg[field] || {};
    for (const [name, range] of Object.entries(block)) {
      if (!name || skippedSpec(range)) continue;
      deps.set(name, {
        name,
        range: typeof range === 'string' ? range : null,
        version: null,
        direct: true,
        source: field,
        file: source,
      });
    }
  }
  return deps;
}

function addLockDep(deps, name, { version = null, file = 'package-lock.json' } = {}) {
  if (!name || name.startsWith('node_modules/')) return;
  const existing = deps.get(name);
  if (existing) {
    if (!existing.version && version) existing.version = version;
    return;
  }
  deps.set(name, {
    name,
    range: null,
    version,
    direct: false,
    source: 'lockfile',
    file,
  });
}

export function parsePackageLock(text, source = 'package-lock.json') {
  const lock = JSON.parse(text);
  const deps = new Map();
  if (lock.packages && typeof lock.packages === 'object') {
    for (const [path, meta] of Object.entries(lock.packages)) {
      if (!path) continue;
      const m = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/);
      if (!m) continue;
      addLockDep(deps, m[1], { version: meta?.version || null, file: source });
    }
  }
  if (lock.dependencies && typeof lock.dependencies === 'object') {
    const walk = (tree) => {
      for (const [name, meta] of Object.entries(tree || {})) {
        if (meta && typeof meta === 'object') {
          addLockDep(deps, name, { version: meta.version || null, file: source });
          if (meta.dependencies) walk(meta.dependencies);
        }
      }
    };
    walk(lock.dependencies);
  }
  return deps;
}

/** Yarn classic (v1) and a conservative Berry name parse. */
export function parseYarnLock(text, source = 'yarn.lock') {
  const deps = new Map();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    if (!header || header.startsWith(' ') || header.startsWith('#')) continue;
    if (!header.includes('@') || !header.trim().endsWith(':')) continue;
    // "ms@^2.1.3:" or ms@^2.1.3: or "@types/node@^20", "@types/node@^21":
    const names = new Set();
    const parts = header.replace(/:$/, '').split(', ');
    for (let part of parts) {
      part = part.trim().replace(/^"+|"+$/g, '');
      const m = part.match(/^((?:@[^/]+\/)?[^@]+)@/);
      if (m) names.add(m[1]);
    }
    let version = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] && !lines[j].startsWith(' ')) break;
      const vm = lines[j].match(/^\s+version(?:\s+|:\s*)"?([^"\s]+)"?/);
      if (vm) {
        version = vm[1];
        break;
      }
    }
    for (const name of names) addLockDep(deps, name, { version, file: source });
  }
  return deps;
}

function parsePnpmNameVersion(key) {
  const cleaned = String(key || '').replace(/^['"]|['"]$/g, '').replace(/^\//, '');
  const m = cleaned.match(/^((?:@[^/@]+\/)?[^@/]+)@(.+)$/);
  if (!m) return null;
  return { name: m[1], version: m[2].split('(')[0] };
}

/** pnpm-lock.yaml — names from importers and packages keys. */
export function parsePnpmLock(text, source = 'pnpm-lock.yaml') {
  const deps = new Map();
  const lines = text.split(/\r?\n/);
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^packages:\s*$/.test(line)) {
      section = 'packages';
      continue;
    }
    if (/^importers:\s*$/.test(line)) {
      section = 'importers';
      continue;
    }
    if (/^[A-Za-z0-9_-]+:\s*$/.test(line) && !line.startsWith(' ')) {
      section = '';
      continue;
    }
    if (section === 'packages') {
      const keyLine = line.match(/^ {2}['"]?(\/?.*?)['"]?:\s*$/);
      if (keyLine) {
        const parsed = parsePnpmNameVersion(keyLine[1]);
        if (parsed) addLockDep(deps, parsed.name, { version: parsed.version, file: source });
      }
    }
    if (section === 'importers') {
      const mm = line.match(/^ {6}((?:@[^/\s]+\/)?[^:\s]+):\s*$/);
      const prev = i > 0 ? lines[i - 1] : '';
      // only treat names under a dependencies-like key; looser fallback is ok
      if (mm && !mm[1].includes('specifier') && !mm[1].includes('version') && !['dependencies', 'devDependencies', 'optionalDependencies'].includes(mm[1])) {
        // skip keys that are pnpm metadata
        if (!['resolution', 'engines', 'peerDependencies', 'dependencies', 'devDependencies', 'optionalDependencies', 'snapshots', 'importers'].includes(mm[1])) {
          addLockDep(deps, mm[1], { file: source });
        }
      }
    }
  }
  return deps;
}

export function mergeDeps(...maps) {
  const out = new Map();
  for (const map of maps) {
    for (const [name, dep] of map || []) {
      const existing = out.get(name);
      if (!existing) {
        out.set(name, { ...dep });
        continue;
      }
      out.set(name, {
        ...existing,
        direct: existing.direct || dep.direct,
        range: existing.range || dep.range,
        version: existing.version || dep.version,
        source: existing.direct ? existing.source : dep.source,
        file: existing.direct ? existing.file : dep.file,
      });
    }
  }
  return out;
}

export function matchFeed(deps, feed) {
  const items = Array.isArray(feed?.items) ? feed.items : [];
  const byName = new Map(items.map((i) => [i.package, i]));
  const matches = [];
  for (const [name, dep] of deps) {
    const item = byName.get(name);
    if (!item) continue;
    if (item.light !== 'dark') continue;
    matches.push({ ...dep, feed: item });
  }
  matches.sort((a, b) => a.name.localeCompare(b.name));
  return matches;
}
