'use strict';
// Explicitly acquired bare repositories only. This script never fetches,
// checks out source, runs project commands, or loads external project code.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluate } = require('../src/rules');
const { loadPackageContents } = require('../src/git');
const data = require('../docs/dogfood-issue-5-results.json');
const cache = process.argv[2];
if (!cache) throw new Error('Supply the directory containing owner__repo bare clones with the recorded objects already available.');
let warnings = 0;
for (const row of data.changes) {
  const cwd = path.resolve(cache, row.repo.replace('/', '__'));
  const git = (...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  const refs = git('for-each-ref', '--format=%(objectname) %(refname)');
  const files = git('diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', row.base, row.head, '--').split('\0').filter(Boolean);
  const diff = git('diff', '--no-ext-diff', '--no-textconv', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--unified=0', row.base, row.head, '--');
  const actual = evaluate(files, diff, {}, loadPackageContents(row.base, row.head, files, cwd)).map(w => w.id);
  const expected = row.warnings.map(w => w.id);
  if (JSON.stringify(files) !== JSON.stringify(row.files) || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Replay mismatch: ${row.repo}@${row.head}`);
  }
  if (git('for-each-ref', '--format=%(objectname) %(refname)') !== refs) throw new Error(`Repository refs changed: ${row.repo}`);
  warnings += actual.length;
}
console.log(`Replayed ${data.changes.length} changes: ${warnings} warnings; all recorded paths/rule IDs match; refs unchanged.`);
