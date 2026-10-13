import { getSql } from "@/lib/db";
import { anonymousGuard } from "./guard";
import { createSubmissionService } from "./submission";

/** To require sign-in later, replace anonymousGuard here. */
export function submissionService() {
  return createSubmissionService({ sql: getSql(), guard: anonymousGuard });
}
