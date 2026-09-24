// The shop builder takes a country in plain words; suppliers want two-letter codes.
const CODES: [RegExp, string, string][] = [
  [/^(us|usa|united states|america|united states of america)$/i, "US", "United States"],
  [/^(uk|gb|great britain|united kingdom|england|britain)$/i, "GB", "United Kingdom"],
  [/^(ca|canada)$/i, "CA", "Canada"],
  [/^(au|australia)$/i, "AU", "Australia"],
  [/^(nz|new zealand)$/i, "NZ", "New Zealand"],
  [/^(de|germany|deutschland)$/i, "DE", "Germany"],
  [/^(fr|france)$/i, "FR", "France"],
  [/^(es|spain)$/i, "ES", "Spain"],
  [/^(it|italy)$/i, "IT", "Italy"],
  [/^(nl|netherlands|holland)$/i, "NL", "Netherlands"],
  [/^(ie|ireland)$/i, "IE", "Ireland"],
  [/^(se|sweden)$/i, "SE", "Sweden"],
  [/^(dk|denmark)$/i, "DK", "Denmark"],
  [/^(no|norway)$/i, "NO", "Norway"],
  [/^(fi|finland)$/i, "FI", "Finland"],
  [/^(be|belgium)$/i, "BE", "Belgium"],
  [/^(at|austria)$/i, "AT", "Austria"],
  [/^(ch|switzerland)$/i, "CH", "Switzerland"],
  [/^(pt|portugal)$/i, "PT", "Portugal"],
  [/^(pl|poland)$/i, "PL", "Poland"],
  [/^(mx|mexico)$/i, "MX", "Mexico"],
  [/^(jp|japan)$/i, "JP", "Japan"],
  [/^(sg|singapore)$/i, "SG", "Singapore"],
  [/^(ae|uae|united arab emirates)$/i, "AE", "United Arab Emirates"],
];

/** The two-letter code for a country Armada knows, or null. */
export function knownCountryCode(name: string): string | null {
  const t = name.trim();
  return CODES.find(([re]) => re.test(t))?.[1] ?? null;
}

/** The names people can type, for the builder's suggestions. */
export const COUNTRY_NAMES = CODES.map(([, , n]) => n);

/**
 * The code for a country, falling back to the US. Only for places where a guess is harmless; real
 * shipping quotes must use knownCountryCode and refuse an unknown country instead.
 */
export function countryCode(name: string): string {
  const t = name.trim();
  return CODES.find(([re]) => re.test(t))?.[1] ?? "US";
}

export function countryName(codeOrName: string): string {
  const t = codeOrName.trim();
  return CODES.find(([re, code]) => re.test(t) || code === t.toUpperCase())?.[2] ?? t;
}
