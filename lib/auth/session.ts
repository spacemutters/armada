import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { asSystem } from "@/lib/db";
import type { Role } from "@/lib/types";

const SESSION_COOKIE = "armada_session";
const CHALLENGE_COOKIE = "armada_challenge";
const SESSION_DAYS = 30;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export interface Session {
  memberId: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  name: string;
}

export async function startSession(memberId: string, sessionVersion: number): Promise<void> {
  const token = await new SignJWT({ v: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(memberId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** The signed-in member for this request, or null. Checked against the database once per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let memberId: string;
  let version: number;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.v !== "number") return null;
    memberId = payload.sub;
    version = payload.v;
  } catch {
    return null;
  }
  const rows = await asSystem(
    (tx) => tx<
      { id: string; workspaceId: string; displayName: string; role: Role; sessionVersion: number; workspaceName: string }[]
    >`
      select m.id, m.workspace_id, m.display_name, m.role, m.session_version, w.name as workspace_name
      from armada.members m join armada.workspaces w on w.id = m.workspace_id
      where m.id = ${memberId}`,
  );
  const m = rows[0];
  if (!m || m.sessionVersion !== version) return null;
  return { memberId: m.id, workspaceId: m.workspaceId, workspaceName: m.workspaceName, role: m.role, name: m.displayName };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/welcome");
  return session;
}

// A passkey ceremony's challenge rides in a short-lived signed cookie between its two requests.
export interface Challenge {
  challenge: string;
  kind: "register" | "login";
  inviteId?: string;
}

export async function saveChallenge(c: Challenge): Promise<void> {
  const token = await new SignJWT({ ...c })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .sign(secret());
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth",
    maxAge: 300,
  });
}

export async function takeChallenge(kind: Challenge["kind"]): Promise<Challenge | null> {
  const store = await cookies();
  const token = store.get(CHALLENGE_COOKIE)?.value;
  store.delete({ name: CHALLENGE_COOKIE, path: "/api/auth" });
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.kind !== kind || typeof payload.challenge !== "string") return null;
    return {
      challenge: payload.challenge,
      kind,
      inviteId: typeof payload.inviteId === "string" ? payload.inviteId : undefined,
    };
  } catch {
    return null;
  }
}
