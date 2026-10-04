"use strict";

const { appendFileSync } = require("node:fs");

function renderSummary(warnings, files) {
  const lines = ["# Blindspot", "", `Changed files: ${files.length}`, ""];
  if (!warnings.length) {
    lines.push("✅ No companion-change warnings found.");
  } else {
    lines.push(`## ${warnings.length} potential blind spot${warnings.length === 1 ? "" : "s"} found`, "");
    for (const warning of warnings) {
      lines.push(`- \`${warning.id}\``, `  ${warning.message}`, "");
    }
  }
  return lines.join("\n") + "\n";
}

function writeSummary(warnings, files) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, renderSummary(warnings, files), "utf8");
  } catch (error) {
    console.error(`Blindspot warning: could not write GitHub Actions job summary: ${error.message}`);
  }
}

module.exports = { renderSummary, writeSummary };
