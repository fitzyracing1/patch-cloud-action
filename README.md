# patch-cloud-action

A GitHub Action that, on pull requests, checks this project's `package.json` and lockfile against the public [patch-cloud](https://patch-cloud-production.up.railway.app/status) feed. When a dependency's upstream CI light is **dark** (the upstream project's latest build did not pass) it posts or updates a **single** comment listing the dark packages and, when a packaged fix is available, the opt-in install line and how to opt out.

This is opt-in: nothing happens until a repository adds the workflow. It uses `GITHUB_TOKEN`. It leaves **no comment** when nothing in the project is dark. A previous comment is updated in place, and removed if the lights are no longer dark.

It does not change your registry, install anything, or publish packages.

Current version: **v0.1.0** (use `fitzyracing1/patch-cloud-action@v0.1.0`).

## Add it to a repository

Copy [`examples/patch-cloud.yml`](examples/patch-cloud.yml) into your repo as `.github/workflows/patch-cloud.yml`:

```yaml
name: patch-cloud
on:
  pull_request:
jobs:
  patch-cloud:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: fitzyracing1/patch-cloud-action@v0.1.0
```

`contents: read` is enough to see `package.json` and the lockfile. `pull-requests: write` is required to post or update the comment. The job still writes a summary when there is nothing to say on the PR.

## What it reads

- `package.json` — `dependencies`, `devDependencies`, and `optionalDependencies` (skips `file:`, `link:`, and `workspace:` specs)
- `package-lock.json` or `npm-shrinkwrap.json` (lockfile v1–v3), `yarn.lock`, and `pnpm-lock.yaml` for resolved and transitive names

It then fetches [the patch-cloud JSON feed](https://patch-cloud-production.up.railway.app/feed.json) (or a `feed-url` you set) and matches package names whose light is dark.

## Inputs

| input | default | what it does |
| --- | --- | --- |
| `feed-url` | `https://patch-cloud-production.up.railway.app/feed.json` | JSON feed of dark packages and available fixes |
| `github-token` | `${{ github.token }}` | token used to post or update the PR comment |
| `comment` | `true` | if `false`, only write the job summary |
| `working-directory` | `.` | project directory that contains `package.json` |

## Outputs

| output | meaning |
| --- | --- |
| `dark-count` | number of dependencies whose upstream light is dark |
| `fix-count` | number of those that have a packaged patch-cloud fix |
| `commented` | `true` if a PR comment was posted or updated |

## Opting out of patch-cloud itself

The comment's install line is optional. To use the official npm registry, remove the `--registry` flag or the `registry=` line from `.npmrc` and reinstall. Adding this Action never points your project at patch-cloud on its own.

## Development

```bash
npm test
```

The tests include a local simulation: a fixture project, a local JSON feed, and a mock GitHub API. The first run posts one comment, the second run updates that same comment, and a later run with nothing dark deletes it.

## Plans

This project is free. Support it through [GitHub Sponsors](https://github.com/sponsors/fitzyracing1):

- **Free**: use the code, community support.
- **Pro ($49/month)**: priority issues and support.
- **Team ($199/month)**: priority support for your team plus early access.
