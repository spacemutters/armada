import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { asSystem } from "@/lib/db";

/** Whether this member is a platform admin (armada.members.is_admin): only they see the Stripe connection. */
export const isBillingAdmin = cache(async (memberId: string): Promise<boolean> => {
  const rows = await asSystem((tx) => tx<{ isAdmin: boolean }[]>`select is_admin from armada.members where id = ${memberId}`);
  return rows[0]?.isAdmin === true;
});

// A one-time note for the next /billing page ("Stripe is connected", or what Stripe refused).
// The words ride in a short-lived cookie the server sets, and the page shows them only when the
// address carries the same note id, so a link can't put words on the page and a reload later won't
// repeat them.

const NOTE_COOKIE = "armada_billing_note";

export interface BillingNote {
  id: string;
  tone: "ok" | "error";
  text: string;
}

/** Saves a note and returns its id, for the redirect's ?note= */
export async function leaveNote(tone: BillingNote["tone"], text: string): Promise<string> {
  const id = crypto.randomUUID().slice(0, 8);
  const store = await cookies();
  store.set(NOTE_COOKIE, Buffer.from(JSON.stringify({ id, tone, text: text.slice(0, 600) })).toString("base64url"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/billing",
    maxAge: 120,
  });
  return id;
}

export async function readNote(id: string | undefined): Promise<BillingNote | null> {
  if (!id) return null;
  const raw = (await cookies()).get(NOTE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const note = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as BillingNote;
    if (note.id !== id || (note.tone !== "ok" && note.tone !== "error") || typeof note.text !== "string") return null;
    return note;
  } catch {
    return null;
  }
}
