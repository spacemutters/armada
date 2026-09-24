import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";

export default function NotFound() {
  return (
    <AuthFrame title="Nothing here" body="That page doesn't exist, or the link is out of date.">
      <Link href="/" className="text-accent underline underline-offset-2">
        Back to Armada
      </Link>
    </AuthFrame>
  );
}
