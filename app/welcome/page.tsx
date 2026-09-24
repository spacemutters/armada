import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { PasskeySignIn } from "@/components/passkey-sign-in";
import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Sign in" };

export default async function WelcomePage() {
  if (await getSession()) redirect("/");
  return (
    <AuthFrame title="Sign in" body="Use the passkey you made on this device, or pick your phone when your browser asks.">
      <PasskeySignIn />
      <p className="mt-8 text-[13px] text-muted">New here? Open the setup link you were sent. It makes your passkey in one step.</p>
    </AuthFrame>
  );
}
