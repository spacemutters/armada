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
];

export function countryCode(name: string): string {
  const t = name.trim();
  return CODES.find(([re]) => re.test(t))?.[1] ?? "US";
}

export function countryName(codeOrName: string): string {
  const t = codeOrName.trim();
  return CODES.find(([re, code]) => re.test(t) || code === t.toUpperCase())?.[2] ?? t;
}
