const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { parseConfig, matchesPath, RULE_IDS } = require('../src/config');
const { comparison, resolveBase, loadBaseConfig } = require('../src/git');
const baseConfig = cwd => loadBaseConfig(resolveBase('main', cwd), cwd);
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

test('CLI reads committed base config from subdirectories; errors exit 1 without writes', t => {
  const {cwd, git, cli} = fixture(t);
  mkdirSync(join(cwd, 'nested'));
  assert.deepEqual(baseConfig(cwd), empty);
  writeFileSync(join(cwd, '.blindspot.yml'), 'disable:\n  - manifest-without-lock\n');
  git('add', '.'); git('commit', '-q', '-m', 'base config'); git('branch', '-f', 'main', 'HEAD');
  writeFileSync(join(cwd, 'package.json'), '{}'); git('add', '.'); git('commit', '-q', '-m', 'manifest');
  const before = [git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all'), readFileSync(join(cwd, '.blindspot.yml'), 'utf8')];
  const result = cli(join(cwd, 'nested'), {'INPUT_FAIL-ON-WARNING': 'true'});
  assert.equal(result.status, 0); assert.match(result.stdout, /No companion-change/);
  assert.deepEqual([git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all'), readFileSync(join(cwd, '.blindspot.yml'), 'utf8')], before);
  writeFileSync(join(cwd, '.blindspot.yml'), 'disable:\n  - nonexistent');
  git('add', '.'); git('commit', '-q', '-m', 'invalid base config'); git('branch', '-f', 'main', 'HEAD');
  assert.equal(cli().status, 1); assert.match(cli().stderr, /Base config.*Invalid \.blindspot\.yml at line 2.*unknown rule ID/);
  writeFileSync(join(cwd, '.blindspot.yml'), '#'.repeat(65537));
  git('add', '.'); git('commit', '-q', '-m', 'oversize base config'); git('branch', '-f', 'main', 'HEAD');
  assert.throws(() => baseConfig(cwd), /64 KiB/);
  rmSync(join(cwd, '.blindspot.yml')); symlinkSync('package.json', join(cwd, '.blindspot.yml'));
  git('add', '.'); git('commit', '-q', '-m', 'symlink base config'); git('branch', '-f', 'main', 'HEAD');
  assert.throws(() => baseConfig(cwd), /symbolic link/);
});

test('ignore removes both triggers and companion evidence, with literal unusual Git paths', t => {
  const {cwd, git, cli} = fixture(t);
  writeFileSync(join(cwd, '.blindspot.yml'), 'ignore:\n  - "generated/**"');
  git('add', '.'); git('commit', '-q', '-m', 'base ignores'); git('branch', '-f', 'main', 'HEAD');
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

for (const key of ['disable', 'ignore', 'tests', 'migrations']) {
  test(`duplicate ${key} values are rejected after string decoding`, () => {
    const value = key === 'disable' ? 'workflow-change' : 'spec/**';
    assert.throws(() => parseConfig(`${key}:\n  - ${value}\n  - "${value}" # duplicate`),
      error => error.message.includes('line 3') && error.message.includes(`duplicate value '${value}' in ${key}`) && error.message.includes('remove the repeated entry'));
    assert.throws(() => parseConfig(`${key}:\n  - '${value}'\n  - '${value}'`), /duplicate value/);
  });
}

for (const [key, value] of [['disable', 'manifest-without-lock'], ['ignore', 'package.json']]) {
  test(`same-PR ${key} config cannot suppress its own warning; later PRs use merged config`, t => {
    const {cwd, git, cli} = fixture(t);
    const configPath = join(cwd, '.blindspot.yml');
    writeFileSync(configPath, `${key}:\n  - ${value}\n`);
    writeFileSync(join(cwd, 'package.json'), '{}');
    git('add', '.'); git('commit', '-q', '-m', 'attempt config bypass');
    const before = [git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all'), readFileSync(configPath, 'utf8')];
    const result = cli(cwd, {'INPUT_FAIL-ON-WARNING': 'true'});
    assert.equal(result.status, 2);
    assert.match(result.stdout, /manifest-without-lock/);
    assert.deepEqual(baseConfig(cwd), empty);
    assert.deepEqual([git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all'), readFileSync(configPath, 'utf8')], before);
    git('branch', '-f', 'main', 'HEAD'); // Simulate the config PR being merged.
    writeFileSync(join(cwd, 'package.json'), '{"private":true}');
    git('add', '.'); git('commit', '-q', '-m', 'later manifest change');
    // Removing committed HEAD config and editing it locally must not undo base policy.
    git('rm', '-q', '.blindspot.yml'); git('commit', '-q', '-m', 'remove feature config');
    writeFileSync(configPath, 'disable:\n  - nonexistent');
    const later = cli(cwd, {'INPUT_FAIL-ON-WARNING': 'true'});
    assert.equal(later.status, 0);
    assert.match(later.stdout, /No companion-change/);
    assert.deepEqual(baseConfig(cwd)[key], [value]);
  });
}

test('invalid base config cannot be bypassed by repairing HEAD or the working tree', t => {
  const {cwd, git, cli} = fixture(t);
  writeFileSync(join(cwd, '.blindspot.yml'), 'disable:\n  - missing-rule');
  git('add', '.'); git('commit', '-q', '-m', 'invalid policy'); git('branch', '-f', 'main', 'HEAD');
  writeFileSync(join(cwd, '.blindspot.yml'), 'disable: []');
  git('add', '.'); git('commit', '-q', '-m', 'repair in feature');
  for (const content of ['', 'disable:\n  - manifest-without-lock']) {
    writeFileSync(join(cwd, '.blindspot.yml'), content);
    const before = [git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')];
    const result = cli();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Base config.*unknown rule ID 'missing-rule'/);
    assert.deepEqual([git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')], before);
  }
});

test('config comes from base tip even when merge base predates policy', t => {
  const {cwd, git, cli} = fixture(t);
  writeFileSync(join(cwd, 'package.json'), '{}'); git('add', '.'); git('commit', '-q', '-m', 'feature manifest');
  git('switch', '-q', 'main');
  writeFileSync(join(cwd, '.blindspot.yml'), 'disable:\n  - manifest-without-lock');
  git('add', '.'); git('commit', '-q', '-m', 'base policy');
  git('switch', '-q', 'feature');
  assert.notEqual(git('merge-base', 'main', 'HEAD'), git('rev-parse', 'main'));
  const result = cli(cwd, {'INPUT_FAIL-ON-WARNING': 'true'});
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No companion-change/);
});

for (const inverse of [false, true]) {
  test(`exact patch evidence survives ${inverse ? 'directory-to-file' : 'file-to-directory'} transitions`, t => {
    const {cwd, git, cli} = fixture(t);
    writeFileSync(join(cwd, '.blindspot.yml'), 'ignore:\n  - "pkg/**"\n');
    if (inverse) {
      mkdirSync(join(cwd, 'pkg'));
      writeFileSync(join(cwd, 'pkg/ignored.js'), 'process.env.IGNORED_KEY;\n');
    } else writeFileSync(join(cwd, 'pkg'), 'old file\n');
    git('add', '.'); git('commit', '-q', '-m', 'transition base'); git('branch', '-f', 'main', 'HEAD');
    rmSync(join(cwd, 'pkg'), {recursive: true});
    if (inverse) writeFileSync(join(cwd, 'pkg'), 'process.env.RETAINED_KEY;\n');
    else {
      mkdirSync(join(cwd, 'pkg'));
      writeFileSync(join(cwd, 'pkg/ignored.js'), 'process.env.IGNORED_KEY;\n');
    }
    git('add', '.'); git('commit', '-q', '-m', 'transition feature');
    const before = [git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')];
    const config = baseConfig(cwd);
    const result = comparison('main', cwd, config);
    assert.deepEqual(result.files, ['pkg']);
    assert.doesNotMatch(result.diff, /pkg\/ignored\.js|IGNORED_KEY/);
    assert.deepEqual(evaluate(result.files, result.diff, config).map(w => w.id), inverse ? ['env-undocumented'] : []);
    const checked = cli(cwd, {'INPUT_FAIL-ON-WARNING': 'true'});
    assert.equal(checked.status, inverse ? 2 : 0);
    assert.deepEqual([git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')], before);
  });
}

test('exact filtering handles Git-quoted and unusual additions, deletions and ancestor transitions', t => {
  const {cwd, git} = fixture(t);
  const names = ['space name', 'name b/part', 'tab\tname', 'line\nname', 'quote"name', 'back\\slash', 'café', 'bell\x07', 'vertical\x0b', 'form\x0c', 'carriage\r', 'delete\x7f', 'literal[1]', ':(glob)*'];
  const write = (name, text) => {
    const path = join(cwd, name);
    mkdirSync(require('node:path').dirname(path), {recursive: true});
    writeFileSync(path, text);
  };
  write('.blindspot.yml', 'ignore:\n  - "**/ignored.js"\n');
  for (const name of names) {
    write(`blocked/${name}`, 'old ancestor\n');
    write(`gone/${name}`, 'deleted retained file\n');
  }
  git('add', '.'); git('commit', '-q', '-m', 'unusual base'); git('branch', '-f', 'main', 'HEAD');
  for (const name of names) {
    rmSync(join(cwd, `blocked/${name}`));
    write(`blocked/${name}/ignored.js`, 'process.env.IGNORED_KEY;\n');
    rmSync(join(cwd, `gone/${name}`));
    write(`keep/${name}`, 'process.env.RETAINED_KEY;\n');
  }
  git('add', '.'); git('commit', '-q', '-m', 'unusual feature');
  git('config', 'core.quotePath', 'false'); // Filtering fixes the output spelling itself.
  const result = comparison('main', cwd, baseConfig(cwd));
  const expected = names.flatMap(name => [`blocked/${name}`, `gone/${name}`, `keep/${name}`]);
  assert.deepEqual([...result.files].sort(), expected.sort());
  assert.doesNotMatch(result.diff, /ignored\.js|IGNORED_KEY/);
  assert.equal((result.diff.match(/^diff --git /gm) || []).length, names.length * 3);
  assert.equal((result.diff.match(/\+process\.env\.RETAINED_KEY/g) || []).length, names.length);
  assert.deepEqual(evaluate(result.files, result.diff, baseConfig(cwd)).map(w => w.id), ['env-undocumented']);
});

test('unassociated or ambiguous patch sections are excluded conservatively', () => {
  const { filterPatches } = require('../src/git');
  const kept = 'diff --git a/keep.js b/keep.js\n--- a/keep.js\n+++ b/keep.js\n+process.env.RETAINED;\n';
  const rejected = [
    'unassociated preamble\n+process.env.IGNORED;\n',
    'diff --git a/keep.js b/ignored.js\n+process.env.IGNORED;\n',
    'diff --git a/keep.js/ignored.js b/keep.js/ignored.js\n+process.env.IGNORED;\n',
    'diff --git "a/keep.js" "b/keep.js"\n+process.env.IGNORED;\n',
    'diff --git "a/bad\\q" "b/bad\\q"\n+process.env.IGNORED;\n',
  ].join('');
  assert.equal(filterPatches(rejected + kept, ['keep.js']), kept);
  assert.equal(filterPatches(rejected + kept, []), '');
});
