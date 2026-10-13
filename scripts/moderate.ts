import { config } from "dotenv";
import { createSql } from "../lib/db";
import {
  deleteUserPlace, listForReview, listRevisions, purgePassword, restoreEntry, revertTo, revertToPrevious, setStatus,
} from "../lib/moderation";
import type { EntryStatus } from "../lib/types";

config();

const USAGE = `Usage:
  npm run moderate -- list [hidden|pending|active ...]
  npm run moderate -- approve <entryId>     set status to active
  npm run moderate -- hide <entryId>        set status to hidden
  npm run moderate -- restore <entryId>     set active and delete its reports
  npm run moderate -- history <entryId>     show revisions (passwords masked)
  npm run moderate -- revert <entryId> [revisionId]   go back to the previous revision, or to a revision id from history
  npm run moderate -- delete-place <placeId>          delete a place that a user added, with its entries
  npm run moderate -- purge-password <entryId>        remove the password from the entry and all its revisions`;

const [cmd, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = createSql(url);

function idArg(i = 0): number {
  const id = Number(args[i]);
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
      console.log(args[1] === undefined
        ? await revertToPrevious(sql, idArg())
        : await revertTo(sql, idArg(), idArg(1)));
      break;
    case "delete-place":
      console.log((await deleteUserPlace(sql, idArg())) ? "deleted" : "not found (or not a user place)");
      break;
    case "purge-password": {
      const id = idArg();
      const r = await purgePassword(sql, id);
      console.log(r.status === "purged" ? "purged" : "not found");
      if (r.status === "purged" && r.stepsHadPassword) {
        console.log(`Warning: the steps text still contains the password. Hide the entry (hide ${id}) or edit its steps in the app.`);
      }
      break;
    }
    default:
      console.error(USAGE);
      process.exitCode = 1;
  }
} finally {
  await sql.end();
}
