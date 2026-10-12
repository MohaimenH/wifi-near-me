import { config, type Config } from "@/lib/config";
import type { Sql } from "@/lib/db";
import { NotFoundError, RateLimitedError } from "@/lib/errors";
import { consume, LIMITS, type Limits } from "@/lib/rate-limit";
import { clearRevisionPasswords } from "@/lib/repo/revisions";
import type { AccessType, Actor, EntryStatus, Language, PasswordPolicy } from "@/lib/types";
import {
  entryEditSchema, entryInputSchema, placeInputSchema, reportReasonSchema, voteKindSchema, type EntryInput,
} from "@/lib/validation";
import type { Guard } from "./guard";

interface Deps {
  sql: Sql;
  guard: Guard;
  cfg?: Config;
  limits?: Limits;
}

interface Content {
  label: string;
  access_type: AccessType;
  steps_text: string;
  language: Language;
  password: string | null;
  password_policy: PasswordPolicy;
}

export function createSubmissionService(deps: Deps) {
  const { sql, guard } = deps;
  const cfg = deps.cfg ?? config();
  const limits = deps.limits ?? LIMITS;

  async function limit(actor: Actor, action: keyof Limits): Promise<void> {
    const l = limits[action];
    if (!(await consume(sql, actor.ipHash, action, l.limit, l.windowSeconds))) throw new RateLimitedError();
  }

  async function writeRevision(tx: Sql, entryId: number, c: Content, actor: Actor): Promise<void> {
    await tx`
      INSERT INTO wifi_entry_revisions (wifi_entry_id, snapshot, submitter_id, device_hash, ip_hash)
      VALUES (${entryId}, ${JSON.stringify(c)}::text::jsonb, ${actor.userId}, ${actor.deviceHash}, ${actor.ipHash})`;
  }

  async function insertEntry(tx: Sql, placeId: number, e: EntryInput, actor: Actor, status: EntryStatus): Promise<number> {
    const c: Content = {
      label: e.label, access_type: e.access_type, steps_text: e.steps_text, language: e.language,
      password: e.password, password_policy: e.password && e.password_is_public ? "posted_publicly" : "none",
    };
    const [row] = await tx`
      INSERT INTO wifi_entries
        (place_id, label, access_type, steps_text, language, password, password_policy, status, submitter_id)
      VALUES
        (${placeId}, ${c.label}, ${c.access_type}, ${c.steps_text}, ${c.language}, ${c.password}, ${c.password_policy}, ${status}, ${actor.userId})
      RETURNING id`;
    await writeRevision(tx, row.id as number, c, actor);
    return row.id as number;
  }

  async function activeEntryExists(entryId: number): Promise<boolean> {
    return (await sql`SELECT 1 FROM wifi_entries WHERE id = ${entryId} AND status = 'active'`).length > 0;
  }

  return {
    async submitEntry(actor: Actor, placeId: number, raw: unknown) {
      await guard.authorize(actor, "submit_entry");
      const e = entryInputSchema.parse(raw);
      if (e.website) return { ignored: true as const };
      await limit(actor, "submit");
      if ((await sql`SELECT 1 FROM places WHERE id = ${placeId}`).length === 0) throw new NotFoundError();
      const entryId = await sql.begin((tx) => insertEntry(tx as unknown as Sql, placeId, e, actor, cfg.newEntryStatus));
      return { ignored: false as const, entry_id: entryId };
    },

    async editEntry(actor: Actor, entryId: number, raw: unknown) {
      await guard.authorize(actor, "edit_entry");
      const e = entryEditSchema.parse(raw);
      if (e.website) return { ignored: true as const };
      await limit(actor, "edit");
      await sql.begin(async (tx0) => {
        const tx = tx0 as unknown as Sql;
        const [cur] = await tx`
          SELECT password, password_policy FROM wifi_entries WHERE id = ${entryId} AND status = 'active' FOR UPDATE`;
        if (!cur) throw new NotFoundError();
        let password: string | null = cur.password;
        let policy: PasswordPolicy = cur.password_policy;
        if (e.password_clear) {
          password = null;
          policy = "none";
        } else if (e.password) {
          password = e.password;
          policy = e.password_is_public ? "posted_publicly" : "none";
        }
        const c: Content = {
          label: e.label, access_type: e.access_type, steps_text: e.steps_text, language: e.language,
          password, password_policy: policy,
        };
        await tx`
          UPDATE wifi_entries
          SET label = ${c.label}, access_type = ${c.access_type}, steps_text = ${c.steps_text},
              language = ${c.language}, password = ${c.password}, password_policy = ${c.password_policy},
              updated_at = clock_timestamp()
          WHERE id = ${entryId}`;
        // "Remove the saved password" must also remove the copies in the edit history.
        if (e.password_clear) await clearRevisionPasswords(tx, entryId);
        await writeRevision(tx, entryId, c, actor);
      });
      return { ignored: false as const, entry_id: entryId };
    },

    async createPlace(actor: Actor, rawPlace: unknown, rawEntry: unknown) {
      await guard.authorize(actor, "create_place");
      const p = placeInputSchema.parse(rawPlace);
      const e = entryInputSchema.parse(rawEntry);
      if (e.website) return { ignored: true as const };
      await limit(actor, "create_place");
      return sql.begin(async (tx0) => {
        const tx = tx0 as unknown as Sql;
        const [row] = await tx`
          INSERT INTO places (name, category, geom, source)
          VALUES (${p.name}, ${p.category},
                  ST_SetSRID(ST_MakePoint(${p.lng}::float8, ${p.lat}::float8), 4326)::geography, 'user')
          RETURNING id`;
        const entryId = await insertEntry(tx, row.id as number, e, actor, cfg.newEntryStatus);
        return { ignored: false as const, place_id: row.id as number, entry_id: entryId };
      });
    },

    async castVote(actor: Actor, entryId: number, rawKind: unknown) {
      await guard.authorize(actor, "vote");
      const kind = voteKindSchema.parse(rawKind);
      await limit(actor, "vote");
      if (!(await activeEntryExists(entryId))) throw new NotFoundError();
      await sql`
        INSERT INTO votes (wifi_entry_id, device_hash, ip_hash, kind)
        VALUES (${entryId}, ${actor.deviceHash}, ${actor.ipHash}, ${kind})
        ON CONFLICT (wifi_entry_id, device_hash)
        DO UPDATE SET kind = EXCLUDED.kind, ip_hash = EXCLUDED.ip_hash, created_at = now()`;
      const [c] = await sql`
        SELECT count(*) FILTER (WHERE kind = 'works') AS works, count(*) FILTER (WHERE kind = 'broken') AS broken
        FROM votes WHERE wifi_entry_id = ${entryId}`;
      return { works: c.works as number, broken: c.broken as number };
    },

    async reportEntry(actor: Actor, entryId: number, rawReason: unknown) {
      await guard.authorize(actor, "report");
      const reason = reportReasonSchema.parse(rawReason);
      await limit(actor, "report");
      if (!(await activeEntryExists(entryId))) throw new NotFoundError();
      await sql`
        INSERT INTO reports (wifi_entry_id, device_hash, ip_hash, reason)
        VALUES (${entryId}, ${actor.deviceHash}, ${actor.ipHash}, ${reason})
        ON CONFLICT (wifi_entry_id, device_hash) DO NOTHING`;
      const [{ devices, ips }] = await sql`
        SELECT count(DISTINCT device_hash) AS devices, count(DISTINCT ip_hash) AS ips
        FROM reports WHERE wifi_entry_id = ${entryId}`;
      const hide = (devices as number) >= cfg.reportHideThreshold && (ips as number) >= cfg.reportHideMinIps;
      if (hide) {
        await sql`UPDATE wifi_entries SET status = 'hidden', updated_at = now() WHERE id = ${entryId} AND status = 'active'`;
      }
      return { hidden: hide };
    },
  };
}

export type SubmissionService = ReturnType<typeof createSubmissionService>;
