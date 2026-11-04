// SPDX-License-Identifier: GPL-2.0-or-later
// The "Ask for a certificate" command, as `wol cert request GITHUB_ID LOGIN NAMESPACE NAME... [--org]` takes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { at } from "../scripts/lib/paths.mjs";

(0, eval)(readFileSync(at("src/certcmd.js"), "utf8"));
const { command } = globalThis.HubCert;

test("a person: id, login, their namespace with the dot, their name", () => {
  assert.equal(command({ id: 5310001, login: "alicedoe" }, { login: "alicedoe", name: "Alice Doe" }), "wol cert request 5310001 alicedoe alicedoe. Alice Doe");
});
test("a person without a display name uses the login", () => {
  assert.equal(command({ id: 7, login: "bob" }, { login: "bob", name: null }), "wol cert request 7 bob bob. bob");
});
test("an organisation: its id, login and namespace, its login as the name, and --org last", () => {
  assert.equal(command({ id: 348106055, login: "wonderlandos", org: true }, { login: "kleeedolinux", name: "Klee" }), "wol cert request 348106055 wonderlandos wonderlandos. wonderlandos --org");
});
test("the namespace is lower case, as the Worker wants; the login keeps its case", () => {
  assert.equal(command({ id: 1, login: "KleeeDolinux" }, { login: "KleeeDolinux", name: "Klee" }), "wol cert request 1 KleeeDolinux kleeedolinux. Klee");
  assert.equal(command({ id: 2, login: "Example-Labs", org: true }, {}), "wol cert request 2 Example-Labs example-labs. Example-Labs --org");
});
test("a name with characters the shell reads is quoted word by word", () => {
  assert.equal(command({ id: 3, login: "o" }, { login: "o", name: "Zoë O'Brien" }), "wol cert request 3 o o. Zoë 'O'\\''Brien'");
  assert.equal(command({ id: 3, login: "o" }, { login: "o", name: "Dev & Co (lab)" }), "wol cert request 3 o o. Dev '&' Co '(lab)'");
  assert.equal(command({ id: 3, login: "o" }, { login: "o", name: "a;rm" }), "wol cert request 3 o o. 'a;rm'");
});
test("the Worker's dashboard sends the same words the page uses (the ids are numbers)", () => {
  assert.match(command({ id: 9910002, login: "examplelabs", org: true }, {}), /^wol cert request 9910002 examplelabs examplelabs\. examplelabs --org$/);
});
