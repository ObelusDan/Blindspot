"use strict";

const { matchesPath } = require("./config");

function isTestPath(path, config = {}) {
  return (config.tests || []).some(pattern => matchesPath(path, pattern)) ||
    /(^|\/)(test|tests|__tests__)(\/|\.|$)/i.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path) ||
    /test_.*\.py$/i.test(path) || /_test\.go$/i.test(path);
}

// Decode Git's C-quoted UTF-8 pathname, never shell syntax. Unknown escapes,
// invalid UTF-8 or ambiguous suffixes cannot establish a suppression path.
function decodePatchPath(field, prefix) {
  if (field === "/dev/null") return null;
  let decoded;
  if (field.startsWith('"')) {
    const bytes = [];
    const escapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
    let i = 1;
    for (; i < field.length && field[i] !== '"'; i++) {
      if (field[i] === "\\") {
        const escape = field[++i];
        if (Object.hasOwn(escapes, escape)) bytes.push(escapes[escape]);
        else {
          const octal = /^[0-7]{1,3}/.exec(field.slice(i))?.[0];
          if (!octal || parseInt(octal, 8) > 255) return undefined;
          bytes.push(parseInt(octal, 8));
          i += octal.length - 1;
        }
      } else {
        const char = String.fromCodePoint(field.codePointAt(i));
        bytes.push(...Buffer.from(char));
        i += char.length - 1;
      }
    }
    if (field[i] !== '"' || !["", "\t"].includes(field.slice(i + 1))) return undefined;
    const buffer = Buffer.from(bytes);
    decoded = buffer.toString("utf8");
    if (!Buffer.from(decoded).equals(buffer)) return undefined;
  } else {
    // Git adds a tab terminator to some unquoted marker paths with spaces.
    decoded = field.endsWith("\t") ? field.slice(0, -1) : field;
    if (/[\x00-\x1f\x7f]/.test(decoded)) return undefined;
  }
  if (!decoded.startsWith(prefix) || decoded.includes("\0")) return undefined;
  return decoded.slice(prefix.length);
}

function patchSections(diff, files) {
  const known = new Set(files);
  return diff.split(/^(?=diff --git )/m).filter(Boolean).map(patch => {
    // Added content can resemble a marker; only metadata before the hunk counts.
    const metadata = patch.split(/^@@/m, 1)[0];
    const oldMarkers = [...metadata.matchAll(/^--- (.*)$/gm)];
    const newMarkers = [...metadata.matchAll(/^\+\+\+ (.*)$/gm)];
    const oldPath = oldMarkers.length === 1 ? decodePatchPath(oldMarkers[0][1], "a/") : undefined;
    const path = newMarkers.length === 1 ? decodePatchPath(newMarkers[0][1], "b/") : undefined;
    const oldHeaderPath = oldPath === null ? path : oldPath;
    const newHeaderPath = path === null ? oldPath : path;
    const spellings = (prefix, name) => name === undefined || name === null ? [] :
      [quotedGitPath(prefix + name), quotedGitPath(prefix + name, false)];
    const header = patch.split("\n", 1)[0];
    const headerMatches = spellings("a/", oldHeaderPath).some(old =>
      spellings("b/", newHeaderPath).some(next => header === `diff --git ${old} ${next}`));
    const associated = headerMatches && [path, oldPath].some(candidate => candidate != null && known.has(candidate));
    const changedPath = associated ? [path, oldPath].find(candidate => candidate != null && known.has(candidate)) : undefined;
    return { patch, path: associated ? path : undefined, oldPath: associated ? oldPath : undefined, changedPath };
  });
}

// Match Git's core.quotePath=true spelling byte-for-byte for ignore filtering.
function quotedGitPath(path, quoteNonAscii = true) {
  const escapes = { 7: "a", 8: "b", 9: "t", 10: "n", 11: "v", 12: "f", 13: "r", 34: '"', 92: "\\" };
  let text = "";
  let quoted = false;
  for (const byte of Buffer.from(path, "utf8")) {
    if (escapes[byte]) { text += "\\" + escapes[byte]; quoted = true; }
    else if (byte < 32 || byte === 127 || (quoteNonAscii && byte >= 128)) {
      text += "\\" + byte.toString(8).padStart(3, "0"); quoted = true;
    } else text += String.fromCharCode(byte);
  }
  if (!quoteNonAscii) text = Buffer.from(text, "latin1").toString("utf8");
  return quoted ? '"' + text + '"' : text;
}

module.exports = { isTestPath, patchSections, quotedGitPath };
