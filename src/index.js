#!/usr/bin/env node
"use strict";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const { evaluate } = require("./rules");
const { comparison } = require("./git");
const { writeSummary } = require("./summary");

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
    process.env["INPUT_BASE-REF"] || process.env.INPUT_BASE_REF ||
    arg("--base", process.env.GITHUB_BASE_REF || "main");

  const fail =
    String(process.env["INPUT_FAIL-ON-WARNING"] || process.env.INPUT_FAIL_ON_WARNING || "false").toLowerCase() === "true";

  const { files, diff } = comparison(base);
  const warnings = evaluate(files, diff);
  render(warnings, files);
  writeSummary(warnings, files);

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
