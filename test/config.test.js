const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { parseConfig, loadConfig, matchesPath, RULE_IDS } = require('../src/config');
const { comparison } = require('../src/git');
const { evaluate } = require('../src/rules');

const empty = { disable: [], ignore: [], tests: [], migrations: [] };
test('restricted YAML parses the four lists, quotes, comments, CRLF and empty lists', () => {
  assert.deepEqual(parseConfig('\uFEFF# optional\r\ndisable:\r\n  - workflow-change # known\r\nignore:\r\n  - "vendor/**" # generated\r\n  - \'it\'\'s generated/**\'\r\ntests:\r\n  - spec/**\r\nmigrations: []\r\n'), {
    disable: ['workflow-change'], ignore: ['vendor/**', "it's generated/**"], tests: ['spec/**'], migrations: [],
  });
  assert.deepEqual(parseConfig(''), empty);
  assert.deepEqual(parseConfig('disable: []\nignore: []\ntests: []\nmigrations: []'), empty);
});

test('invalid config rejects unsupported structure, YAML features, types and unknown IDs', () => {
  for (const source of [
    'severity: []', 'disable:\n  - typo', 'disable: []\ndisable: []',
    'ignore: ["vendor/**"]', 'ignore: vendor', 'ignore:\n  - true',
    'ignore:\n  - 42', 'ignore:\n  - null', 'ignore:\n  - ""',
    'ignore:\n  - {path: vendor}', 'ignore:\n  - &anchor vendor',
    'ignore:\n  - *anchor', 'ignore:\n  - !!js/function >',
    'ignore:\n  - !include https://example.com/config', 'ignore:\n  - |',
    'ignore:\n  - "unterminated', 'ignore:\n\t- vendor',
    'ignore:\n  - "../vendor/**"', 'ignore:\n  - "/vendor/**"',
    'ignore:\n  - "[ab]/**"', 'ignore:\n  - "a\\\\b"',
    'ignore:\n  - "a\\n"', 'ignore: []\n  - vendor', '---',
  ]) assert.throws(() => parseConfig(source), /Invalid \.blindspot\.yml.*Use only/ , source);
  assert.throws(() => parseConfig('tests:\n  - true'), /line 2.*non-empty string/);
  assert.throws(() => parseConfig('disable:\n  - missing'), /valid IDs: env-undocumented/);
});

test('globs are anchored, case-sensitive and support recursive directories and literal punctuation', () => {
  for (const [path, pattern, expected] of [
    ['vendor/a.js', 'vendor/**', true], ['src/vendor/a.js', 'vendor/**', false],
    ['spec/a.js', 'spec/*', true], ['spec/deep/a.js', 'spec/*', false],
    ['spec/a.js', '**/spec/**', true], ['src/spec/a.js', '**/spec/**', true],
    ['a.test.js', '*.test.?s', true], ['aXtest.js', 'a.test.js', false],
    ['db/changes/001.sql', 'db/changes/', true], ['Spec/a.js', 'spec/**', false],
    ['a+b.js', 'a+b.js', true], ['aaab.js', 'a+b.js', false],
  ]) assert.equal(matchesPath(path, pattern), expected, `${path}: ${pattern}`);
});

test('disabling each stable ID preserves all other warnings and extra companions extend defaults', () => {
  const files = ['api/a.js', 'package.json', 'schema.prisma', '.github/workflows/ci.yml', 'index.d.ts', 'bin/tool', ...Array.from({length: 25}, (_, i) => `area${i}/a.js`)];
  const diff = '+const key = process.env.KEY;\ndiff --git a/bin/tool b/bin/tool\nnew file mode 100755\n--- /dev/null\n+++ b/bin/tool\n+#!/bin/sh\ndiff --git a/index.d.ts b/index.d.ts\n--- a/index.d.ts\n+++ b/index.d.ts\n+export type Value = string;';
  const baseline = evaluate(files, diff);
  assert.deepEqual(baseline.map(w => w.id), RULE_IDS);
  assert.deepEqual(evaluate(files, diff, empty), baseline);
  for (const id of RULE_IDS) assert.deepEqual(evaluate(files, diff, {disable: [id]}), baseline.filter(w => w.id !== id));
  const config = parseConfig('tests:\n  - "spec/**"\nmigrations:\n  - "db/changes/**"');
  assert.deepEqual(evaluate(['api/a.js', 'schema.prisma', 'spec/check.rb', 'db/changes/001.sql', 'index.d.ts'], diff, config), [baseline[0]]);
  assert.deepEqual(evaluate(['api/a.js', 'schema.prisma', 'tests/a.js', 'migrations/001.sql'], '', config), []);
});

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'blindspot-config-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  git('commit', '-q', '--allow-empty', '-m', 'base'); git('switch', '-q', '-c', 'feature');
  const cli = (directory = cwd, extra = {}) => spawnSync(process.execPath, [resolve(__dirname, '../src/index.js'), '--base', 'main'], {
    cwd: directory, encoding: 'utf8', env: {...process.env, INPUT_BASE_REF: '', 'INPUT_BASE-REF': '', INPUT_FAIL_ON_WARNING: '', 'INPUT_FAIL-ON-WARNING': '', GITHUB_STEP_SUMMARY: '', ...extra},
  });
  return {cwd, git, cli};
}

test('CLI reads config from root even from a subdirectory; errors exit 1 without writes', t => {
  const {cwd, git, cli} = fixture(t);
  mkdirSync(join(cwd, 'nested'));
  writeFileSync(join(cwd, 'package.json'), '{}'); git('add', '.'); git('commit', '-q', '-m', 'manifest');
  assert.deepEqual(loadConfig(cwd), empty);
  assert.equal(cli().status, 0); assert.match(cli().stdout, /manifest-without-lock/);
  writeFileSync(join(cwd, '.blindspot.yml'), 'disable:\n  - manifest-without-lock\n');
  const before = [git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all'), readFileSync(join(cwd, '.blindspot.yml'), 'utf8')];
  const result = cli(join(cwd, 'nested'), {'INPUT_FAIL-ON-WARNING': 'true'});
  assert.equal(result.status, 0); assert.match(result.stdout, /No companion-change/);
  assert.deepEqual([git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all'), readFileSync(join(cwd, '.blindspot.yml'), 'utf8')], before);
  writeFileSync(join(cwd, '.blindspot.yml'), 'disable:\n  - nonexistent');
  assert.equal(cli().status, 1); assert.match(cli().stderr, /Invalid \.blindspot\.yml at line 2.*unknown rule ID/);
  writeFileSync(join(cwd, '.blindspot.yml'), '#'.repeat(65537));
  assert.throws(() => loadConfig(cwd), /64 KiB/);
  rmSync(join(cwd, '.blindspot.yml')); symlinkSync('package.json', join(cwd, '.blindspot.yml'));
  assert.throws(() => loadConfig(cwd), /symbolic link/);
});

test('ignore removes both triggers and companion evidence, with literal unusual Git paths', t => {
  const {cwd, git, cli} = fixture(t);
  mkdirSync(join(cwd, 'generated')); mkdirSync(join(cwd, 'api'));
  writeFileSync(join(cwd, 'generated/env.js'), 'process.env.NEW_KEY;');
  writeFileSync(join(cwd, 'generated/README.md'), 'docs');
  writeFileSync(join(cwd, 'api/users.js'), 'code');
  writeFileSync(join(cwd, 'literal[1].js'), 'process.env.REAL_KEY;');
  git('add', '.'); git('commit', '-q', '-m', 'changes');
  const config = parseConfig('ignore:\n  - "generated/**"');
  const result = comparison('main', cwd, config);
  assert.deepEqual(result.files, ['api/users.js', 'literal[1].js']);
  assert.doesNotMatch(result.diff, /NEW_KEY|generated/);
  assert.deepEqual(evaluate(result.files, result.diff, config).map(w => w.id), ['env-undocumented', 'api-without-tests']);
  assert.deepEqual(comparison('main', cwd, {ignore: ['**']}), {files: [], diff: ''});
  assert.deepEqual(comparison('main', cwd, empty), comparison('main', cwd));
  writeFileSync(join(cwd, '.blindspot.yml'), 'ignore:\n  - "generated/**"');
  const output = mkdtempSync(join(tmpdir(), 'blindspot-config-summary-'));
  t.after(() => rmSync(output, {recursive: true, force: true}));
  const summary = join(output, 'summary.md');
  const checked = cli(cwd, {GITHUB_STEP_SUMMARY: summary});
  assert.equal(checked.status, 0);
  assert.match(checked.stdout, /Changed files: 2/);
  assert.match(readFileSync(summary, 'utf8'), /Changed files: 2/);
  assert.match(readFileSync(summary, 'utf8'), /env-undocumented[\s\S]*api-without-tests/);
  assert.equal(cli(cwd, {'INPUT_FAIL-ON-WARNING': 'true'}).status, 2);
});

test('renames across ignored boundaries do not leak ignored content', t => {
  const {cwd, git} = fixture(t);
  mkdirSync(join(cwd, 'generated'));
  writeFileSync(join(cwd, 'env.js'), 'process.env.KEY;\n'); git('add', '.'); git('commit', '-q', '-m', 'base source');
  git('branch', '-f', 'main', 'HEAD');
  git('mv', 'env.js', 'generated/env.js'); git('commit', '-q', '-m', 'move into ignored');
  let result = comparison('main', cwd, {ignore: ['generated/**']});
  assert.deepEqual(evaluate(result.files, result.diff), []);
  git('mv', 'generated/env.js', 'env.js'); git('commit', '-q', '-m', 'move out');
  git('branch', '-f', 'main', 'HEAD~1');
  result = comparison('main', cwd, {ignore: ['generated/**']});
  assert.deepEqual(evaluate(result.files, result.diff).map(w => w.id), ['env-undocumented']);
});
