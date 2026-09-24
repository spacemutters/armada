import type { ReactNode } from "react";

/** The quiet frame around sign-in and setup. */
export function AuthFrame({ title, body, children }: { title: string; body: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <FleetMark />
          <span className="text-[17px] font-semibold tracking-tight">Armada</span>
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 mb-8 text-muted">{body}</p>
        {children}
      </div>
    </main>
  );
}

export function FleetMark({ size = 22 }: { size?: number }) {
  const cells = [1, 0.55, 0.3, 0.55, 1, 0.55, 0.3, 0.55, 1];
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
      {cells.map((o, i) => (
        <rect key={i} x={(i % 3) * 7.5} y={Math.floor(i / 3) * 7.5} width="6" height="6" rx="1.5" fill="currentColor" opacity={o} />
      ))}
    </svg>
  );
}
