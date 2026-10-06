"use strict";

function any(files, patterns) {
  return files.some((file) => patterns.some((pattern) => pattern.test(file)));
}

// Ignore formatting outside literals; preserve literal contents and escapes.
function normalizeDeclaration(line) {
  let normalized = "";
  let quote = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      normalized += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else {
      if (char === "/" && line[i + 1] === "/") break;
      if (char === '"' || char === "'" || char === "`") quote = char;
      if (!/\s/.test(char)) normalized += char;
    }
  }
  return normalized.replace(/;$/, "");
}

function evaluate(files, diff, config = {}) {
  const { matchesPath } = require("./config");
  const warnings = [];

  const envUsageAdded =
    /^\+(?!\+\+).*(?:process\.env\.|import\.meta\.env\.|os\.environ|ENV\[|getenv\()/m.test(diff);

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

  const testsChanged = files.some(file => (config.tests || []).some(pattern => matchesPath(file, pattern))) || any(files, [
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

  const migrationChanged = files.some(file => (config.migrations || []).some(pattern => matchesPath(file, pattern))) || any(files, [
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

  // Use file-local patch evidence. Quoted/ambiguous paths deliberately do not
  // match: missing a warning is preferable to attributing another file's diff.
  const patches = diff.split(/^diff --git /m).slice(1);
  const docsChanged = any(files, [
    /(^|\/)(README|docs?)(\/|\.|$)/i,
  ]);
  const newCommands = [];
  const publicTypes = [];
  for (const patch of patches) {
    const path = /^\+\+\+ b\/(.+)$/m.exec(patch)?.[1];
    const oldPath = /^--- a\/(.+)$/m.exec(patch)?.[1];
    if (![path, oldPath].some((candidate) => candidate && files.includes(candidate))) continue;
    // Only root bin entry points with a shebang, not arbitrary scripts.
    if (path && /^bin\/[^/]+$/.test(path) &&
        /^new file mode 100755$/m.test(patch) &&
        /^--- \/dev\/null$/m.test(patch) &&
        /^\+#!/m.test(patch)) {
      newCommands.push(path);
    }
    // Root index.d.ts is an explicit package declaration entry point. Do not
    // infer public contracts from arbitrary interfaces, types, or source exports.
    if (path === "index.d.ts" || oldPath === "index.d.ts") {
      const exported = (prefix) => patch.split("\n")
        .filter((line) => line.startsWith(prefix) &&
          /^export\s+(?:declare\s+)?(?:interface|type|class|function|const|let|enum)\b/.test(line.slice(1).trim()))
        .map((line) => normalizeDeclaration(line.slice(1)))
        .sort();
      const added = path === "index.d.ts" ? exported("+") : [];
      const removed = oldPath === "index.d.ts" ? exported("-") : [];
      if (JSON.stringify(added) !== JSON.stringify(removed)) publicTypes.push("index.d.ts");
    }
  }

  if (newCommands.length && !docsChanged) {
    warnings.push({
      id: "cli-command-without-docs",
      message: `New CLI entry point added (${[...new Set(newCommands)].sort().join(", ")}), but no README or documentation changed.`,
    });
  }
  if (publicTypes.length && !testsChanged && !docsChanged) {
    warnings.push({
      id: "public-types-without-tests-or-docs",
      message: "Exported declaration changed in index.d.ts, but no test file, README, or documentation changed.",
    });
  }

  return warnings.filter(warning => !(config.disable || []).includes(warning.id));
}

module.exports = { evaluate };
