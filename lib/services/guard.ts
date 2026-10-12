import type { Actor } from "@/lib/types";

export type WriteAction = "submit_entry" | "edit_entry" | "create_place" | "vote" | "report";

/**
 * The future guard point. Every user write calls authorize() first.
 * To require sign-in or roles later, change the Guard in lib/services/index.ts. Throw to refuse.
 */
export interface Guard {
  authorize(actor: Actor, action: WriteAction): void | Promise<void>;
}

/** Today everyone may write. Rate limits still apply. */
export const anonymousGuard: Guard = {
  authorize() {},
};
