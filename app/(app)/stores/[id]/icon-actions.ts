"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { makeStoreIcon, setStoreIcon } from "@/lib/stores/icon";

const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** Viewers can look, not change. */
async function editor() {
  const session = await requireSession();
  if (session.role === "viewer") redirect("/stores");
  return session;
}

export async function chooseIconAction(storeId: string, formData: FormData) {
  const session = await editor();
  const icon = String(formData.get("icon") ?? "");
  if (uuid(storeId)) await setStoreIcon(session.workspaceId, storeId, icon === "none" ? null : icon);
  redirect(`/stores/${storeId}#icon`);
}

export async function makeIconAction(storeId: string) {
  const session = await editor();
  if (uuid(storeId)) await makeStoreIcon(session.workspaceId, storeId);
  redirect(`/stores/${storeId}#icon`);
}
