import Link from "next/link";
import type { ReactNode } from "react";
import { BATCH, ROLES } from "./sample";

// The homepage's quiet parts: navigation, section heads, the batch strip and the footer.
// Server components; nothing here needs the browser.

export function Wordmark() {
  const cells = [1, 0.55, 0.3, 0.55, 1, 0.55, 0.3, 0.55, 1];
  return (
    <span className="mk-wordmark">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        {cells.map((o, i) => (
          <rect key={i} x={(i % 3) * 7.5} y={Math.floor(i / 3) * 7.5} width="6" height="6" rx="1.5" fill="currentColor" opacity={o} />
        ))}
      </svg>
      Armada
    </span>
  );
}

const SECTIONS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#builder", label: "Shop builder" },
  { href: "#products", label: "Products" },
  { href: "#tests", label: "Tests" },
];

export function SiteNav() {
  return (
    <header className="mk-nav">
      <div className="mk-wrap mk-nav-row">
        <a href="#top" className="mk-nav-home" aria-label="Armada, back to the top">
          <Wordmark />
        </a>
        <nav aria-label="On this page" className="mk-nav-links">
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href}>
              {s.label}
            </a>
          ))}
        </nav>
        <Link href="/welcome" className="mk-btn mk-btn-primary mk-btn-nav">
          Sign in
        </Link>
      </div>
    </header>
  );
}

export function SectionHead({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mk-head">
      <p className="mk-eyebrow">{eyebrow}</p>
      <h2 id={id} className="mk-h1">
        {title}
      </h2>
      {children ? <div className="mk-head-body">{children}</div> : null}
    </div>
  );
}

/** Ten shops from one idea, each with its own look: page colour, ink and button, brand set in its own width. */
export function BatchStrip() {
  const widths = [100, 125, 75, 112, 88, 118, 94, 106, 70, 100];
  return (
    <figure className="mk-batch">
      <ul className="mk-batch-grid" aria-label="Example batch of ten shops">
        {BATCH.map((b, i) => (
          <li key={b.brand} style={{ background: b.page, color: b.ink }}>
            <span className="mk-batch-name" style={{ fontVariationSettings: `"wdth" ${widths[i]}` }}>
              {b.brand}
            </span>
            <span className="mk-batch-lines" aria-hidden>
              <i />
              <i />
            </span>
            <span className="mk-batch-btn" style={{ background: b.button }} aria-hidden />
          </li>
        ))}
      </ul>
      <figcaption className="mk-caption">One idea, a batch of ten: each shop gets its own name, colours and fonts. Example.</figcaption>
    </figure>
  );
}

export function RoleList() {
  return (
    <ul className="mk-roles">
      {ROLES.map((r) => (
        <li key={r.name}>
          <span className="mk-role">{r.name}</span>
          <span className="mk-muted">{r.does}</span>
        </li>
      ))}
    </ul>
  );
}

export function SiteFooter() {
  return (
    <footer className="mk-footer">
      <div className="mk-wrap mk-footer-row">
        <div className="mk-footer-brand">
          <Wordmark />
          <p className="mk-muted">Run many online shops from one screen.</p>
        </div>
        <nav aria-label="Footer" className="mk-footer-links">
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href}>
              {s.label}
            </a>
          ))}
          <Link href="/welcome">Sign in</Link>
        </nav>
      </div>
      <div className="mk-wrap mk-footer-small mk-muted">
        <span>© {new Date().getFullYear()} Armada</span>
        <span>Every store, order and number on this page is an example.</span>
      </div>
    </footer>
  );
}
