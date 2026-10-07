"use strict";

const { spawnSync } = require("node:child_process");

function git(args, cwd, allowMissing = false) {
  const result = spawnSync("git", args, {
    cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error) throw new Error(`Could not run git: ${result.error.message}. Ensure Git is installed and the repository is accessible.`);
  if (result.status !== 0) {
    if (allowMissing && result.status === 1) return null;
    throw new Error(`git ${args[0]} failed: ${(result.stderr || "").trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function resolveBase(baseRef, cwd) {
  if (typeof baseRef !== "string" || !baseRef.trim() || baseRef.startsWith("-")) {
    throw new Error("Invalid base ref. Supply a branch or commit with --base <ref>.");
  }
  git(["rev-parse", "--show-toplevel"], cwd);
  const candidates = baseRef.startsWith("refs/") || baseRef.startsWith("origin/")
    ? [baseRef] : [baseRef, `refs/remotes/origin/${baseRef}`];
  for (const candidate of candidates) {
    const commit = git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${candidate}^{commit}`], cwd, true);
    if (commit !== null) return commit.trim();
  }
  throw new Error(`Base ref "${baseRef}" is not available locally. Fetch the base branch before running Blindspot, or use actions/checkout with fetch-depth: 0. Blindspot does not fetch or modify the repository.`);
}

function repositoryRoot(cwd = process.cwd()) {
  return git(["rev-parse", "--show-toplevel"], cwd).replace(/\n$/, "");
}

// Read the resolved base commit's root blob, never the PR checkout or merge base.
function loadBaseConfig(baseCommit, cwd = process.cwd()) {
  const { parseConfig } = require("./config");
  const entry = git(["ls-tree", "-z", baseCommit, "--", ".blindspot.yml"], cwd);
  if (!entry) return parseConfig("");
  const match = /^(100644|100755) blob ([0-9a-f]+)\t\.blindspot\.yml\0$/.exec(entry);
  if (!match) throw new Error("Invalid .blindspot.yml on base: config must be a regular file, not a directory or symbolic link.");
  const object = match[2];
  const size = Number(git(["cat-file", "-s", object], cwd).trim());
  if (size > 64 * 1024) throw new Error("Invalid .blindspot.yml on base: config exceeds the 64 KiB limit; keep it small.");
  try {
    return parseConfig(git(["cat-file", "blob", object], cwd));
  } catch (error) {
    throw new Error(`Base config (${baseCommit}): ${error.message}`);
  }
}

const { quotedGitPath } = require("./paths");

function filterPatches(diff, files) {
  // Configured ignores disable rename detection: each addition/deletion has
  // the same exact pathname on both sides of its diff --git header.
  const headers = new Set(files.map(path =>
    `diff --git ${quotedGitPath("a/" + path)} ${quotedGitPath("b/" + path)}`));
  return diff.split(/^(?=diff --git )/m)
    .filter(patch => headers.has(patch.split("\n", 1)[0]))
    .join("");
}

function comparison(baseRef, cwd = process.cwd(), config = {}) {
  const base = resolveBase(baseRef, cwd);
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"], cwd).trim();
  let mergeBase;
  try {
    mergeBase = git(["merge-base", base, head], cwd).trim();
  } catch (error) {
    throw new Error(`${error.message}. Ensure the base and HEAD share history; for shallow checkouts use actions/checkout with fetch-depth: 0.`);
  }
  const ignored = config.ignore || [];
  const renameOptions = ignored.length ? ["--no-renames"] : [];
  const names = git(["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", ...renameOptions, mergeBase, head, "--"], cwd);
  const { matchesPath } = require("./config");
  const files = names.split("\0").filter(Boolean).filter(file => !ignored.some(pattern => matchesPath(file, pattern)));
  const diffArgs = [
    ...(ignored.length ? ["-c", "core.quotePath=true"] : []),
    "diff", "--no-ext-diff", "--no-textconv", ...renameOptions, "--no-color",
    "--src-prefix=a/", "--dst-prefix=b/", "--unified=0", mergeBase, head, "--",
  ];
  // Literal pathspecs still match descendants when a file becomes a directory.
  // Exclude that subtree before Git generates patches, then retain the exact
  // header check as a conservative guard. One path per call also avoids argv
  // limits and prevents exclusions for one file from hiding another retained file.
  const diff = ignored.length ? files.map(file => filterPatches(git([
    ...diffArgs, `:(top,literal)${file}`, `:(top,exclude,literal)${file}/`,
  ], cwd), [file])).join("") : git(diffArgs, cwd);
  return { files, diff, packages: loadPackageContents(mergeBase, head, files, cwd) };
}

// Read regular committed package blobs only, never working-tree files or code.
// A missing, non-regular or oversized blob cannot prove a version-only change.
function loadPackageContents(base, head, files, cwd = process.cwd()) {
  const wanted = new Set(files.filter(file => /(^|\/)package\.json$/.test(file)));
  const packages = new Map();
  if (!wanted.size) return packages;
  const read = commit => {
    const contents = new Map();
    // One literal path per query bounds output and argv independently of the
    // rest of the repository. Do not recurse: a package replaced by a tree is
    // not package evidence. --full-tree also works from a subdirectory.
    for (const file of wanted) {
      const entry = git(["--literal-pathspecs", "ls-tree", "--full-tree", "-z", commit, "--", file], cwd);
      const match = /^(100644|100755) blob ([0-9a-f]+)\t([\s\S]+)\0$/.exec(entry);
      if (!match || match[3] !== file) continue;
      const size = Number(git(["cat-file", "-s", match[2]], cwd).trim());
      if (size <= 1024 * 1024) contents.set(match[3], git(["cat-file", "blob", match[2]], cwd));
    }
    return contents;
  };
  const before = read(base);
  const after = read(head);
  for (const file of wanted) packages.set(file, { before: before.get(file), after: after.get(file) });
  return packages;
}

module.exports = { comparison, resolveBase, repositoryRoot, loadBaseConfig, filterPatches, loadPackageContents };
