#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveBase(baseRef) {
  try {
    runGit(["rev-parse", "--verify", baseRef]);
    return baseRef;
  } catch {
    const remote = `origin/${baseRef}`;
    try {
      runGit(["rev-parse", "--verify", remote]);
      return remote;
    } catch {
      runGit(["fetch", "--no-tags", "--depth=1", "origin", baseRef]);
      return remote;
    }
  }
}

function comparison(baseRef) {
  const resolved = resolveBase(baseRef);
  const mergeBase = runGit(["merge-base", resolved, "HEAD"]);
  const names = runGit(["diff", "--name-only", `${mergeBase}...HEAD`]);
  const diff = runGit(["diff", "--unified=0", `${mergeBase}...HEAD`]);

  return {
    files: names ? names.split("\n").filter(Boolean) : [],
    diff,
  };
}

function any(files, patterns) {
  return files.some((file) => patterns.some((pattern) => pattern.test(file)));
}

function evaluate(files, diff) {
  const warnings = [];

  const envUsageAdded =
    /^\+.*(?:process\.env\.|import\.meta\.env\.|os\.environ|ENV\[|getenv\()/m.test(diff);

  const envDocsChanged = any(files, [
    /(^|\/)\.env(?:\.example|\.sample|\.template)?$/,
    /env.*(?:example|sample|template)/i,
    /(^|\/)(README|docs?)(\/|\.|$)/i,
  ]);

  if (envUsageAdded && !envDocsChanged) {
    warnings.push({
      id: "env-undocumented",
      message:
        "Environment-variable usage changed, but no env example or documentation changed.",
    });
  }

  const manifestChanged = any(files, [
    /(^|\/)package\.json$/,
    /(^|\/)pyproject\.toml$/,
    /(^|\/)requirements[^/]*\.txt$/,
    /(^|\/)go\.mod$/,
    /(^|\/)Cargo\.toml$/,
    /(^|\/)Gemfile$/,
  ]);

  const lockChanged = any(files, [
    /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock|go\.sum|Cargo\.lock|Gemfile\.lock)$/,
  ]);

  if (manifestChanged && !lockChanged) {
    warnings.push({
      id: "manifest-without-lock",
      message:
        "A dependency manifest changed, but no recognised lockfile changed.",
    });
  }

  const apiChanged = any(files, [
    /(^|\/)(api|apis|routes?|controllers?|handlers?|endpoints?)(\/|\.|$)/i,
  ]);

  const testsChanged = any(files, [
    /(^|\/)(test|tests|__tests__)(\/|\.|$)/i,
    /\.(test|spec)\.[cm]?[jt]sx?$/i,
    /test_.*\.py$/i,
    /_test\.go$/i,
  ]);

  if (apiChanged && !testsChanged) {
    warnings.push({
      id: "api-without-tests",
      message: "API/route/controller code changed, but no test file changed.",
    });
  }

  const schemaChanged = any(files, [
    /(^|\/)(schema|schemas)(\/|\.|$)/i,
    /schema\.(prisma|sql)$/i,
  ]);

  const migrationChanged = any(files, [
    /(^|\/)(migrations?|alembic|db\/migrate)(\/|\.|$)/i,
  ]);

  if (schemaChanged && !migrationChanged) {
    warnings.push({
      id: "schema-without-migration",
      message: "Database schema changed, but no migration file changed.",
    });
  }

  if (any(files, [/^\.github\/workflows\//])) {
    warnings.push({
      id: "workflow-change",
      message:
        "GitHub Actions workflow changed. Review permissions, triggers, secrets, and deployment effects.",
    });
  }

  const topLevelAreas = new Set(
    files
      .map((file) => file.split("/")[0])
      .filter((part) => part && !part.startsWith("."))
  );

  if (files.length >= 25 && topLevelAreas.size >= 4) {
    warnings.push({
      id: "scope-review",
      message: `PR touches ${files.length} files across ${topLevelAreas.size} top-level areas. Check for accidental scope creep.`,
    });
  }

  return warnings;
}

function render(warnings, files) {
  console.log("Blindspot");
  console.log("=========");
  console.log(`Changed files: ${files.length}`);

  if (!warnings.length) {
    console.log("\n✓ No companion-change warnings found.");
    return;
  }

  console.log(`\n⚠ ${warnings.length} warning(s):`);
  for (const warning of warnings) {
    console.log(`- [${warning.id}] ${warning.message}`);
  }
}

function main() {
  const base =
    process.env.INPUT_BASE_REF ||
    arg("--base", process.env.GITHUB_BASE_REF || "main");

  const fail =
    String(process.env.INPUT_FAIL_ON_WARNING || "false").toLowerCase() === "true";

  const { files, diff } = comparison(base);
  const warnings = evaluate(files, diff);
  render(warnings, files);

  if (fail && warnings.length) {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Blindspot failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { evaluate };
