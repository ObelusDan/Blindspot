const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate } = require("../src/index");

test("warns when API code changes without tests", () => {
  const warnings = evaluate(["src/api/users.js"], "");
  assert.ok(warnings.some((warning) => warning.id === "api-without-tests"));
});

test("does not warn when API and tests change together", () => {
  const warnings = evaluate(["src/api/users.js", "test/users.test.js"], "");
  assert.ok(!warnings.some((warning) => warning.id === "api-without-tests"));
});

test("warns on added environment variable without docs", () => {
  const warnings = evaluate(
    ["src/config.js"],
    "+const key = process.env.NEW_KEY;"
  );
  assert.ok(warnings.some((warning) => warning.id === "env-undocumented"));
});

test("warns on package manifest without lockfile", () => {
  const warnings = evaluate(["package.json"], "");
  assert.ok(warnings.some((warning) => warning.id === "manifest-without-lock"));
});

test("warns on schema without migration", () => {
  const warnings = evaluate(["prisma/schema.prisma"], "");
  assert.ok(
    warnings.some((warning) => warning.id === "schema-without-migration")
  );
});
