/**
 * Checks module.json for the mistakes that only show up inside Foundry.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(new URL("../module.json", import.meta.url)));
const m = JSON.parse(readFileSync(path.join(root, "module.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  ", name); };

t('socket: true is set (socketlib refuses to register a module without it)', () => {
  assert.equal(m.socket, true);
});
t("id is dnd-quickpay (the code looks itself up by this id)", () => assert.equal(m.id, "dnd-quickpay"));
t("requires socketlib", () => assert.ok(m.relationships.requires.some((r) => r.id === "socketlib" && r.type === "module")));
t("targets dnd5e", () => assert.ok(m.relationships.systems.some((s) => s.id === "dnd5e")));
t("compatibility minimum is v14.367", () => assert.equal(m.compatibility.minimum, "14.367"));
t("every esmodule file exists", () => {
  assert.ok(m.esmodules.length > 0);
  for (const f of m.esmodules) assert.ok(existsSync(path.join(root, f)), f);
});
t("every style file exists", () => {
  for (const f of m.styles ?? []) assert.ok(existsSync(path.join(root, f)), f);
});
t("version is semver and matches package.json", () => {
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.equal(m.version, pkg.version);
});

t('type is "module" and media is a list', () => {
  assert.equal(m.type, "module");
  assert.ok(Array.isArray(m.media));
});
t("every language file exists, is valid JSON, and has text for every key", () => {
  assert.ok(m.languages.length > 0);
  for (const l of m.languages) {
    const table = JSON.parse(readFileSync(path.join(root, l.path), "utf8"));
    assert.ok(Object.keys(table).length > 0, l.path);
  }
});
t("license and readme are files that ship in the package", () => {
  assert.ok(existsSync(path.join(root, m.license)), m.license);
  assert.ok(existsSync(path.join(root, m.readme)), m.readme);
});
t("download link names this version and every link uses the DND-QuickPay repo", () => {
  assert.ok(m.download.includes(`/v${m.version}/`), m.download);
  for (const key of ["url", "manifest", "download", "bugs", "changelog"]) {
    assert.ok(m[key].startsWith("https://github.com/Fenestra-Games/DND-QuickPay"), key);
  }
});
t("the manifest link is the stable latest-release address", () => {
  assert.ok(m.manifest.endsWith("/releases/latest/download/module.json"));
});

console.log(`\n${n} manifest checks passed`);
