/**
 * Minimal GitHub API helper (no deps). Uses GITHUB_TOKEN.
 * All comment writes stay on the triggering pull request.
 */

export async function githubRequest(token, method, url, body, { apiBase = 'https://api.github.com' } = {}) {
  const href = url.startsWith('http') ? url : `${apiBase}${url}`;
  const res = await fetch(href, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'patch-cloud-action',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = typeof data === 'object' && data?.message ? data.message : text.slice(0, 300);
    const err = new Error(`GitHub API ${method} ${href} failed: ${res.status} ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function listIssueComments(token, repo, issueNumber, opts = {}) {
  const comments = [];
  let page = 1;
  for (;;) {
    const batch = await githubRequest(
      token,
      'GET',
      `/repos/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      null,
      opts,
    );
    comments.push(...(batch || []));
    if (!batch || batch.length < 100) break;
    page += 1;
    if (page > 10) break;
  }
  return comments;
}

export async function syncPullRequestComment({
  token,
  repo,
  issueNumber,
  marker,
  body,
  shouldComment,
  opts = {},
}) {
  const comments = await listIssueComments(token, repo, issueNumber, opts);
  const existing = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker));
  if (!shouldComment) {
    if (existing) {
      await githubRequest(token, 'DELETE', `/repos/${repo}/issues/comments/${existing.id}`, null, opts);
      return { action: 'deleted', id: existing.id };
    }
    return { action: 'none', id: null };
  }
  if (existing) {
    const updated = await githubRequest(
      token,
      'PATCH',
      `/repos/${repo}/issues/comments/${existing.id}`,
      { body },
      opts,
    );
    return { action: 'updated', id: updated.id || existing.id };
  }
  const created = await githubRequest(
    token,
    'POST',
    `/repos/${repo}/issues/${issueNumber}/comments`,
    { body },
    opts,
  );
  return { action: 'created', id: created.id };
}
