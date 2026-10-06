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
- New executable root `bin/` entry points with a shebang without README/docs changes (`cli-command-without-docs`)
- Exported declarations in root `index.d.ts` changed without tests or README/docs changes (`public-types-without-tests-or-docs`)

Warnings are conservative and do **not** block merges by default.

## Companion-rule boundaries

The new CLI rule requires a Git new-file patch, executable mode `100755`, a
shebang, and a direct child of root `bin/`. Existing command edits, arbitrary
`scripts/`, nested helpers and non-executable files are skipped. Its warning
names the matching paths. Any README or `doc/` / `docs/` change suppresses it.

The public-types rule checks added/removed lines starting with exported
interface, type, class, function, const, let or enum declarations in root
`index.d.ts`. It ignores comments, context, whitespace-only changes and arbitrary
source exports. Any recognised test or README/docs change suppresses it.
This deliberately misses multiline body-only edits, re-exports, nested package
entry points and other languages. Both rules require file-local diff evidence;
quoted/ambiguous paths are skipped. Existing rule IDs and ordering are preserved;
new warnings follow the original six rules.

Candidate rules left out after false-positive review:

- Docker/container changes: many changes need no CI/deploy edits, and a diff
  cannot establish which deployment configuration exists or is related.
- Migration without schema/model: data migrations and handwritten SQL often
  have no model counterpart.
- General public interfaces/types: internal types and generated declarations
  cannot reliably be distinguished by broad path matching. Only the narrow
  root declaration entry point above is included.
- Security/auth without tests: folder names include configuration, helpers and
  non-behavioural changes; they do not reliably identify security semantics.
- Runtime dependency additions/removals: the existing `manifest-without-lock`
  rule already covers this. Another warning would duplicate it; distinguishing
  dependency blocks across manifest formats would add parsing complexity.
- Example/sample configuration: examples can document existing usage; a source
  edit is not necessarily required.
- Version/release metadata: release notes may be generated or maintained outside
  the repository. A version-only change does not establish a missing changelog.
- New routes without API docs: path matching cannot reliably establish that an
  endpoint was added or that externally maintained API docs need updating.
- General CLI command/script additions: maintenance scripts and internal command
  modules need not be documented; only executable root `bin/` additions qualify.

These checks inspect changed paths and supplied diff text only. Companion
changes are recognised repository-wide, so unrelated docs/tests can suppress a
warning. Generated root declarations or internal executable bin scripts can
still trigger a warning; the tool cannot prove intent. No parsing dependencies,
network calls or repository writes are introduced.

## Optional false-positive controls

Zero-config usage remains the default. To suppress known irrelevant warnings,
add `.blindspot.yml` at the root of the repository being checked:

```yaml
disable:
  - workflow-change
  - scope-review
ignore:
  - "vendor/**"
  - "generated/**"
tests:
  - "spec/**"
  - "integration/**"
migrations:
  - "db/migrations/**"
```

Only these four keys are supported; every key is optional. `disable` accepts
stable rule IDs:

- `env-undocumented`
- `manifest-without-lock`
- `api-without-tests`
- `schema-without-migration`
- `workflow-change`
- `scope-review`
- `cli-command-without-docs`
- `public-types-without-tests-or-docs`

`ignore` removes matching changed files from all checks, including diff evidence,
companion detection, scope counts, and the console/summary changed-file count.
An ignored test or README therefore cannot suppress a warning for another file.
When ignores are configured, renames are evaluated as deletion/addition pairs,
so each side respects its own path's ignore setting.

`tests` and `migrations` add companion patterns to the built-in defaults; they do
not replace them. Test patterns also apply to `public-types-without-tests-or-docs`.
Only changed files count as companions, not files merely present in the repository.

Patterns match the full repository-relative path, case-sensitively, using `/`:
`*` matches within one path segment, `?` matches one non-slash character, and
`**` matches across directories. `**/` also matches zero directories.
A trailing slash means all descendants (`spec/` is equivalent to `spec/**`);
a bare directory name matches only that exact path. Absolute paths, `.`/`..`
segments, backslashes, negation, braces and character classes are unsupported.
Quote patterns, especially those beginning with `*`.

The dependency-free parser intentionally supports a small YAML subset: top-level
keys with indented `- string` lists, or `[]` for an empty list. Blank lines and
`#` comments are supported. Strings may be plain, single-quoted (double an
apostrophe to escape it), or double-quoted with JSON string escapes. Flow lists
other than `[]`, nested mappings, tags, anchors, aliases, includes and additional
keys are rejected. There are no commands, expressions, plugins, severity settings
or remote configuration. Strings are data and are never executed.

Blindspot reads `.blindspot.yml` from the root tree of the **resolved base ref's
commit**, using read-only Git object commands. This is the base branch tip, not
the merge-base commit used for the diff. Missing or empty base config preserves
zero-config behaviour; invalid base config fails with exit `1` and a corrective
diagnostic rather than falling back. Config must be a regular Git blob (no
symlink or directory) of at most 64 KiB.

The same behaviour applies in Actions and locally, including invocation from a
subdirectory: `node src/index.js --base main` uses committed config on local
`main` (or the existing remote-ref fallback). Config edits in the feature branch
or working tree cannot suppress warnings in that branch's own check. After the
config is merged into the base branch, later checks against that updated base
use it, even if their merge base predates the config. To try config locally,
commit it on a separate local base branch and compare against that ref. Blindspot
never fetches, checks out files, or modifies refs/files; the chosen base ref must
already be available locally. The diff still compares committed HEAD with its
merge base. Warnings still exit `0` by default; `fail-on-warning` is unchanged.

Duplicate values within any of the four lists are rejected with a config error
that identifies the list, value and repeated entry's line. Equality uses the
parsed string, so quoted and plain spellings of the same value are duplicates.
Different patterns that happen to match the same paths are allowed.

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

## GitHub Actions job summary

When `GITHUB_STEP_SUMMARY` is set, Blindspot appends a Markdown summary with
the changed-file count and either a clear success message or the warning count,
stable rule IDs and human-readable messages in rule order. Console output is
unchanged. Without that variable, local execution only prints console output.
If the summary cannot be written, Blindspot reports a warning on stderr and
preserves the evaluation exit code, including opt-in `fail-on-warning` behaviour.
No GitHub API calls, PR comments or additional dependencies are used.

## Local use

```bash
node src/index.js --base main
```

Base selection uses the Action `base-ref` input, then local `--base`, then
`GITHUB_BASE_REF`, and finally `main`. Local branches, `origin/<branch>`, full
refs, and commit IDs are supported. Only locally available history is read;
Blindspot never fetches, checks out files, or updates refs. If the base is missing,
fetch it yourself before checking. In Actions, use `fetch-depth: 0` as above so
the base and merge-base history are available.

An empty diff succeeds with zero warnings. Exit codes are `0` for a successful
check, `1` for an error (with a diagnostic), and `2` for warnings when
`fail-on-warning` is enabled. The check compares committed HEAD against its
merge base; uncommitted changes are not included.

## Design rules

1. One job: catch likely missing companion changes.
2. No account, dashboard, hosted backend, or AI requirement in V1.
3. Explain every warning.
4. Prefer a missed warning over noisy nonsense.
5. Never modify the user's repository.

## Status

Early V1 build.
