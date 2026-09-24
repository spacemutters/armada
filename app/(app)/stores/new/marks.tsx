import type { SVGProps } from "react";

// Armada's own marks for where a store sells: simple line drawings on one 24-unit grid, one stroke
// weight, drawn in the text colour so they follow light and dark. Not the platforms' logos: a bag
// for your own website store, a price tag for a marketplace listing, a shop inside a phone for a
// social shop, and a storefront drawn in dashes for a pretend one.

type MarkProps = SVGProps<SVGSVGElement> & { size?: number };

function Frame({ size = 28, children, ...rest }: MarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Your own website store (Shopify). */
export function WebsiteStoreMark(props: MarkProps) {
  return (
    <Frame {...props}>
      <path d="M5.2 8.5h13.6l-1.1 11.2a1.5 1.5 0 0 1-1.5 1.3H7.8a1.5 1.5 0 0 1-1.5-1.3L5.2 8.5Z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
    </Frame>
  );
}

/** A marketplace listing (eBay). */
export function MarketplaceMark(props: MarkProps) {
  return (
    <Frame {...props}>
      <path d="M3.5 12.3V4.8c0-.7.6-1.3 1.3-1.3h7.5c.4 0 .7.1.9.4l7.3 7.3c.5.5.5 1.3 0 1.8l-7.5 7.5c-.5.5-1.3.5-1.8 0l-7.3-7.3a1.3 1.3 0 0 1-.4-.9Z" />
      <circle cx="8" cy="8" r="1.4" />
      <path d="M10.5 15.5l5-5" />
    </Frame>
  );
}

/** A shop inside a phone (Facebook and Instagram). */
export function SocialShopMark(props: MarkProps) {
  return (
    <Frame {...props}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.8" />
      <path d="M9.4 10.5h5.2l-.5 5a.9.9 0 0 1-.9.8h-2.4a.9.9 0 0 1-.9-.8l-.5-5Z" />
      <path d="M10.9 10.5v-.7a1.1 1.1 0 0 1 2.2 0v.7" />
      <path d="M11 19h2" />
    </Frame>
  );
}

/** A pretend storefront (practice). */
export function PracticeMark(props: MarkProps) {
  return (
    <Frame {...props}>
      <path d="M4 9.5 5.6 4.5h12.8L20 9.5" />
      <path d="M4 9.5a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" />
      <path d="M5.5 12.5v8h13v-8" strokeDasharray="2 2.4" />
      <path d="M10 20.5v-4h4v4" strokeDasharray="2 2.4" />
    </Frame>
  );
}
