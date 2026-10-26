// Every string a player can see lives in lang/en.json. These checks keep the code and the file in step.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { t } from "../scripts/i18n.mjs";

const root = new URL("..", import.meta.url).pathname;
const lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok  ", name); };

const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".mjs") ? [p] : [];
  });
const source = files(join(root, "scripts")).map((f) => readFileSync(f, "utf8")).join("\n");

// Keys that are built from a prefix at run time, so a plain search can't see them whole.
const DYNAMIC = [/^QUICKPAY\.status\./, /^QUICKPAY\.ledger\.col\./, /^QUICKPAY\.card\.masked/, /^QUICKPAY\.send\.confirm/, /^QUICKPAY\.pane\./, /^QUICKPAY\.perm\./];

test("every key the code uses exists in lang/en.json", () => {
  const used = new Set([...source.matchAll(/["'`](QUICKPAY\.[A-Za-z0-9_.]+)["'`]/g)].map((m) => m[1]));
  const missing = [...used].filter((k) => !(k in lang));
  assert.deepEqual(missing, []);
});

test("every key in lang/en.json is used by the code", () => {
  const unused = Object.keys(lang).filter((k) => !source.includes(k) && !DYNAMIC.some((re) => re.test(k)));
  assert.deepEqual(unused, []);
});

test("no entry in lang/en.json is empty or not text", () => {
  for (const [key, text] of Object.entries(lang)) {
    assert.equal(typeof text, "string", key);
    assert.ok(text.length > 0, `${key} is empty`);
  }
});

test("t() fills placeholders and returns the key when a string is missing", () => {
  assert.equal(t("QUICKPAY.send.pays", { amount: "2 gp" }), "Pays 2 gp");
  assert.equal(t("QUICKPAY.does.not.exist"), "QUICKPAY.does.not.exist");
  assert.equal(t("QUICKPAY.send.pays", {}), "Pays {amount}");
});

console.log(`\n${n} i18n tests passed`);
