import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./yandex-direct-apply-boat-negative.mjs", import.meta.url), "utf8");

assert.match(source, /const campaignId = 713802902;/);
assert.match(source, /const negativeKeyword = "лодка";/);
assert.doesNotMatch(source, /campaigns", "update"/);
assert.doesNotMatch(source, /campaigns", "resume"/);
assert.match(source, /verifyReadback\(before, after\)/);
assert.match(source, /Yandex account lock exists/);

process.stdout.write("boat-negative helper contract PASS\n");
