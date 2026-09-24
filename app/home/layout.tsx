import type { ReactNode } from "react";
import { Archivo, Familjen_Grotesk, Work_Sans } from "next/font/google";
import "./home.css";

// The homepage's display face. Archivo's width axis lets the headings sit a little wide, like the
// lettering on a chart or a hull; body text stays in the system face the app itself uses.
const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--mk-font-display",
  display: "swap",
});

// The two faces the example shop ("Alcove") was given by the builder, so its preview is shown in its
// own fonts. Not preloaded: they are only needed further down the page.
const shopDisplay = Familjen_Grotesk({ subsets: ["latin"], variable: "--mk-font-shop-display", display: "swap", preload: false });
const shopBody = Work_Sans({ subsets: ["latin"], variable: "--mk-font-shop-body", display: "swap", preload: false });

export default function HomeLayout({ children }: { children: ReactNode }) {
  return <div className={`mk ${display.variable} ${shopDisplay.variable} ${shopBody.variable}`}>{children}</div>;
}
