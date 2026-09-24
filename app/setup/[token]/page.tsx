import { AuthFrame } from "@/components/auth-frame";
import { PasskeySetup } from "@/components/passkey-setup";
import { asSystem } from "@/lib/db";
import { findOpenInvite } from "@/lib/auth/invites";

export const metadata = { title: "Set up" };

export default async function SetupPage({ params }: PageProps<"/setup/[token]">) {
  const { token } = await params;
  const invite = token.length >= 20 ? await asSystem((tx) => findOpenInvite(tx, token)) : null;

  if (!invite) {
    return (
      <AuthFrame title="This link has run out" body="Setup links work once and expire after a few days. Ask for a new one.">
        <a href="/welcome" className="text-accent underline underline-offset-2">
          Go to sign in
        </a>
      </AuthFrame>
    );
  }

  const firstOwner = !invite.workspaceId && !invite.memberId;
  const addingDevice = Boolean(invite.memberId);
  return (
    <AuthFrame
      title={addingDevice ? "Add this device" : firstOwner ? "Welcome to Armada" : "Join the fleet"}
      body={
        addingDevice
          ? "Make a passkey on this device so you can sign in here too."
          : "You'll sign in with a passkey: your fingerprint, face or device PIN. No password to remember."
      }
    >
      <PasskeySetup token={token} firstOwner={firstOwner} addingDevice={addingDevice} />
    </AuthFrame>
  );
}
