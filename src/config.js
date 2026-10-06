"use strict";

const RULE_IDS = Object.freeze([
  "env-undocumented", "manifest-without-lock", "api-without-tests",
  "schema-without-migration", "workflow-change", "scope-review",
  "cli-command-without-docs", "public-types-without-tests-or-docs",
]);
const KEYS = ["disable", "ignore", "tests", "migrations"];

function invalid(message, line) {
  throw new Error(`Invalid .blindspot.yml${line ? ` at line ${line}` : ""}: ${message}. Use only disable, ignore, tests, migrations with indented '- string' lists (or []).`);
}

// Deliberately a tiny YAML subset, not a general YAML interpreter.
function parseConfig(source) {
  const config = { disable: [], ignore: [], tests: [], migrations: [] };
  const seen = new Set();
  let key;
  let keyLine;
  const requireBody = () => {
    if (key && !config[key].length) invalid(`key '${key}' needs at least one list item or explicit []`, keyLine);
  };
  for (const [index, original] of source.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = index + 1;
    if (/^\s*(?:#.*)?$/.test(original)) continue;
    if (original.includes("\t")) invalid("tabs are not supported; indent with spaces", line);
    const header = /^([a-z]+):\s*(\[\])?\s*(?:#.*)?$/.exec(original);
    if (header) {
      requireBody();
      key = header[1];
      keyLine = line;
      if (!KEYS.includes(key)) invalid(`unknown key '${key}'`, line);
      if (seen.has(key)) invalid(`duplicate key '${key}'`, line);
      seen.add(key);
      if (header[2]) key = undefined;
      continue;
    }
    const item = /^ +-[ ]+(.+)$/.exec(original);
    if (!key || !item) invalid("expected a supported key or an indented list item", line);
    const token = item[1].trim();
    let value;
    if (token.startsWith('"')) {
      const quoted = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(token);
      try { value = quoted && JSON.parse(quoted[1]); } catch { /* diagnostic below */ }
    } else if (token.startsWith("'")) {
      const quoted = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(token);
      if (quoted) value = quoted[1].replace(/''/g, "'");
    } else {
      value = token.replace(/\s+#.*$/, "");
      if (value.startsWith("*") || !/^[a-zA-Z0-9_./*?@+-]+$/.test(value) || /^(?:true|false|yes|no|on|off|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(value)) value = undefined;
    }
    if (typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value)) invalid("expected a non-empty string; quote globs and special characters", line);
    if (key === "disable") {
      if (!RULE_IDS.includes(value)) invalid(`unknown rule ID '${value}'; valid IDs: ${RULE_IDS.join(", ")}`, line);
    } else {
      validatePattern(value, line);
    }
    if (config[key].includes(value)) invalid(`duplicate value '${value}' in ${key}; remove the repeated entry`, line);
    config[key].push(value);
  }
  requireBody();
  return config;
}

function validatePattern(pattern, line) {
  if (pattern.startsWith("/") || pattern.includes("\\") || pattern.split("/").some(p => p === "." || p === "..") || /[\[\]{}!:#&|<>]/.test(pattern) || pattern.includes("//")) {
    invalid(`unsupported path pattern '${pattern}'; use repository-relative paths with *, **, ?`, line);
  }
}

function matchesPath(path, pattern) {
  // A trailing slash is shorthand for all files under that directory.
  if (pattern.endsWith("/")) pattern += "**";
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") { regex += "(?:.*/)?"; i++; }
      else regex += ".*";
    } else if (char === "*") regex += "[^/]*";
    else if (char === "?") regex += "[^/]";
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(regex + "$", "s").test(path);
}

module.exports = { RULE_IDS, parseConfig, matchesPath };
