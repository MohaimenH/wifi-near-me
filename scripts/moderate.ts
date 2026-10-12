import { config } from "dotenv";
import { createSql } from "../lib/db";
import { listForReview, listRevisions, restoreEntry, revertToPrevious, setStatus } from "../lib/moderation";
import type { EntryStatus } from "../lib/types";

config();

const USAGE = `Usage:
  npm run moderate -- list [hidden|pending|active ...]
  npm run moderate -- approve <entryId>     set status to active
  npm run moderate -- hide <entryId>        set status to hidden
  npm run moderate -- restore <entryId>     set active and delete its reports
  npm run moderate -- history <entryId>     show revisions (passwords masked)
  npm run moderate -- revert <entryId>      go back to the previous revision`;

const [cmd, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = createSql(url);

function idArg(): number {
  const id = Number(args[0]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error(USAGE);
    process.exit(1);
  }
  return id;
}

try {
  switch (cmd) {
    case "list": {
      const statuses = (args.length ? args : ["hidden", "pending"]) as EntryStatus[];
      console.table(await listForReview(sql, statuses));
      break;
    }
    case "approve":
      console.log((await setStatus(sql, idArg(), "active")) ? "approved" : "not found");
      break;
    case "hide":
      console.log((await setStatus(sql, idArg(), "hidden")) ? "hidden" : "not found");
      break;
    case "restore":
      console.log((await restoreEntry(sql, idArg())) ? "restored" : "not found");
      break;
    case "history":
      for (const r of await listRevisions(sql, idArg())) {
        const snap = { ...r.snapshot, password: r.snapshot.password ? "(set)" : null };
        console.log(r.id, r.created_at.toISOString(), r.submitter_id ?? r.device_hash?.slice(0, 8) ?? "-", JSON.stringify(snap));
      }
      break;
    case "revert":
      console.log(await revertToPrevious(sql, idArg()));
      break;
    default:
      console.error(USAGE);
      process.exitCode = 1;
  }
} finally {
  await sql.end();
}
