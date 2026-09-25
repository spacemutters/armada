"use client";

import { useMountedInBrowser } from "@/components/fx";

/** "Today, 6:30 PM", "Tomorrow, 9:00 AM", "Thu, 6:30 PM", or "Tue, Oct 6, 6:30 PM", in the viewer's own time zone. */
export function formatLocal(d: Date, now = new Date()): string {
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Tomorrow, ${time}`;
  if (diff === -1) return `Yesterday, ${time}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })}, ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

/**
 * A moment shown in the viewer's own time. The server doesn't know the viewer's time zone, so the
 * words appear once the page is running in the browser (a still placeholder until then).
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const mounted = useMountedInBrowser();
  const d = new Date(iso);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {mounted ? formatLocal(d) : "      "}
    </time>
  );
}
