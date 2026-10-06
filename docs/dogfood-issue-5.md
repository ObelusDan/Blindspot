# Issue #5: real-repository dogfooding

**BLOCK — default rule set is still too noisy or incomplete**

The baseline is main at `36eca8657e2c4bebd8d6e167f63d46c4e8462ba7`, after PR #10.
Small fixes remove nine false warnings, but the resulting defaults still produce
12 false positives in 32 warnings. Do not begin #6. Keep #5 open until the
remaining manifest/scope decisions are implemented, independently reviewed and
replayed. Green tests are not a release-readiness verdict.

## Evaluation set and method

Ten mature public projects were selected for coverage before warnings were
examined. The latest twelve first-parent changes at acquisition form the fixed
primary sample (120 changes). Merge commits are compared to their first parent,
so these are PR-shaped changes where the repository uses merge/squash merges,
otherwise individual committed changes. No warning-bearing change was dropped.
Bare clones were acquired explicitly by the researcher; external projects were
never checked out, built, modified, forked, pushed to, or sent PRs.

| Repository | Coverage | Primary newest / oldest examined commit |
| --- | --- | --- |
| [expressjs/express](https://github.com/expressjs/express) | Node backend/API library | [7ef98448f8b3](https://github.com/expressjs/express/commit/7ef98448f8b38099ab1ded55e458538ad47a51e7) / [2574a53bbc52](https://github.com/expressjs/express/commit/2574a53bbc52cbb3c2a68c080a931d8624fdb5c7) |
| [fastapi/fastapi](https://github.com/fastapi/fastapi) | Python API; docs-heavy negative controls | [52159d7e7018](https://github.com/fastapi/fastapi/commit/52159d7e7018df55b57a0b8fdd6c1193e48b2b57) / [c03a41642741](https://github.com/fastapi/fastapi/commit/c03a416427418c2e891aa62c28a4045d2fd29e14) |
| [django/django](https://github.com/django/django) | Python backend/ORM | [08e4c0d8e7db](https://github.com/django/django/commit/08e4c0d8e7db6343567e7b02e25da8ea2226a7e0) / [23e8bcc464e5](https://github.com/django/django/commit/23e8bcc464e5faefec28bf36a2f4610a5e7f4be5) |
| [prisma/prisma](https://github.com/prisma/prisma) | TypeScript database tooling, migration examples and compiler fixtures | [57675308d616](https://github.com/prisma/prisma/commit/57675308d616509ff7c8f72eb032ec30e1584108) / [c45a0741fc4f](https://github.com/prisma/prisma/commit/c45a0741fc4fb889b63278cf49fe235aa7ad126f) |
| [pallets/click](https://github.com/pallets/click) | Python CLI library | [2247b35ea1c4](https://github.com/pallets/click/commit/2247b35ea1c47c727d7a06e51fa280e12a863ff6) / [cbd7a4109da1](https://github.com/pallets/click/commit/cbd7a4109da16ce58f54c2a618b4c986e3041fcf) |
| [sindresorhus/got](https://github.com/sindresorhus/got) | TypeScript HTTP package | [e1d87d2ced01](https://github.com/sindresorhus/got/commit/e1d87d2ced01d5b7d855a7dc8b091bf7b014a1e4) / [c1cf0f85bed4](https://github.com/sindresorhus/got/commit/c1cf0f85bed4a76c4088c95868049aa85080252e) |
| [actions/checkout](https://github.com/actions/checkout) | Actions-heavy project and generated distribution | [f548e57e544e](https://github.com/actions/checkout/commit/f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a) / [5de26ee9b11f](https://github.com/actions/checkout/commit/5de26ee9b11f6ffa02406edecc0e750256af18b1) |
| [pnpm/pnpm](https://github.com/pnpm/pnpm) | Large TypeScript/Rust monorepo | [25158289833f](https://github.com/pnpm/pnpm/commit/25158289833f36444d60114e829778372b271562) / [fb1fd4353585](https://github.com/pnpm/pnpm/commit/fb1fd4353585644cbf261aeca8ebe577e9d4c9dc) |
| [jqlang/jq](https://github.com/jqlang/jq) | C/Autotools and jq scripts; unconventional layout | [f13c1effbf73](https://github.com/jqlang/jq/commit/f13c1effbf7322e42afcc999d7e3d1509d3f38c9) / [6aeafff056a9](https://github.com/jqlang/jq/commit/6aeafff056a988c20672ac1359b2beea13fb9315) |
| [sqlalchemy/alembic](https://github.com/sqlalchemy/alembic) | Python migration tooling | [1bc21b86dd6d](https://github.com/sqlalchemy/alembic/commit/1bc21b86dd6ddd07ac696e2d73b6cb200dd97bbd) / [252bf0ae69db](https://github.com/sqlalchemy/alembic/commit/252bf0ae69db0e7e1ef1ed20e9b1203a07c18292) |

Fifteen targeted changes supplement (and are reported separately from) the fixed
sample. They were the newest two changes for each of these paths: Django
`django/core/handlers/base.py`, Click `pyproject.toml`, got `package.json`, npm
`bin`, Chalk root `index.d.ts`, Prisma adoption-example schema and Mongo schema
fixture. The latter two queries returned one commit each. Three explicitly
selected older changes cover Chalk type evolution and the original npx import.
They are coverage probes, not an unbiased precision estimate.

- [django/django 4a52533329a0](https://github.com/django/django/commit/4a52533329a03207c1c4592a13fbb12b9ec5ef9e): Refs #34118 -- Removed asgiref coroutine detection shims..
- [django/django 69a93a88edb5](https://github.com/django/django/commit/69a93a88edb56ba47f624dac7a21aacc47ea474f): Refs #36500 -- Rewrapped long docstrings and block comments via a script..
- [pallets/click a59f7c624fb7](https://github.com/pallets/click/commit/a59f7c624fb7272e37d97921047dab8bf3ff0675): Start 8.6.0..
- [pallets/click dda8db496c69](https://github.com/pallets/click/commit/dda8db496c69db15d5146d68360f140c2515d6d0): Start 8.5.1..
- [sindresorhus/got 64f21e2a4797](https://github.com/sindresorhus/got/commit/64f21e2a4797b8c56493143e416508893983063f): 16.0.0.
- [sindresorhus/got c6bbb8ada1ee](https://github.com/sindresorhus/got/commit/c6bbb8ada1eeb82dc612ba4a0a9a0851f78b880c): Various tweaks.
- [npm/cli dd4cee9026c8](https://github.com/npm/cli/commit/dd4cee9026c8e2dd5e4c28fd45ac8bceae74fb89): fix(powershell): improve argument parsing (#8539).
- [npm/cli 5f1855778b5e](https://github.com/npm/cli/commit/5f1855778b5e376c5f1389e0ee5f204dc86c4d32): fix(powershell): fix issue with modified InvocationName (#8532).
- [chalk/chalk 625a2857722f](https://github.com/chalk/chalk/commit/625a2857722fb86cfe98f22c9c12888238e36f51): Add `types` field to package.json.
- [chalk/chalk f8a3642a8107](https://github.com/chalk/chalk/commit/f8a3642a8107f6029c6923b72a43c35a1065a336): Minor tweaks (#437).
- [prisma/prisma 3cd6c618aead](https://github.com/prisma/prisma/commit/3cd6c618aead86ba4d63b196e97bff011edba1fd): feat(sql): Prisma 7 users point Prisma 8 at their existing schema.prisma instead of running contract infer and hand-fixing it (#30287).
- [prisma/prisma 80ed61cb9770](https://github.com/prisma/prisma/commit/80ed61cb97702941d57fd94a6c49d2a1babc8484): feat(mongo): prisma6Schema reads a Prisma 6 MongoDB schema.prisma as the contract source (#30405).
- [chalk/chalk f0f4638a9289](https://github.com/chalk/chalk/commit/f0f4638a92890ba3a329209836d5f904cfeb581a): Change the TypeScript `Level` type to be a union instead of enum.
- [chalk/chalk 6b4d20683f74](https://github.com/chalk/chalk/commit/6b4d20683f7490195e51f80829f3d465b9835de1): Export TypeScript types for colors and modifiers (#357).
- [npm/cli fb040bee0710](https://github.com/npm/cli/commit/fb040bee0710759c60e45bf8fa2a3b8ddcf4212a): npx: bundle npx with npm itself.

The [complete ledger](dogfood-issue-5-results.json) lists all 135 immutable
head/base pairs, changed paths, patch SHA-256, every baseline and final warning,
classification, evidence, explanation, config remedy and default-heuristic fault.
Evaluation used zero config; it did not silently tune settings per project.
Git supplied complete diffs and NUL-separated names, with external diff/textconv
disabled. GitHub's 300-file commit API cap was encountered during discovery;
those records were replaced with local Git object comparisons before counting.

Classification is a researcher's judgement from committed evidence, not a
maintainer-confirmed defect census. No actual omission was proven: **zero true
positives**. Workflow and broad substantive Prisma changes count as
`useful_but_imperfect` review prompts, not proof that somebody omitted a review.
This is a generous usefulness assessment; scoring routine workflow reminders
more harshly would lower the rate further. No clear in-scope missing companion
was established in the examined changes: **zero observed obvious misses**.
That is not a recall measurement or a claim that no bugs were missed.

## Results

| Sample / implementation | Changes | Warnings | True positive | Useful but imperfect | False positive | Obvious misses | Useful-warning rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Primary, baseline | 120 | 31 | 0 | 17 | 14 | 0 | 54.8% |
| Targeted, baseline | 15 | 10 | 0 | 3 | 7 | 0 | 30.0% |
| All, baseline | 135 | 41 | 0 | 20 | 21 | 0 | 48.8% |
| Primary, after fixes | 120 | 24 | 0 | 17 | 7 | 0 | 70.8% |
| Targeted, after fixes | 15 | 8 | 0 | 3 | 5 | 0 | 37.5% |
| All, after fixes | 135 | 32 | 0 | 20 | 12 | 0 | **62.5%** |

Useful-warning rate is `(true_positive + useful_but_imperfect) / warnings`.
The targeted sample overrepresents edge cases; the primary sample independently
fails the working 80–90% target. Lockless libraries receive repeated, categorical
false alarms. That alone blocks readiness, regardless of the percentage.

## Baseline and rule-by-rule verdict

The baseline had 57 tests, all passing locally, and green main CI run
[37426901198](https://github.com/ObelusDan/Blindspot/actions/runs/37426901198)
on Node 20. Action runtime is `node20`; package engine is `>=20`; runtime has
no dependencies. Config supports only `disable`, `ignore`, `tests`, `migrations`.
Companions are repository-wide changed paths; tests/migrations extend built-ins.
Config comes from the resolved base tip, not HEAD or the merge base, and must be
a regular blob <=64 KiB in the documented restricted YAML subset.

Counts below are **baseline → after fixes**. TP and observed misses are zero for
every rule; useful/false counts use the same frozen sample.

| Stable rule ID | Triggered | Useful but imperfect | False positive | Verdict |
| --- | ---: | ---: | ---: | --- |
| `env-undocumented` | 5 → 0 | 0 → 0 | 5 → 0 | TIGHTEN (observed cases fixed) |
| `manifest-without-lock` | 11 → 9 | 0 → 0 | 11 → 9 | TIGHTEN (partial; blocking) |
| `api-without-tests` | 1 → 0 | 0 → 0 | 1 → 0 | TIGHTEN (metadata case fixed) |
| `schema-without-migration` | 1 → 0 | 0 → 0 | 1 → 0 | TIGHTEN (test-fixture case fixed) |
| `workflow-change` | 15 → 15 | 15 → 15 | 0 → 0 | KEEP_WITH_DOCUMENTED_LIMITATION |
| `scope-review` | 8 → 8 | 5 → 5 | 3 → 3 | TIGHTEN (blocking decision remains) |
| `cli-command-without-docs` | 0 → 0 | 0 → 0 | 0 → 0 | KEEP_WITH_DOCUMENTED_LIMITATION |
| `public-types-without-tests-or-docs` | 0 → 0 | 0 → 0 | 0 → 0 | KEEP_WITH_DOCUMENTED_LIMITATION |

Baseline semantics and assumptions:

- **Env:** any added line containing one of the supported JS/Python/Ruby/C env
  syntaxes, without changed `.env`/example/sample/template or README/docs. It
  confused existing-key refactors, CI plumbing and test fixtures with app config.
- **Manifest:** any package/pyproject/requirements/go/Cargo/Gem manifest path,
  without any recognised lock change. It assumed every project commits a lock
  and every manifest edit changes dependencies. Neither is true.
- **API:** any api/apis/route/controller/handler/endpoint path component, without
  recognised tests. pnpm metadata under `cache/api` was incorrectly called code.
- **Schema:** any schema/schemas component or schema.prisma/sql suffix, without
  recognised migration/alembic/db/migrate paths. Prisma test input schemas are
  not deployable database schemas. Generic JSON schemas remain an unmeasured risk.
- **Workflow:** any `.github/workflows/` change; unconditional security reminder.
  Useful for changed executable actions, commands and triggers, but it cannot
  establish whether review happened. Config disable is reasonable for teams
  with an existing mandatory workflow review.
- **Scope:** >=25 files across >=4 non-dot top-level names, including root
  filenames as areas. Substantive Prisma changes merit review; stable-branch
  integration, vendored imports and mechanical formatting do not establish
  accidental scope. `disable` can help but does not make the default sound.
- **CLI:** new executable `100755` direct child of root `bin/` with a shebang and
  no README/docs change. Existing npm PowerShell entrypoint edits do not qualify;
  the npx import includes docs/companions. No unsuppressed positive was obtained.
- **Types:** changed exported declaration lines in root `index.d.ts`, with no
  tests/docs. Chalk probes use namespace declarations, tests, comments, or move
  the entrypoint to `source/`; no unsuppressed positive was obtained. The narrow
  rule deliberately misses body-only, namespace, re-export and nested entrypoint
  edits. Zero triggers is insufficient evidence to certify its precision.

## Findings and changes made

Small repairs preserve all eight IDs, ordering and config controls:

1. Click [#3776](https://github.com/pallets/click/pull/3776) and
   [#3777](https://github.com/pallets/click/pull/3777): compare added/removed literal
   env keys within a file. Moving TERM or rewriting LESS's quotes no longer warns.
2. Click [#3767](https://github.com/pallets/click/pull/3767), pnpm
   [#16634](https://github.com/pnpm/pnpm/pull/16634), Express
   [#7464](https://github.com/expressjs/express/pull/7464): exclude recognised test
   paths and Actions workflow patches from app env detection. Workflow review
   still fires for publishing changes.
3. got [16.0.0](https://github.com/sindresorhus/got/commit/64f21e2a4797b8c56493143e416508893983063f)
   and pnpm [#16637](https://github.com/pnpm/pnpm/pull/16637): skip package patches
   whose every changed content line is a version field. Dependency changes
   still warn. This repairs only two warnings; it does not solve lock policy.
4. pnpm #16637: require a source-file extension for API triggers, preventing
   `package.json` in an API directory from being called API code.
5. Prisma [#30405](https://github.com/prisma/prisma/pull/30405): exclude recognised
   test paths from schema triggers; compiler input fixtures need no migration.

Six focused regression tests cover these failures and retain real triggers.
No rule was added. No dependency, fetching, commands from external projects,
account requirement, write behavior, action metadata or config parser was added.

Remaining blockers are deliberately explicit rather than disguised by disabling
rules in the sample:

- Express's `.gitignore` explicitly ignores recognised Node lockfiles; got/Chalk
  base trees also have no tracked root lock and ignore yarn.lock. The default
  lock warning invents a policy on eight real library changes. Disabling it is
  reasonable configuration, but a zero-config default should not require every
  lockless library to opt out.
- Prisma [#30563](https://github.com/prisma/prisma/pull/30563) edits only export-map
  test entrypoints in manifests. No dependency resolution changes. Version-only
  suppression cannot solve export/script/metadata changes generally.
- Click [stable integration](https://github.com/pallets/click/commit/6aabf099bfdd4c1e75fe8d0e0d4241372b988ab1),
  Django [mechanical wrapping](https://github.com/django/django/commit/69a93a88edb56ba47f624dac7a21aacc47ea474f),
  npm [npx import](https://github.com/npm/cli/commit/fb040bee0710759c60e45bf8fa2a3b8ddcf4212a): scope warnings
  add noise to coherent changes. Tighten with defensible evidence or remove the
  unconditional default; do not invent a title-based semantic classifier here.

These require a further evidence-backed #5 decision before release preparation.
The remaining lock heuristic needs repository lock-policy/dependency evidence or
removal from defaults; this PR does not introduce a manifest-analysis framework
or disable a stable rule wholesale without reviewing the loss of useful cases.

## Validation, reproduction and remaining risks

- Baseline `npm test`: 57/57. After repairs: 63/63 on Node 20.20.2 and Node 26.10.0.
- `git diff --check`: clean. Current Actions workflow runs `npm test` on Node 20;
  publication-time PR/main check status should be checked separately.
- [Replay script](../scripts/replay-dogfood.cjs) reproduces the final 135 changes
  and 32 warnings from already-acquired Git objects and checks refs unchanged:
  `node scripts/replay-dogfood.cjs /absolute/path/to/bare-cache`.
  Cache folders must be named `owner__repo`. Acquire the ledger's immutable
  heads/parents explicitly yourself; the script never fetches or checks out.
- Production Git operations remain read-only object/diff commands with
  `GIT_OPTIONAL_LOCKS=0`, `--no-ext-diff`, `--no-textconv`; no repository commands
  are executed. Only the existing opt-in Actions summary writes to its supplied
  output path. Tests verify refs, reflogs and working-tree state are preserved.
- Warnings still exit 0 by default; opt-in fail-on-warning remains exit 2.
  Missing refs/config errors exit 1; no automatic fetching or hosted account.
- Existing config tests still verify base-only policy, invalid syntax/IDs,
  duplicate values, symlink/directory/size limits, ignore isolation and refusal
  of tags/anchors/includes/commands. The parser and Git loader are unchanged.

Sample limitations: recent FastAPI history was entirely documentation; Alembic
is a migration engine, not a deployed app schema; the narrow CLI/types rules
have no positive precision evidence. Historical merged changes cannot establish
all intended companion work or externally maintained docs. Repository-wide
companions can suppress unrelated omissions. Env literal matching deliberately
misses dynamic keys, multiline calls and existing-key semantic changes; API
extension recognition remains language-limited. These conservative misses do
not justify new rules. Preserve them as limitations, not a recall guarantee.

**Recommendation:** merge/review these #5 fixes only if accepted, then resolve
and re-evaluate the manifest/scope blockers under #5. Do not close #5 as passed,
start #6, merge automatically, or create a `v1` tag/release from this result.
