const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate } = require("../src/index");

test("warns when API code changes without tests", () => {
  const warnings = evaluate(["src/api/users.js"], "");
  assert.ok(warnings.some((warning) => warning.id === "api-without-tests"));
});

test("does not warn when API and tests change together", () => {
  const warnings = evaluate(["src/api/users.js", "test/users.test.js"], "");
  assert.ok(!warnings.some((warning) => warning.id === "api-without-tests"));
});

test("warns on added environment variable without docs", () => {
  const warnings = evaluate(
    ["src/config.js"],
    "+const key = process.env.NEW_KEY;"
  );
  assert.ok(warnings.some((warning) => warning.id === "env-undocumented"));
});

test("warns on package manifest without lockfile", () => {
  const warnings = evaluate(["package.json"], "");
  assert.ok(warnings.some((warning) => warning.id === "manifest-without-lock"));
});

test("warns on schema without migration", () => {
  const warnings = evaluate(["prisma/schema.prisma"], "");
  assert.ok(
    warnings.some((warning) => warning.id === "schema-without-migration")
  );
});

test('empty diff has no warnings', () => {
  assert.deepEqual(evaluate([], ''), []);
});

test('all warnings have stable ordering and readable messages without mutating inputs', () => {
  const files = Object.freeze(['src/api/users.js', 'package.json', 'prisma/schema.prisma', '.github/workflows/ci.yml', ...Array.from({ length: 25 }, (_, i) => `area${i % 4}/file${i}.js`)]);
  const diff = '+const key = process.env.NEW_KEY;';
  const warnings = evaluate(files, diff);
  assert.deepEqual(warnings.map(w => w.id), ['env-undocumented', 'manifest-without-lock', 'api-without-tests', 'schema-without-migration', 'workflow-change', 'scope-review']);
  assert.ok(warnings.every(w => w.message.length > 20));
  warnings[0].message = 'modified';
  assert.notDeepEqual(evaluate(files, diff), warnings);
});

test('companions suppress existing rules and removed env usage does not warn', () => {
  assert.deepEqual(evaluate(['src/config.js', '.env.example', 'package.json', 'package-lock.json', 'prisma/schema.prisma', 'migrations/001.sql', 'src/api/users.js', 'test/users.test.js'], '+const key = process.env.NEW_KEY;'), []);
  assert.deepEqual(evaluate(['src/config.js'], '-const key = process.env.OLD_KEY;'), []);
  assert.deepEqual(evaluate(['a/x.js', 'b/y.js', 'c/z.js', 'd/w.js'], ''), []);
});

 test('diff file headers containing env syntax do not create warnings', () => {
  assert.deepEqual(evaluate(['process.env.KEY.js'], '+++ b/process.env.KEY.js\n'), []);
});


test('existing rule IDs retain focused companion suppression and path boundaries', () => {
  for (const [files, diff, id] of [
    [['src/config.js', 'docs/env.md'], '+const key = process.env.KEY;', 'env-undocumented'],
    [['package.json', 'yarn.lock'], '', 'manifest-without-lock'],
    [['prisma/schema.prisma', 'migrations/001.sql'], '', 'schema-without-migration'],
    [['.github/workflow-notes.md'], '', 'workflow-change'],
    [Array.from({length: 25}, (_, i) => `src/file${i}.js`), '', 'scope-review'],
  ]) assert.equal(evaluate(files, diff).some(w => w.id === id), false);
  assert.deepEqual(evaluate(['.github/workflows/ci.yml'], '').map(w => w.id), ['workflow-change']);
  const broad = Array.from({length: 25}, (_, i) => `area${i % 4}/file${i}.js`);
  assert.deepEqual(evaluate(broad, '').map(w => w.id), ['scope-review']);
});
