export const COMMENT_MARKER = '<!-- patch-cloud-action -->';

function mdEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/`/g, '\\`');
}

export function buildComment({ matches, feed, feedUrl }) {
  const registry = feed?.registry || 'https://patch-cloud-production.up.railway.app';
  const statusUrl = feed?.statusUrl || `${registry}/status`;
  const withFix = matches.filter((m) => m.feed?.fixAvailable && m.feed?.install);
  const withoutFix = matches.filter((m) => !m.feed?.fixAvailable || !m.feed?.install);
  const lines = [
    COMMENT_MARKER,
    '## patch-cloud: dark upstream lights',
    '',
    `This project's dependencies include packages whose upstream CI is currently **dark** (the project's own latest build did not pass). Data comes from the [patch-cloud feed](${feedUrl || statusUrl}).`,
    '',
  ];
  if (withFix.length) {
    lines.push('A packaged fix is available from the **opt-in** [patch-cloud](' + registry + ') registry:');
    lines.push('');
    lines.push('| package | upstream | dark since | how this project depends on it | opt-in install |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const m of withFix) {
      const since = m.feed.since ? m.feed.since.slice(0, 10) : '—';
      const how = m.direct ? `direct (${m.source || 'dependencies'})` : 'transitive (lockfile)';
      const run = m.feed.failingRunUrl ? ` ([failing run](${m.feed.failingRunUrl}))` : '';
      const upstream = m.feed.upstreamRepo
        ? `[${mdEscape(m.feed.upstreamRepo)}](https://github.com/${m.feed.upstreamRepo})${run}`
        : '—';
      lines.push(
        `| \`${mdEscape(m.name)}\` | ${upstream} | ${mdEscape(since)} | ${mdEscape(how)} | \`${mdEscape(m.feed.install)}\` |`,
      );
    }
    lines.push('');
    lines.push('To try the fixes for a whole project, add this to `.npmrc` and reinstall:');
    lines.push('');
    lines.push('```');
    lines.push(feed?.optIn?.npmrc || `registry=${registry}/`);
    lines.push('```');
    lines.push('');
    lines.push(feed?.optIn?.optOut || 'To opt out, remove the `--registry` flag or the `registry=` line from `.npmrc` and reinstall to use the official npm registry.');
    lines.push('');
  }
  if (withoutFix.length) {
    lines.push(withFix.length ? 'These dependencies are also dark upstream, but patch-cloud does not currently serve a packaged fix:' : 'These dependencies are dark upstream. patch-cloud does not currently serve a packaged fix for them:');
    lines.push('');
    lines.push('| package | upstream | dark since | how this project depends on it |');
    lines.push('| --- | --- | --- | --- |');
    for (const m of withoutFix) {
      const since = m.feed.since ? m.feed.since.slice(0, 10) : '—';
      const how = m.direct ? `direct (${m.source || 'dependencies'})` : 'transitive (lockfile)';
      const run = m.feed.failingRunUrl ? ` ([failing run](${m.feed.failingRunUrl}))` : '';
      const upstream = m.feed.upstreamRepo
        ? `[${mdEscape(m.feed.upstreamRepo)}](https://github.com/${m.feed.upstreamRepo})${run}`
        : '—';
      lines.push(`| \`${mdEscape(m.name)}\` | ${upstream} | ${mdEscape(since)} | ${mdEscape(how)} |`);
    }
    lines.push('');
  }
  lines.push('This comment is posted by the [patch-cloud GitHub Action](https://github.com/fitzyracing1/patch-cloud-action), which this repository opted into. It updates this same comment on later runs and leaves no comment when nothing is dark.');
  lines.push('');
  return lines.join('\n');
}

export function buildSummary({ matches, feedUrl, commented, event }) {
  const lines = ['## patch-cloud', ''];
  if (!matches.length) {
    lines.push('No dependencies in this project are currently dark on the patch-cloud feed.');
    lines.push('');
    lines.push(`Feed: ${feedUrl}`);
    return lines.join('\n');
  }
  lines.push(`Found **${matches.length}** dark upstream dependenc${matches.length === 1 ? 'y' : 'ies'} (${matches.filter((m) => m.feed?.fixAvailable).length} with a packaged fix).`);
  lines.push('');
  for (const m of matches) {
    const fix = m.feed?.fixAvailable ? `fix: \`${m.feed.install}\`` : 'no packaged fix';
    lines.push(`- \`${m.name}\` — ${m.feed?.upstreamRepo || 'unknown repo'} — ${fix}`);
  }
  lines.push('');
  if (event !== 'pull_request' && event !== 'pull_request_target') {
    lines.push(`No pull request comment (${event || 'this event'} is not a pull_request).`);
  } else if (commented) {
    lines.push('Posted or updated a single pull request comment.');
  } else {
    lines.push('Did not post a pull request comment.');
  }
  lines.push('');
  lines.push(`Feed: ${feedUrl}`);
  lines.push('');
  return lines.join('\n');
}
