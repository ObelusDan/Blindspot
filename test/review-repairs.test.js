const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, resolve } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { evaluate } = require('../src/rules');
const { comparison } = require('../src/git');
const { isTestPath, quotedGitPath, patchSections } = require('../src/paths');
const { isVersionOnlyPackage } = require('../src/package-version');
const patch = (path, lines) => `diff --git ${quotedGitPath('a/' + path)} ${quotedGitPath('b/' + path)}\n--- ${quotedGitPath('a/' + path)}\n+++ ${quotedGitPath('b/' + path)}\n@@ -1 +1 @@\n${lines}\n`;
const ids = (files, diff, packages, config = {}) => evaluate(files, diff, config, packages).map(w => w.id);
const contents = (path, before, after) => new Map([[path, { before, after }]]);

test('P2: dependency named version and nested version fields keep the manifest warning', () => {
  for (const before of [
    '{"dependencies":{"version":"1.0.0"}}',
    '{"version":"0.1.0","dependencies":{"version":"1.0.0"}}',
    '{"version":"0.1.0","metadata":{"version":"1.0.0"}}',
  ]) {
    const after = before.replace('1.0.0', '2.0.0');
    assert.deepEqual(ids(['package.json'], patch('package.json', '-  "version": "1.0.0"\n+  "version": "2.0.0"'), contents('package.json', before, after)), ['manifest-without-lock']);
  }
  assert.deepEqual(ids(['package.json'], patch('package.json', '-"version":"1"\n+"version":"2"')), ['manifest-without-lock']);
  assert.equal(isVersionOnlyPackage({ before: '{"version":"1","dependencies":{}}', after: '{"version":"2","dependencies":{"version":"2"}}' }), false);
  assert.equal(isVersionOnlyPackage({ before: '{"version":"1","version":"x"}', after: '{"version":"2","version":"x"}' }), false);
});

test('top-level package version proof is structural and independent of indentation', () => {
  for (const before of [
    '{"name":"tool","version":"1.0.0","dependencies":{"version":"3"}}',
    '{\n"metadata":{"version":"nested"},\n"version":"1.0.0"\n}',
    '{"ver\\u0073ion":"1.0.0","description":"braces { and quotes \\""}',
  ]) {
    const after = before.replace('1.0.0', '2.0.0');
    assert.deepEqual(ids(['package.json'], patch('package.json', '-"version":"1.0.0"\n+"version":"2.0.0"'), contents('package.json', before, after)), []);
  }
  for (const value of [undefined, {}, {before: 'invalid', after: 'invalid'}, {before: '[]', after: '{}'}, {before: '{"version":1}', after: '{"version":2}'}]) assert.equal(isVersionOnlyPackage(value), false);
});

test('P2: schema test filenames and env exclusions share every existing test convention', () => {
  for (const path of ['test/model.js', 'tests/model.py', '__tests__/model.js', 'schema/model.test.ts', 'schema/model.spec.tsx', 'schema/model.test.cjs', 'schema/model.spec.mtsx', 'schema/user_test.go', 'schema/test_model.py', 'schema/prefix_test_model.py']) {
    assert.equal(isTestPath(path), true, path);
    assert.deepEqual(ids([path], patch(path, '+getenv("NEW_KEY");')), [], path);
  }
  const custom = { tests: ['schema/fixtures/**'] };
  assert.deepEqual(ids(['schema/fixtures/model.py'], patch('schema/fixtures/model.py', '+getenv("KEY");'), undefined, custom), []);
  assert.deepEqual(ids(['schema/model.py'], patch('schema/model.py', '+getenv("KEY");')), ['env-undocumented', 'schema-without-migration']);
});

test('P2: root Go test env reads are excluded without excluding application Go files', () => {
  assert.deepEqual(ids(['config_test.go'], patch('config_test.go', '+getenv("KEY");')), []);
  assert.deepEqual(ids(['config.go'], patch('config.go', '+getenv("KEY");')), ['env-undocumented']);
});

test('P2: quoted Git test paths are associated with decoded changed paths', () => {
  for (const path of ['tests/café.js', 'tests/space name.js', 'tests/tab\tname.js', 'tests/quote"name.js', 'tests/back\\slash.js', 'tests/line\nname.js', 'tests/bell\x07.js', 'tests/name b/part.js']) {
    const diff = patch(path, '+process.env.KEY;');
    assert.deepEqual(ids([path], diff), [], path);
    assert.equal(patchSections(diff, [path])[0].path, path);
  }
  assert.deepEqual(ids(['src/café.js'], patch('src/café.js', '+process.env.KEY;')), ['env-undocumented']);
  const malformed = patch('tests/a.js', '+process.env.KEY;').replace('+++ b/tests/a.js', '+++ "b/tests/bad\\q.js"');
  assert.deepEqual(ids(['tests/a.js'], malformed), ['env-undocumented']);
});

test('P2: quoted package paths suppress only proven top-level version-only changes', () => {
  for (const path of ['packages/café/package.json', 'packages/tab\tname/package.json', 'packages/quote"back\\slash/package.json', 'packages/name b/part/package.json']) {
    const diff = patch(path, '-"version":"1"\n+"version":"2"');
    assert.deepEqual(ids([path], diff, contents(path, '{"version":"1"}', '{"version":"2"}')), [], path);
    assert.deepEqual(ids([path], diff, contents(path, '{"dependencies":{"version":"1"}}', '{"dependencies":{"version":"2"}}')), ['manifest-without-lock']);
  }
});

test('path association rejects ambiguous markers, invalid UTF-8 and fabricated hunk markers', () => {
  const path = 'tests/café.js';
  const diff = patch(path, '+process.env.KEY;');
  for (const changed of [[], ['tests/other.js']]) assert.deepEqual(ids(changed, diff), ['env-undocumented']);
  const invalid = diff.replace(/^\+\+\+.*$/m, '+++ "b/tests/\\377.js"');
  assert.equal(patchSections(invalid, [path])[0].path, undefined);
  const duplicate = diff.replace('@@', '+++ b/tests/other.js\n@@');
  assert.equal(patchSections(duplicate, [path])[0].path, undefined);
  assert.equal(patchSections(patch('src/app.js', '+++ b/tests/a.js\n+process.env.KEY;'), ['src/app.js', 'tests/a.js'])[0].path, 'src/app.js');
  const conflicting = patch('src/app.js', '+process.env.KEY;').replace('+++ b/src/app.js', '+++ b/tests/a.js');
  assert.deepEqual(ids(['src/app.js', 'tests/a.js'], conflicting), ['env-undocumented']);
  const packagePath = 'packages/café/package.json';
  const unknown = patch('other/package.json', '-"version":"1"\n+"version":"2"');
  assert.deepEqual(ids([packagePath], unknown, contents(packagePath, '{"version":"1"}', '{"version":"2"}')), ['manifest-without-lock']);
});

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'blindspot-review-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (path, text) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), text); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  return { cwd, git, write };
}

test('real Git quoted paths and committed package proof preserve repository state', t => {
  const { cwd, git, write } = fixture(t);
  const paths = ['packages/café/package.json', 'packages/tab\tquote"back\\slash/package.json', 'packages/space name b/part/package.json'];
  for (const path of paths) write(path, '{"version":"1","dependencies":{"version":"3"}}\n');
  git('add', '.'); git('commit', '-q', '-m', 'base'); git('switch', '-q', '-c', 'feature');
  for (const path of paths) write(path, '{"version":"2","dependencies":{"version":"3"}}\n');
  write('tests/café.js', 'process.env.KEY;\n'); write('config_test.go', 'getenv("KEY");\n'); write('schema/user_test.go', 'getenv("KEY");\n');
  git('add', '.'); git('commit', '-q', '-m', 'feature');
  // Working-tree edits must not supply version proof or execute scripts.
  for (const path of paths) write(path, '{"dependencies":{"version":"999"}}');
  const before = [git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')];
  for (const quote of ['true', 'false']) {
    git('config', 'core.quotePath', quote);
    const result = comparison('main', cwd);
    assert.deepEqual(ids(result.files, result.diff, result.packages), []);
    const cli = spawnSync(process.execPath, [resolve(__dirname, '../src/index.js'), '--base', 'main'], {
      cwd, encoding: 'utf8', env: { ...process.env, 'INPUT_BASE-REF': '', INPUT_BASE_REF: '', 'INPUT_FAIL-ON-WARNING': '', INPUT_FAIL_ON_WARNING: '', GITHUB_STEP_SUMMARY: '' },
    });
    assert.equal(cli.status, 0); assert.match(cli.stdout, /No companion-change/);
  }
  git('config', 'core.quotePath', 'true');
  assert.deepEqual([git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')], before);
});
