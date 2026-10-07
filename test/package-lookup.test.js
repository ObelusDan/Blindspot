'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { comparison, loadPackageContents } = require('../src/git');
const { evaluate } = require('../src/rules');
function fixture(t) {
  const cwd = fs.mkdtempSync(join(tmpdir(), 'blindspot-package-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (file, text) => { fs.mkdirSync(dirname(join(cwd, file)), { recursive: true }); fs.writeFileSync(join(cwd, file), text); };
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  git('init', '-qb', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  return { cwd, git, write, commit };
}
const ids = result => evaluate(result.files, result.diff, {}, result.packages).map(w => w.id);

test('small repositories: exact literal nested/unusual package paths work from a subdirectory without writes', t => {
  const { cwd, git, write, commit } = fixture(t);
  const paths = ['package.json', 'packages/deep/nested/package.json', '-option/package.json',
    ':(glob)*/package.json', 'packages/[x]*?/package.json', 'packages/$(touch SENTINEL);`echo x`/package.json', 'packages/café/package.json',
    'packages/tab\tline\nquote"back\\slash/package.json'];
  for (const file of paths) write(file, '{"version":"1","dependencies":{"version":"3"}}\n');
  write('unrelated/package.json', '{"version":"99"}');
  const base = commit(); git('branch', 'base');
  for (const file of paths) write(file, '{"version":"2","dependencies":{"version":"3"}}\n');
  const head = commit();
  for (const file of paths) write(file, 'invalid working-tree evidence');
  const before = [git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')];
  const packages = loadPackageContents(base, head, [...paths, paths[0], 'unrelated.txt'], join(cwd, 'packages'));
  assert.deepEqual([...packages.keys()], paths);
  for (const file of paths) assert.deepEqual(packages.get(file), {
    before: '{"version":"1","dependencies":{"version":"3"}}\n', after: '{"version":"2","dependencies":{"version":"3"}}\n',
  });
  assert.deepEqual(ids(comparison('base', cwd)), []);
  assert.deepEqual([git('status', '--porcelain=v1'), git('show-ref'), git('reflog', '--all')], before);
});

test('missing, invalid, oversized, symlink, directory and dependency evidence keep manifest warnings', t => {
  const { cwd, git, write, commit } = fixture(t);
  const paths = ['deleted/package.json', 'invalid/package.json', 'large/package.json', 'link/package.json',
    'tree/package.json', 'dependencies/package.json', 'duplicate/package.json'];
  for (const file of paths) write(file, '{"version":"1"}');
  commit(); git('branch', 'base');
  fs.rmSync(join(cwd, paths[0])); write(paths[1], '{"version":"2",invalid}');
  write(paths[2], JSON.stringify({ version: '2', padding: 'x'.repeat(1024 * 1024) }));
  fs.rmSync(join(cwd, paths[3])); fs.symlinkSync('../invalid/package.json', join(cwd, paths[3]));
  fs.rmSync(join(cwd, paths[4])); write(paths[4] + '/child', '{"version":"2"}');
  write(paths[5], '{"version":"2","dependencies":{"version":"2"}}');
  write(paths[6], '{"version":"2","version":"3"}'); write('added/package.json', '{"version":"2"}'); commit();
  const result = comparison('base', cwd);
  for (const file of [...paths, 'added/package.json']) assert.deepEqual(
    evaluate([file], result.diff, {}, result.packages).map(w => w.id), ['manifest-without-lock'], file);
  for (const file of paths.slice(0, 1).concat(paths.slice(2, 5))) assert.equal(result.packages.get(file).after, undefined, file);
  assert.equal(result.packages.get('added/package.json').before, undefined);
  assert.deepEqual(loadPackageContents('not-a-ref', 'not-a-ref', ['src/code.js'], cwd), new Map());
});

test('real monorepo tree exceeding 32 MiB reads only the changed manifest', t => {
  const { cwd, git } = fixture(t);
  const object = text => execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd, input: text, encoding: 'utf8' }).trim();
  const tree = entries => execFileSync('git', ['mktree'], { cwd, input: entries, encoding: 'utf8' }).trim();
  const blob = object('unrelated');
  const leaf = tree(Array.from({ length: 1024 }, (_, i) => `100644 blob ${blob}\tfile-${String(i).padStart(4, '0')}.txt\n`).join(''));
  const unrelated = Array.from({ length: 512 }, (_, i) => `040000 tree ${leaf}\tunrelated-${String(i).padStart(3, '0')}\n`).join('');
  const makeCommit = (version, parent) => {
    const root = tree(unrelated + `100644 blob ${object(`{"version":"${version}"}`)}\tpackage.json\n`);
    return execFileSync('git', ['commit-tree', root, ...(parent ? ['-p', parent] : [])], { cwd, input: 'fixture\n', encoding: 'utf8' }).trim();
  };
  const base = makeCommit('1'); const head = makeCommit('2', base);
  git('update-ref', 'refs/heads/main', head); git('update-ref', 'refs/heads/base', base);
  const old = spawnSync('git', ['ls-tree', '-r', '-z', base], { cwd, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(old.error?.code, 'ENOBUFS');
  const before = [git('show-ref'), git('reflog', '--all')];
  const trace = join(cwd, 'trace.log'); const previous = process.env.GIT_TRACE;
  process.env.GIT_TRACE = trace;
  let result;
  try { result = comparison('base', cwd); } finally {
    if (previous === undefined) delete process.env.GIT_TRACE; else process.env.GIT_TRACE = previous;
  }
  assert.deepEqual(result.files, ['package.json']); assert.deepEqual(ids(result), []);
  const lookups = fs.readFileSync(trace, 'utf8').split('\n').filter(line => line.includes('built-in: git') && line.includes('ls-tree'));
  assert.equal(lookups.length, 2);
  for (const line of lookups) {
    assert.match(line, /git ls-tree --full-tree -z [0-9a-f]+ -- package.json$/);
    assert.doesNotMatch(line, /unrelated| -r /);
  }
  assert.deepEqual([git('show-ref'), git('reflog', '--all')], before);
});
