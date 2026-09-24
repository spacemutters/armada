import "server-only";
import { cache } from "react";
import { asSystem } from "@/lib/db";

/**
 * Whether this member is a platform admin (armada.members.is_admin), checked once per request.
 * Set only by scripts/make-admin.mjs. The nav can use this to decide whether to show the Admin link.
 */
export const isPlatformAdmin = cache(async (memberId: string): Promise<boolean> => {
  const rows = await asSystem((tx) => tx<{ isAdmin: boolean }[]>`select is_admin from armada.members where id = ${memberId}`);
  return rows[0]?.isAdmin === true;
});
