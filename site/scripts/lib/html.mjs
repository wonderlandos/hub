// SPDX-License-Identifier: GPL-2.0-or-later
// Escaping, and the small formatting helpers the templates share.
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "3 November 2026" from epoch seconds, in UTC so a build gives the same page anywhere. */
export function day(sec) {
  const d = new Date(sec * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** "March 2026" from "2026-03". */
export function monthYear(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : String(ym);
}
export function bytes(n) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
