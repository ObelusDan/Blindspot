# Blindspot

**Catch what your pull request missed.**

Blindspot is a lightweight GitHub Action that reviews the shape of a pull request and warns when a change looks incomplete.

It is intentionally **not** an AI code reviewer, not a dashboard, and not a replacement for tests.

## Why Blindspot exists

PRs often include the main change but miss a companion change that should have happened with it.

Examples:

- API route changed, but no tests changed
- new environment variable added, but `.env.example` was not updated
- dependency manifest changed, but the lockfile did not
- database schema changed, but no migration changed
- workflow changed, but the security impact was not reviewed

Blindspot catches those patterns before merge.

## V1 rules

- Environment-variable usage changed without env example/docs changes
- Dependency manifest changed without a recognised lockfile change
- API/route/controller code changed without tests changing
- Database schema changed without a migration changing
- GitHub Actions workflow changed
- Very broad PRs are flagged for scope review

Warnings are conservative and do **not** block merges by default.

## Install

```yaml
name: Blindspot

on:
  pull_request:

jobs:
  blindspot:
    runs-on: ubuntu-latest
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: ObelusDan/Blindspot@v1
        with:
          base-ref: ${{ github.base_ref }}
```

## Local use

```bash
node src/index.js --base main
```

## Design rules

1. One job: catch likely missing companion changes.
2. No account, dashboard, hosted backend, or AI requirement in V1.
3. Explain every warning.
4. Prefer a missed warning over noisy nonsense.
5. Never modify the user's repository.

## Status

Early V1 build.
