import type { ReactNode } from "react";

// A deliberately small markdown renderer for AI-written pages. It escapes everything (React does
// that for us) and supports only headings, paragraphs, lists, bold, italics and web links, so
// nothing in a supplier description or an AI answer can inject markup into a storefront.

function inline(text: string, key: string, vars?: Record<string, string>): ReactNode[] {
  const withVars = vars ? text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => vars[k] ?? m) : text;
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(withVars))) {
    if (m.index > last) out.push(withVars.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) out.push(<strong key={`${key}-${i++}`}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) out.push(<em key={`${key}-${i++}`}>{token.slice(1, -1)}</em>);
    else {
      const label = token.slice(1, token.indexOf("]"));
      const href = token.slice(token.indexOf("(") + 1, -1);
      out.push(
        <a key={`${key}-${i++}`} href={href} rel="nofollow noopener" target={href.startsWith("http") ? "_blank" : undefined}>
          {label}
        </a>,
      );
    }
    last = m.index + token.length;
  }
  if (last < withVars.length) out.push(withVars.slice(last));
  return out;
}

export function Markdown({ text, vars, className }: { text: string; vars?: Record<string, string>; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let k = 0;

  const flushPara = () => {
    if (para.length) blocks.push(<p key={k++}>{inline(para.join(" "), `p${k}`, vars)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, j) => <li key={j}>{inline(it, `l${k}-${j}`, vars)}</li>);
    blocks.push(list.ordered ? <ol key={k++}>{items}</ol> : <ul key={k++}>{items}</ul>);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const content = inline(heading[2], `h${k}`, vars);
      blocks.push(level === 1 ? <h2 key={k++}>{content}</h2> : level === 2 ? <h3 key={k++}>{content}</h3> : <h4 key={k++}>{content}</h4>);
    } else if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className={className ?? "prose-armada"}>{blocks}</div>;
}
