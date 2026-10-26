// Preloaded by "npm test" so t() works outside Foundry. See scripts/i18n.mjs.
import { readFileSync } from "node:fs";
import { setFallbackStrings } from "../scripts/i18n.mjs";

setFallbackStrings(JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")));
