const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/rules');
const patch = (path, lines) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${lines}\n`;
const ids = (files, diff, packages) => evaluate(files, diff, {}, packages).map(w => w.id);

test('Click #3776 and #3777: moving existing TERM and LESS reads needs no new env docs', () => {
  for (const [before, after] of [
    ['os.environ.get("TERM")', '    os.environ.get("TERM")'],
    ["os.environ.get('LESS', '')", 'os.environ.get("LESS", "")'],
  ]) assert.deepEqual(ids(['src/click/_termui_impl.py'], patch('src/click/_termui_impl.py', `-${before}\n+${after}`)), []);
  assert.deepEqual(ids(['src/config.py'], patch('src/config.py', '-os.environ.get("OLD")\n+os.environ.get("NEW")')), ['env-undocumented']);
});

test('Click #3767 and pnpm #16634: test-only env reads are not application configuration', () => {
  for (const path of ['tests/test_termui.py', 'pnpm/crates/cli/tests/suite/exec.rs']) {
    assert.deepEqual(ids([path], patch(path, '+process.env.BREAKAWAY_RELEASE;')), []);
  }
  const app = patch('src/config.js', '+process.env.REAL_KEY;');
  assert.deepEqual(ids(['tests/check.js', 'src/config.js'], patch('tests/check.js', '-process.env.REAL_KEY;') + app), ['env-undocumented']);
});

test('Express #7464: Actions output plumbing belongs to workflow review, not env examples', () => {
  const path = '.github/workflows/npm-publish.yml';
  assert.deepEqual(ids([path], patch(path, '+fs.appendFileSync(process.env.GITHUB_OUTPUT, output);')), ['workflow-change']);
});

test('got 16.0.0: version-only releases do not change dependency resolution', () => {
  assert.deepEqual(ids(['package.json'], patch('package.json', '-  "version": "15.1.0",\n+  "version": "16.0.0",'), new Map([['package.json', {before: '{"version":"15.1.0"}', after: '{"version":"16.0.0"}'}]])), []);
  assert.deepEqual(ids(['package.json'], patch('package.json', '-  "got": "15.1.0",\n+  "got": "16.0.0",')), ['manifest-without-lock']);
});

test('pnpm #16637: package metadata under an api directory is not API code', () => {
  assert.deepEqual(ids(['packages/cache/api/package.json'], patch('packages/cache/api/package.json', '-"version": "1"\n+"version": "2"'), new Map([['packages/cache/api/package.json', {before: '{"version":"1"}', after: '{"version":"2"}'}]])), []);
  assert.deepEqual(ids(['packages/cache/api/src/index.ts'], ''), ['api-without-tests']);
});

// Prisma #30405 adds compiler-input fixtures, not a deployed application schema.
test('Prisma #30405: schema fixtures do not require deployment migrations', () => {
  const path = 'packages/contract-prisma6/test/fixtures/enums/schema.prisma';
  assert.deepEqual(ids([path], patch(path, '+model Post { id Int @id }')), []);
  assert.deepEqual(ids(['prisma/schema.prisma'], ''), ['schema-without-migration']);
});
