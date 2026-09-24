import { headers } from "next/headers";
import { connectCjAction, disconnectCjAction, makeDeviceLink, makeTeamInvite, removePasskey, renameWorkspace, setPasswordAction } from "./actions";
import { Button, Field, inputClass, PageHeader, Section, StatusPill } from "@/components/ui";
import { cjStatus } from "@/connectors/cj/client";
import { helperStatus } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";
import { timeAgo } from "@/lib/text";

export const metadata = { title: "Settings" };

const CONNECTIONS = [
  { name: "Shopify", needs: "Your Shopify partner account (sign-up 4). Then each store connects with one approval screen." },
  { name: "eBay", needs: "Your eBay developer account (sign-up 5). Then each eBay account connects by signing in to eBay once." },
  { name: "CJ Dropshipping", needs: "Your CJ account's API key (sign-up 6). It unlocks the real supplier catalog and automatic ordering." },
  { name: "Meta ads", needs: "Business Verification and App Review (sign-up 1)." },
  { name: "Google ads", needs: "Brand verification in Google Cloud (sign-up 3)." },
  { name: "TikTok ads", needs: "A TikTok developer profile and app (sign-up 2)." },
];

// What the Password form's result codes (from setPasswordAction) say to the member.
const PASSWORD_MESSAGES: Record<string, string> = {
  reload: "Something went wrong. Reload the page and try again.",
  email: "Enter the email address you'll sign in with.",
  short: "Use at least 12 characters. A short sentence is easy to remember.",
  long: "Use 256 characters or fewer.",
  mismatch: "The two new passwords don't match. Type them again.",
  current: "Enter your current password.",
  wrong: "Your current password isn't right.",
  locked: "Too many wrong tries. Wait 15 minutes and try again.",
  taken: "That email can't be used here. Try a different one.",
};

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const session = await requireSession();
  const sp = await searchParams;
  const [helper, data, h, cj] = await Promise.all([
    helperStatus(),
    withWorkspace(session.workspaceId, async (tx) => {
      const passkeys = await tx<{ id: string; deviceLabel: string | null; createdAt: Date; lastUsedAt: Date | null }[]>`
        select id, device_label, created_at, last_used_at from armada.passkeys where member_id = ${session.memberId} order by created_at`;
      const members = await tx<{ id: string; displayName: string; role: string }[]>`
        select id, display_name, role from armada.members order by created_at`;
      const [me] = await tx<{ email: string | null; hasPassword: boolean; passwordChangedAt: Date | null }[]>`
        select email, password_hash is not null as has_password, password_changed_at from armada.members where id = ${session.memberId}`;
      return { passkeys, members, me };
    }),
    headers(),
    cjStatus(session.workspaceId),
  ]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const link = typeof sp.link === "string" ? `${proto}://${host}/setup/${sp.link}` : null;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex max-w-3xl flex-col gap-4">
        <Section title="Your fleet">
          <form action={renameWorkspace} className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1">
              <span className="text-[13px] text-muted">Name</span>
              <input name="name" defaultValue={session.workspaceName} maxLength={60} className={`${inputClass} mt-1`} disabled={session.role !== "owner"} />
            </label>
            {session.role === "owner" ? (
              <Button type="submit" variant="secondary">
                Save
              </Button>
            ) : null}
          </form>
          {sp.saved ? <p className="mt-2 text-[13px] text-positive">Saved.</p> : null}
        </Section>

        <Section title="AI helper" className="scroll-mt-6">
          <div id="ai" className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-[14px] text-muted">
              Shops and product copy are written by the AI helper on your computer, using your own Claude login. It can only write text back to
              Armada: it has no access to your files and can&apos;t run anything.
            </p>
            <StatusPill tone={helper.online ? "ok" : "off"}>{helper.online ? (helper.busy ? "Working" : "On") : "Off"}</StatusPill>
          </div>
          <p className="mt-2 text-[13px] text-muted">Last checked in {timeAgo(helper.lastSeenAt)}.</p>
        </Section>

        <Section title="Connections" className="scroll-mt-6">
          <ul id="connections" className="flex flex-col divide-y divide-line">
            {CONNECTIONS.map((c) =>
              c.name === "CJ Dropshipping" ? (
                <li key={c.name} className="flex flex-col gap-3 py-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">CJ Dropshipping</div>
                      <p className="text-[13px] text-muted">
                        {cj.connected
                          ? `Connected${cj.meta.account ? ` as ${cj.meta.account}` : ""}${cj.meta.isSandbox ? " (a CJ test account)" : ""}. The shop builder and product search use CJ's real catalog, costs and shipping.`
                          : "Unlocks the real supplier catalog, real costs and shipping times, and automatic ordering."}
                      </p>
                      {cj.status === "needs_attention" && cj.meta.lastError ? <p className="mt-1 text-[13px] text-attention">{cj.meta.lastError}</p> : null}
                    </div>
                    <StatusPill tone={cj.connected ? (cj.status === "needs_attention" ? "attention" : "ok") : "off"}>
                      {cj.connected ? (cj.status === "needs_attention" ? "Needs you" : "Connected") : "Not connected"}
                    </StatusPill>
                  </div>
                  {cj.connected ? (
                    session.role === "owner" ? (
                      <form action={disconnectCjAction}>
                        <Button type="submit" variant="quiet">
                          Disconnect CJ
                        </Button>
                      </form>
                    ) : null
                  ) : (
                    <form action={connectCjAction} className="flex flex-col gap-2 rounded-xl bg-sunken p-4">
                      <label htmlFor="cj-key" className="text-[13px]">
                        In CJ, open Authorization, then API, press Add API and copy the key. Paste it here.
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <input id="cj-key" name="apiKey" type="password" autoComplete="off" spellCheck={false} className={`${inputClass} min-w-0 flex-1`} placeholder="Your CJ key" />
                        <Button type="submit">Connect CJ</Button>
                      </div>
                      <p className="text-[12px] text-muted">Armada checks the key with CJ, then keeps it encrypted. You can disconnect any time.</p>
                    </form>
                  )}
                  {typeof sp.cj === "string" ? (
                    <p role="status" className={`text-[13px] ${sp.cj === "ok" ? "text-positive" : "text-negative"}`}>
                      {sp.cj === "ok" ? "CJ is connected." : sp.cj}
                    </p>
                  ) : null}
                </li>
              ) : (
                <li key={c.name} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.name}</div>
                    <p className="text-[13px] text-muted">{c.needs}</p>
                  </div>
                  <StatusPill tone="off">Not connected</StatusPill>
                </li>
              ),
            )}
          </ul>
        </Section>

        <Section title="Your devices" className="scroll-mt-6">
          <ul id="devices" className="flex flex-col divide-y divide-line">
            {data.passkeys.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.deviceLabel ?? "A device"}</span>
                  <span className="block text-[13px] text-muted">
                    Added {timeAgo(p.createdAt)} · last used {timeAgo(p.lastUsedAt)}
                  </span>
                </span>
                {data.passkeys.length > 1 ? (
                  <form action={removePasskey.bind(null, p.id)}>
                    <Button type="submit" variant="quiet">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          <form action={makeDeviceLink} className="mt-3">
            <Button type="submit" variant="secondary">
              Add another device
            </Button>
          </form>
          {link && sp.for === "device" ? (
            <p className="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-[13px]">
              Open this link on the other device within 24 hours. It works once.
              <span className="mt-1 block font-mono break-all select-all">{link}</span>
            </p>
          ) : null}
        </Section>

        <Section title="Password" className="scroll-mt-6">
          <div id="password" className="flex flex-col gap-4">
            <p className="max-w-xl text-[14px] text-muted">
              {data.me?.email ? (
                <>
                  Your sign-in email is <span className="font-medium text-ink">{data.me.email}</span>.{" "}
                  {data.me.hasPassword
                    ? `You can sign in with it and your password. Password last changed ${timeAgo(data.me.passwordChangedAt)}.`
                    : "Set a password to sign in with it when your passkey isn't handy."}
                </>
              ) : (
                "Add your email and a password so you can sign in without your passkey."
              )}
            </p>
            <form action={setPasswordAction} className="flex max-w-md flex-col gap-4">
              {data.me?.email ? (
                // Lets password managers save the new password under the right email.
                <input type="email" name="username" autoComplete="username" value={data.me.email} readOnly hidden />
              ) : (
                <Field label="Email">
                  <input name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required maxLength={254} className={`${inputClass} min-h-11`} />
                </Field>
              )}
              {data.me?.hasPassword ? (
                <Field label="Current password">
                  <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} className={`${inputClass} min-h-11`} />
                </Field>
              ) : null}
              <Field label="New password" hint="At least 12 characters. A short sentence is easy to remember and hard to guess.">
                <input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={256} className={`${inputClass} min-h-11`} />
              </Field>
              <Field label="New password again">
                <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={256} className={`${inputClass} min-h-11`} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="secondary" className="min-h-11">
                  {data.me?.hasPassword ? "Change password" : "Set password"}
                </Button>
                {data.me?.hasPassword ? <span className="text-[13px] text-muted">This signs you out on your other devices.</span> : null}
              </div>
            </form>
            {sp.pw === "ok" ? (
              <p role="status" className="text-[13px] text-positive">
                Password saved.
              </p>
            ) : typeof sp.pw === "string" && Object.hasOwn(PASSWORD_MESSAGES, sp.pw) ? (
              <p role="alert" className="text-[13px] text-negative">
                {PASSWORD_MESSAGES[sp.pw]}
              </p>
            ) : null}
          </div>
        </Section>

        <Section title="Team" className="scroll-mt-6">
          <ul id="team" className="flex flex-col divide-y divide-line">
            {data.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2.5">
                <span className="font-medium">{m.displayName}</span>
                <span className="text-[13px] text-muted">{m.role === "owner" ? "Owner" : m.role === "manager" ? "Manager" : m.role === "assistant" ? "Assistant" : "Viewer"}</span>
              </li>
            ))}
          </ul>
          {session.role === "owner" ? (
            <form action={makeTeamInvite} className="mt-3 flex flex-wrap items-center gap-2">
              <select name="role" defaultValue="assistant" className="min-h-10 rounded-xl border border-line-strong bg-raised px-3" aria-label="Their role">
                <option value="manager">Manager: can approve changes, orders and ads</option>
                <option value="assistant">Assistant: can prepare changes for approval</option>
                <option value="viewer">Viewer: can look, not change</option>
              </select>
              <Button type="submit" variant="secondary">
                Make an invite link
              </Button>
            </form>
          ) : null}
          {link && sp.for === "team" ? (
            <p className="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-[13px]">
              Send this to your teammate. It works once and expires in 3 days.
              <span className="mt-1 block font-mono break-all select-all">{link}</span>
            </p>
          ) : null}
        </Section>

        <details className="rounded-2xl border border-line bg-raised p-5">
          <summary className="cursor-pointer text-[15px] font-semibold">Advanced</summary>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[13px] text-muted">
            <dt>Workspace</dt>
            <dd className="font-mono">{session.workspaceId}</dd>
            <dt>AI helper</dt>
            <dd>{helper.online ? "Online" : "Offline"}, polling for jobs every 2 seconds</dd>
            <dt>Data</dt>
            <dd>Walled-off section of a shared database, with row-level security per workspace</dd>
          </dl>
        </details>
      </div>
    </>
  );
}
