const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { comparison } = require('../src/git');

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'blindspot-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  return { cwd, git };
}

test('empty diff is clean', t => {
  const { cwd } = fixture(t);
  assert.deepEqual(comparison('main', cwd), { files: [], diff: '' });
});

test('remote base ref, unusual filenames, and repository remain unchanged', t => {
  const { cwd, git } = fixture(t);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('switch', '-q', '-c', 'feature');
  git('branch', '-D', 'main');
  const name = 'line\nbreak.js';
  writeFileSync(join(cwd, name), 'const key = process.env.NEW_KEY;\n');
  git('add', '.'); git('commit', '-q', '-m', 'feature');
  writeFileSync(join(cwd, 'untracked'), 'preserve me');
  const before = [git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')];
  assert.deepEqual(comparison('main', cwd).files, [name]);
  assert.deepEqual(comparison('origin/main', cwd), comparison('refs/remotes/origin/main', cwd));
  assert.deepEqual([git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')], before);
});

test('missing refs and unrelated histories give actionable errors', t => {
  const { cwd, git } = fixture(t);
  assert.throws(() => comparison('missing', cwd), /not available locally.*fetch-depth: 0/);
  assert.throws(() => comparison('--help', cwd), /Invalid base ref/);
  git('switch', '-q', '--orphan', 'unrelated');
  git('commit', '-q', '--allow-empty', '-m', 'unrelated');
  assert.throws(() => comparison('main', cwd), /git merge-base failed.*share history/);
});

test('CLI uses Actions base and hyphenated action inputs; failures exit 1', t => {
  const { cwd, git } = fixture(t);
  git('branch', 'release');
  git('branch', '-m', 'feature');
  const cli = (extra = {}) => spawnSync(process.execPath, [resolve(__dirname, '../src/index.js')], {
    cwd, encoding: 'utf8', env: { ...process.env, INPUT_BASE_REF: '', INPUT_FAIL_ON_WARNING: '', 'INPUT_BASE-REF': '', 'INPUT_FAIL-ON-WARNING': '', GITHUB_BASE_REF: 'release', ...extra },
  });
  assert.equal(cli().status, 0);
  writeFileSync(join(cwd, 'package.json'), '{}');
  git('add', '.'); git('commit', '-q', '-m', 'manifest');
  const warning = cli({ 'INPUT_BASE-REF': 'release', 'INPUT_FAIL-ON-WARNING': 'true' });
  assert.equal(warning.status, 2);
  assert.match(warning.stdout, /manifest-without-lock/);
  const failure = cli({ 'INPUT_BASE-REF': 'missing' });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Blindspot failed:.*not available locally/);
});


test('new companion rules consume real Git patches and preserve repository state', t => {
  const { evaluate } = require('../src/rules');
  const { cwd, git } = fixture(t);
  git('switch', '-q', '-c', 'feature');
  mkdirSync(join(cwd, 'bin'));
  writeFileSync(join(cwd, 'bin/tool'), '#!/usr/bin/env node\nconsole.log("tool");\n');
  chmodSync(join(cwd, 'bin/tool'), 0o755);
  writeFileSync(join(cwd, 'index.d.ts'), 'export declare function run(): string;\n');
  git('add', '.'); git('commit', '-q', '-m', 'public entry points');
  const before = [git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')];
  const result = comparison('main', cwd);
  assert.deepEqual(evaluate(result.files, result.diff).map(w => w.id), [
    'cli-command-without-docs', 'public-types-without-tests-or-docs',
  ]);
  assert.deepEqual([git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')], before);
  writeFileSync(join(cwd, 'README.md'), 'CLI and public API documentation\n');
  git('add', '.'); git('commit', '-q', '-m', 'document entry points');
  const documented = comparison('main', cwd);
  assert.deepEqual(evaluate(documented.files, documented.diff), []);
});
