const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { evaluate } = require('../src/rules');
const { renderSummary } = require('../src/summary');

test('clean summary contains heading, changed-file count and success state', () => {
  assert.equal(renderSummary([], ['a.js', 'b.js']), '# Blindspot\n\nChanged files: 2\n\n✅ No companion-change warnings found.\n');
});

test('multiple warnings preserve exact rule IDs, messages, order and frozen inputs', () => {
  const files = Object.freeze(['src/api/users.js', 'package.json']);
  const diff = '+const key = process.env.NEW_KEY;';
  const warnings = Object.freeze(evaluate(files, diff).map(Object.freeze));
  const before = JSON.stringify({ files, diff, warnings });
  const summary = renderSummary(warnings, files);
  assert.equal(summary, '# Blindspot\n\nChanged files: 2\n\n## 3 potential blind spots found\n\n' + warnings.map(w => `- \`${w.id}\`\n  ${w.message}\n`).join('\n') + '\n');
  assert.equal(JSON.stringify({ files, diff, warnings }), before);
  assert.deepEqual(evaluate(files, diff), warnings);
});

test('single warning uses singular wording', () => {
  assert.match(renderSummary(evaluate(['package.json'], ''), ['package.json']), /## 1 potential blind spot found/);
});

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'blindspot-summary-repo-'));
  const output = mkdtempSync(join(tmpdir(), 'blindspot-summary-output-'));
  t.after(() => { rmSync(cwd, { recursive: true, force: true }); rmSync(output, { recursive: true, force: true }); });
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  const cli = (extra = {}) => spawnSync(process.execPath, [resolve(__dirname, '../src/index.js'), '--base', 'main'], {
    cwd, encoding: 'utf8', env: { ...process.env, INPUT_BASE_REF: '', 'INPUT_BASE-REF': '', INPUT_FAIL_ON_WARNING: '', 'INPUT_FAIL-ON-WARNING': '', GITHUB_STEP_SUMMARY: '', GITHUB_ACTIONS: '', ...extra },
  });
  return { cwd, output, git, cli };
}

test('local and Actions CLI preserve console output, append summary and leave repository unchanged', t => {
  const { cwd, output, git, cli } = fixture(t);
  const path = join(output, 'summary.md');
  const clean = cli({ GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: path });
  assert.equal(clean.status, 0);
  assert.equal(readFileSync(path, 'utf8'), renderSummary([], []));
  git('switch', '-q', '-c', 'feature');
  writeFileSync(join(cwd, 'package.json'), '{}');
  git('add', '.'); git('commit', '-q', '-m', 'manifest');
  const before = [git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')];
  const local = cli();
  assert.equal(local.status, 0);
  assert.equal(local.stderr, '');
  assert.equal(local.stdout, 'Blindspot\n=========\nChanged files: 1\n\n⚠ 1 warning(s):\n- [manifest-without-lock] A dependency manifest changed, but no recognised lockfile changed.\n');
  writeFileSync(path, 'Existing summary\n\n');
  const actions = cli({ GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: path });
  assert.equal(actions.status, 0);
  assert.equal(actions.stderr, '');
  assert.equal(actions.stdout, local.stdout);
  assert.equal(readFileSync(path, 'utf8'), 'Existing summary\n\n' + renderSummary(evaluate(['package.json'], ''), ['package.json']));
  assert.deepEqual([git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')], before);
});

test('summary write failure reports stderr and preserves clean, warning and opt-in failure exit codes', t => {
  const { cwd, output, git, cli } = fixture(t);
  const env = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: output };
  const clean = cli(env);
  assert.equal(clean.status, 0);
  assert.match(clean.stderr, /Blindspot warning: could not write GitHub Actions job summary:/);
  assert.match(clean.stdout, /No companion-change warnings found/);
  git('switch', '-q', '-c', 'feature');
  writeFileSync(join(cwd, 'package.json'), '{}');
  git('add', '.'); git('commit', '-q', '-m', 'manifest');
  for (const [fail, code] of [['false', 0], ['true', 2]]) {
    const result = cli({ ...env, 'INPUT_FAIL-ON-WARNING': fail });
    assert.equal(result.status, code);
    assert.match(result.stderr, /Blindspot warning: could not write GitHub Actions job summary:/);
    assert.match(result.stdout, /manifest-without-lock/);
  }
});
