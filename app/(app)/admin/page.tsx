import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isPlatformAdmin } from "./access";
import { Card, PageHeader, Section, Stat, StatusPill, type Tone } from "@/components/ui";
import { helperStatus } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";
import { asSystem } from "@/lib/db";
import { clip, timeAgo } from "@/lib/text";

export const metadata = { title: "Admin", robots: { index: false, follow: false } };

// Everything across every fleet, for platform admins only. Look only: nothing on this page changes anything.

const ROLE: Record<string, string> = { owner: "Owner", manager: "Manager", assistant: "Assistant", viewer: "Viewer" };

const JOB_STATUS: Record<string, { tone: Tone; label: string }> = {
  queued: { tone: "off", label: "Waiting" },
  running: { tone: "working", label: "Working" },
  done: { tone: "ok", label: "Done" },
  failed: { tone: "error", label: "Failed" },
};

const JOB_KIND: Record<string, string> = {
  "shop.concept": "Shop idea and look",
  "shop.products": "Shop products",
  "shop.pages": "Shop pages",
  "ab.variants": "Headline ideas",
};

const ACTION: Record<string, string> = {
  signed_in_password: "Signed in with a password",
  "password.set": "Set a password",
  "password.changed": "Changed their password",
  "passkey.added": "Added a passkey",
  "admin.created": "Was made a platform admin (new fleet)",
  "admin.updated": "Was made a platform admin",
  "practice.fleet_created": "Started a practice fleet",
  "shops.build_started": "Started building shops",
  "shop.published_practice": "Published a practice shop",
  "change.applied": "Applied a change",
  "change.undone": "Undid a change",
  "orders.sent_to_supplier": "Sent orders to the supplier",
  "cj.connected": "Connected CJ",
  "ebay.account_deletion": "Got an eBay account-deletion notice",
  "test.started": "Started a headline test",
  "test.finished": "Finished a headline test",
  "test.undone": "Put back the original headline",
};

function day(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function describeDetail(detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  const parts = Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return clip(parts.join(" · "), 140);
}

interface WorkspaceRow {
  id: string;
  name: string;
  createdAt: Date;
  members: number;
  shops: number;
  stores: number;
}
interface MemberRow {
  id: string;
  displayName: string;
  email: string | null;
  role: string;
  isAdmin: boolean;
  hasPassword: boolean;
  workspaceName: string;
  passkeys: number;
  lastSignIn: Date | null;
}
interface JobRow {
  id: string;
  kind: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  error: string | null;
  attempts: number;
  workspaceName: string;
}
interface AuditRow {
  id: string;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: Date;
  workspaceName: string | null;
  memberName: string | null;
}

export default async function AdminPage() {
  const session = await requireSession();
  if (!(await isPlatformAdmin(session.memberId))) notFound();

  const [helper, data] = await Promise.all([
    helperStatus(),
    asSystem(async (tx) => {
      const workspaces = await tx<WorkspaceRow[]>`
        select w.id, w.name, w.created_at,
               (select count(*)::int from armada.members m where m.workspace_id = w.id) as members,
               (select count(*)::int from armada.shops s where s.workspace_id = w.id) as shops,
               (select count(*)::int from armada.stores s where s.workspace_id = w.id) as stores
        from armada.workspaces w
        order by w.created_at desc
        limit 200`;
      const members = await tx<MemberRow[]>`
        select m.id, m.display_name, m.email, m.role, m.is_admin, m.password_hash is not null as has_password,
               w.name as workspace_name,
               (select count(*)::int from armada.passkeys p where p.member_id = m.id) as passkeys,
               greatest(
                 (select max(p.last_used_at) from armada.passkeys p where p.member_id = m.id),
                 (select max(a.created_at) from armada.audit_log a where a.member_id = m.id and a.action = 'signed_in_password')
               ) as last_sign_in
        from armada.members m join armada.workspaces w on w.id = m.workspace_id
        order by m.created_at desc
        limit 500`;
      const jobs = await tx<JobRow[]>`
        select j.id, j.kind, j.status, j.created_at, j.finished_at, j.error, j.attempts, w.name as workspace_name
        from armada.ai_jobs j join armada.workspaces w on w.id = j.workspace_id
        order by j.created_at desc
        limit 30`;
      const jobCounts = await tx<{ status: string; n: number }[]>`
        select status, count(*)::int as n from armada.ai_jobs group by status`;
      const audit = await tx<AuditRow[]>`
        select a.id::text as id, a.action, a.detail, a.created_at, w.name as workspace_name, m.display_name as member_name
        from armada.audit_log a
        left join armada.workspaces w on w.id = a.workspace_id
        left join armada.members m on m.id = a.member_id
        order by a.created_at desc
        limit 40`;
      const [tries] = await tx<{ ok: number; wrong: number; locked: number }[]>`
        select count(*) filter (where outcome = 'ok')::int as ok,
               count(*) filter (where outcome = 'wrong')::int as wrong,
               count(*) filter (where outcome = 'locked')::int as locked
        from armada.login_attempts
        where at > now() - interval '24 hours'`;
      return { workspaces, members, jobs, jobCounts, audit, tries };
    }),
  ]);

  const count = (status: string) => data.jobCounts.find((c) => c.status === status)?.n ?? 0;

  return (
    <>
      <PageHeader title="Admin" subtitle="Every fleet on Armada in one place. This page only shows things; nothing here changes anything." />
      <div className="flex flex-col gap-4">
        <Card className="grid grid-cols-2 gap-6 p-5 md:grid-cols-4">
          <Stat label="Fleets" value={data.workspaces.length} />
          <Stat label="People" value={data.members.length} />
          <Stat
            label="AI jobs waiting"
            value={count("queued")}
            hint={`${count("running")} working · ${count("failed")} failed in total`}
            tone={count("failed") > 0 ? "attention" : undefined}
          />
          <Stat
            label="Password sign-ins, 24 hours"
            value={data.tries.ok}
            hint={`${data.tries.wrong} wrong · ${data.tries.locked} refused after too many tries`}
            tone={data.tries.locked > 0 ? "attention" : undefined}
          />
        </Card>

        <Section title="Fleets">
          <Table head={["Fleet", "People>", "Shops>", "Stores>", "Started>"]} minWidth={560} empty="No fleets yet.">
            {data.workspaces.map((w) => (
              <tr key={w.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3 font-medium">{w.name}</td>
                <td className="tabular px-3 py-3 text-right">{w.members}</td>
                <td className="tabular px-3 py-3 text-right">{w.shops}</td>
                <td className="tabular px-3 py-3 text-right">{w.stores}</td>
                <td className="px-5 py-3 text-right text-muted">{day(w.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section title="People">
          <Table head={["Name", "Email", "Role", "Fleet", "Passkeys>", "Password>", "Last sign-in>"]} minWidth={860} empty="Nobody yet.">
            {data.members.map((m) => (
              <tr key={m.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3">
                  <span className="font-medium">{m.displayName}</span>
                  {m.isAdmin ? <span className="ml-2 text-[12px] text-muted">Admin</span> : null}
                </td>
                <td className="px-3 py-3 break-all">{m.email ?? <span className="text-muted">None</span>}</td>
                <td className="px-3 py-3">{ROLE[m.role] ?? m.role}</td>
                <td className="px-3 py-3">{m.workspaceName}</td>
                <td className="tabular px-3 py-3 text-right">{m.passkeys}</td>
                <td className="px-3 py-3 text-right">{m.hasPassword ? "Yes" : <span className="text-muted">No</span>}</td>
                <td className="px-5 py-3 text-right text-muted">{m.lastSignIn ? timeAgo(m.lastSignIn) : "Not known"}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-[13px] text-muted">Last sign-in counts passkey and password sign-ins that Armada has a record of.</p>
        </Section>

        <Section
          title="AI helper"
          action={<StatusPill tone={helper.online ? "ok" : "off"}>{helper.online ? (helper.busy ? "Working" : "On") : "Off"}</StatusPill>}
        >
          <p className="mb-4 text-[14px] text-muted">
            {helper.online ? "The helper on your computer is checking in." : "The helper on your computer isn't checking in, so AI jobs wait."} Last checked
            in {timeAgo(helper.lastSeenAt)}.
          </p>
          {data.jobs.length === 0 ? (
            <p className="text-[14px] text-muted">No AI jobs yet.</p>
          ) : (
            <ul className="-mx-5 flex flex-col divide-y divide-line border-t border-line">
              {data.jobs.map((j) => {
                const st = JOB_STATUS[j.status] ?? { tone: "off" as Tone, label: j.status };
                return (
                  <li key={j.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{JOB_KIND[j.kind] ?? j.kind}</div>
                      <div className="text-[13px] text-muted">
                        {j.workspaceName} · asked {timeAgo(j.createdAt)}
                        {j.finishedAt ? ` · finished ${timeAgo(j.finishedAt)}` : ""}
                        {j.attempts > 1 ? ` · ${j.attempts} tries` : ""}
                      </div>
                      {j.error ? <div className="mt-1 text-[13px] break-words text-negative">{clip(j.error, 200)}</div> : null}
                    </div>
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Recent activity">
          {data.audit.length === 0 ? (
            <p className="text-[14px] text-muted">Nothing yet.</p>
          ) : (
            <ul className="-mx-5 flex flex-col divide-y divide-line border-t border-line">
              {data.audit.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <div>
                    <span className="font-medium">{a.memberName ?? "Armada"}</span> {(ACTION[a.action] ?? a.action).replace(/^./, (c) => c.toLowerCase())}
                  </div>
                  <div className="text-[13px] text-muted">
                    {a.workspaceName ?? "No fleet"} · {timeAgo(a.createdAt)}
                    {describeDetail(a.detail) ? ` · ${describeDetail(a.detail)}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

/** A table that scrolls sideways inside its card on narrow screens. Headings ending in ">" line up right. */
function Table({ head, minWidth, empty, children }: { head: string[]; minWidth: number; empty: string; children: ReactNode[] }) {
  if (children.length === 0) return <p className="text-[14px] text-muted">{empty}</p>;
  return (
    <div className="-mx-5 overflow-x-auto border-t border-line">
      <table className="w-full text-left text-[14px]" style={{ minWidth }}>
        <thead className="text-[12px] text-muted">
          <tr className="border-b border-line">
            {head.map((h, i) => {
              const right = h.endsWith(">");
              const pad = i === 0 || i === head.length - 1 ? "px-5" : "px-3";
              return (
                <th key={h} scope="col" className={`py-3 font-medium ${pad} ${right ? "text-right" : ""}`}>
                  {right ? h.slice(0, -1) : h}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
