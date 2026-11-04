// SPDX-License-Identifier: GPL-2.0-or-later
// Where things are: the site folder, a path inside it, and the public address.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const at = (...p) => resolve(ROOT, ...p);
export const ORIGIN = "https://hub.wolos.org";
