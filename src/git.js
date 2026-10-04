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
  const diff = ignored.length && !files.length ? "" : git([...(ignored.length ? ["--literal-pathspecs"] : []), "diff", "--no-ext-diff", "--no-textconv", ...renameOptions, "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--unified=0", mergeBase, head, "--", ...(ignored.length ? files : [])], cwd);
  return { files, diff };
}

module.exports = { comparison, resolveBase, repositoryRoot };
