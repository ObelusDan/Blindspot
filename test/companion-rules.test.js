const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/rules');

function patch(path, lines, added = false, mode = '100755') {
  return `diff --git a/${path} b/${path}\n${added ? `new file mode ${mode}\n` : ''}--- ${added ? '/dev/null' : `a/${path}`}\n+++ b/${path}\n@@ -1 +1 @@\n${lines}\n`;
}
const command = patch('bin/blindspot', '+#!/usr/bin/env node\n+run();', true);
const declaration = patch('index.d.ts', '-export declare function run(): void;\n+export declare function run(): string;');
const has = (files, diff, id) => evaluate(files, diff).some(w => w.id === id);
const cliId = 'cli-command-without-docs';
const typesId = 'public-types-without-tests-or-docs';

test('new executable bin command explains the missing documentation', () => {
  assert.deepEqual(evaluate(['bin/blindspot'], command), [{
    id: cliId,
    message: 'New CLI entry point added (bin/blindspot), but no README or documentation changed.',
  }]);
});

test('README and docs each suppress new command warning', () => {
  for (const companion of ['README.md', 'docs/cli.md', 'packages/tool/README.md']) {
    assert.equal(has(['bin/blindspot', companion], command, cliId), false);
  }
});

test('existing commands, non-executable files, arbitrary scripts and bin support files do not warn', () => {
  for (const [path, diff] of [
    ['bin/blindspot', patch('bin/blindspot', '+#!/usr/bin/env node')],
    ['bin/blindspot', patch('bin/blindspot', '+#!/usr/bin/env node', true, '100644')],
    ['scripts/cleanup.sh', patch('scripts/cleanup.sh', '+#!/bin/sh', true)],
    ['bin/helpers/run', patch('bin/helpers/run', '+#!/bin/sh', true)],
    ['bin/helper.js', patch('bin/helper.js', '+module.exports = {};', true)],
  ]) assert.equal(has([path], diff, cliId), false);
});

test('exported root declaration explains missing tests and docs', () => {
  assert.deepEqual(evaluate(['index.d.ts'], declaration), [{
    id: typesId,
    message: 'Exported declaration changed in index.d.ts, but no test file, README, or documentation changed.',
  }]);
  assert.equal(has(['index.d.ts'], patch('index.d.ts', '-export type Result = string;'), typesId), true);
});

test('tests, README and docs independently suppress declaration warning', () => {
  for (const companion of ['test/api.js', 'src/api.test.ts', 'README.md', 'docs/api.md']) {
    assert.equal(has(['index.d.ts', companion], declaration, typesId), false);
  }
});

test('internal types, comments, context and whitespace-only declaration changes do not warn', () => {
  for (const [path, lines] of [
    ['src/types.d.ts', '+export interface Result {}'],
    ['packages/tool/index.d.ts', '+export interface Result {}'],
    ['index.d.ts', '+// export interface Result {}'],
    ['index.d.ts', '+interface Internal {}'],
    ['index.d.ts', ' export interface Result {}\n+// updated comment'],
    ['index.d.ts', '-export type Result = string;\n+  export type Result=string;'],
    ['index.d.ts', '-export type Result = string; // old note\n+export type Result = string; // new note'],
  ]) assert.equal(has([path], patch(path, lines), typesId), false);
});

test('file-local evidence cannot leak from unrelated patches or mismatched file lists', () => {
  assert.equal(has(['bin/blindspot'], patch('src/main.js', '+#!/usr/bin/env node', true), cliId), false);
  assert.equal(has(['index.d.ts'], patch('src/main.ts', '+export interface Result {}'), typesId), false);
  assert.deepEqual(evaluate(['bin/blindspot', 'index.d.ts'], ''), []);
  assert.deepEqual(evaluate([], command + declaration), []);
});

test('new rules have deterministic ordering and do not mutate inputs', () => {
  const files = Object.freeze(['index.d.ts', 'bin/z', 'bin/a']);
  const diff = declaration + patch('bin/z', '+#!/bin/sh', true) + patch('bin/a', '+#!/bin/sh', true);
  const warnings = evaluate(files, diff);
  assert.deepEqual(warnings.map(w => w.id), [cliId, typesId]);
  assert.match(warnings[0].message, /bin\/a, bin\/z/);
  assert.deepEqual(evaluate(files, diff), warnings);
  assert.deepEqual(evaluate([...files].reverse(), diff), warnings);
});
