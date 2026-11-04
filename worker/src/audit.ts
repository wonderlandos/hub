// SPDX-License-Identifier: GPL-2.0-or-later
import { now } from "./env";

export type ActorKind = "person" | "github" | "pipeline" | "system";

export function audit(db: D1Database, actorKind: ActorKind, actorId: string | number | null, action: string,
  target: string | null, detail: Record<string, unknown> = {}): D1PreparedStatement {
  return db.prepare("INSERT INTO audit_log (at, actor_kind, actor_id, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(now(), actorKind, actorId === null ? null : String(actorId), action, target, JSON.stringify(detail));
}
