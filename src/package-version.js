"use strict";

// Locate exactly one top-level version string in a valid package object.
// Keeping the rest of the original JSON text prevents nested fields, duplicate
// keys or unrelated edits from being hidden by JSON.parse normalization.
function withoutPackageVersion(source) {
  let value;
  try { value = JSON.parse(source); } catch { return undefined; }
  if (!value || Array.isArray(value) || typeof value !== "object" || typeof value.version !== "string") return undefined;
  const tokens = [...source.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]/g)];
  let depth = 0;
  const versions = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i][0];
    if (depth === 1 && token.startsWith('"') && tokens[i + 1]?.[0] === ":" && JSON.parse(token) === "version") {
      const string = tokens[i + 2];
      if (!string?.[0].startsWith('"')) return undefined;
      versions.push(string);
    }
    if (token === "{" || token === "[") depth++;
    if (token === "}" || token === "]") depth--;
  }
  if (versions.length !== 1) return undefined;
  const token = versions[0];
  return source.slice(0, token.index) + '"<package-version>"' + source.slice(token.index + token[0].length);
}

function isVersionOnlyPackage(contents) {
  if (!contents || typeof contents.before !== "string" || typeof contents.after !== "string" || contents.before === contents.after) return false;
  const before = withoutPackageVersion(contents.before);
  return before !== undefined && before === withoutPackageVersion(contents.after);
}

module.exports = { isVersionOnlyPackage };
