// SPDX-License-Identifier: GPL-2.0-or-later
// Markdown files are bundled as text (wrangler.toml rules; Bun with `with { type: "text" }`).
declare module "*.md" {
  const text: string;
  export default text;
}
