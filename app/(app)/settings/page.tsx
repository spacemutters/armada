import { headers } from "next/headers";
import { setShopContactEmail, makeDeviceLink, makeTeamInvite, removePasskey, renameWorkspace, setPasswordAction } from "./actions";
import { PasswordInput } from "@/components/password-input";
import { Button, ButtonLink, Field, inputClass, PageHeader, Section, StatusPill } from "@/components/ui";
import { helperStatus } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";
import { timeAgo } from "@/lib/text";
import { workspaceContactEmail } from "@/lib/shops/contact";

export const metadata = { title: "Settings" };

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
  const [helper, data, h, contact] = await Promise.all([
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
    workspaceContactEmail(session.workspaceId),
  ]);
  const canSetContact = session.role === "owner" || session.role === "manager";
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

        <Section title="Shop contact email" className="scroll-mt-6">
          <form id="contact" action={setShopContactEmail} className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1">
              <span className="text-[13px] text-muted">Shoppers of your real shops write to this</span>
              <input
                name="supportEmail"
                type="email"
                autoComplete="email"
                defaultValue={contact.set ? (contact.email ?? "") : ""}
                placeholder={contact.email ?? "you@yourshop.com"}
                maxLength={200}
                className={`${inputClass} mt-1`}
                disabled={!canSetContact}
              />
            </label>
            {canSetContact ? (
              <Button type="submit" variant="secondary">
                Save
              </Button>
            ) : null}
          </form>
          <p className="mt-2 text-[13px] text-muted">
            {sp.contact === "bad"
              ? "That doesn't look like an email address."
              : sp.contact === "saved"
                ? "Saved."
                : contact.set
                  ? null
                  : contact.email
                    ? `Using your sign-in email, ${contact.email}, until you set one.`
                    : "Real shops take payments once this is set."}
          </p>
        </Section>

        <Section title="AI helper" className="scroll-mt-6">
          <div id="ai" className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-[14px] text-muted">
              Runs on your computer with your own sign-ins. It can only send text and pictures back to Armada.
            </p>
            <StatusPill tone={helper.online ? "ok" : "off"}>{helper.online ? (helper.busy ? "Working" : "On") : "Off"}</StatusPill>
          </div>
          <p className="mt-2 text-[13px] text-muted">Last checked in {timeAgo(helper.lastSeenAt)}.</p>
        </Section>

        <Section title="Connections" className="scroll-mt-6">
          <div id="connections" className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-[14px] text-muted">
              Stores, suppliers and ad accounts, each in one press.
            </p>
            <ButtonLink href="/connections" variant="secondary">
              Open Connections
            </ButtonLink>
          </div>
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
                  <PasswordInput name="currentPassword" autoComplete="current-password" required maxLength={256} className="min-h-11" />
                </Field>
              ) : null}
              <Field label="New password" hint="At least 12 characters. A short sentence is easy to remember and hard to guess.">
                <PasswordInput name="newPassword" autoComplete="new-password" required minLength={12} maxLength={256} className="min-h-11" />
              </Field>
              <Field label="New password again">
                <PasswordInput name="confirmPassword" autoComplete="new-password" required minLength={12} maxLength={256} className="min-h-11" />
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
