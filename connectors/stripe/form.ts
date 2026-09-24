// Stripe takes request bodies form-encoded, with nested fields in brackets:
//   { line_items: [{ price: "p", quantity: 1 }], metadata: { a: "b" } }
//   -> line_items[0][price]=p&line_items[0][quantity]=1&metadata[a]=b
// Arrays are indexed ([0], [1], ...), which Stripe accepts for lists of values and lists of objects.
// null and undefined are left out; booleans become "true"/"false".
//
// Pure: no imports, so the offline check can load it.

export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };
export type FormParams = { [key: string]: FormValue };

/** The [name, value] pairs a params object turns into, in order. */
export function formPairs(params: FormParams): [string, string][] {
  const pairs: [string, string][] = [];
  const walk = (name: string, value: FormValue) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${name}[${i}]`, item));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(`${name}[${k}]`, v);
      return;
    }
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${name} is not a finite number`);
    pairs.push([name, String(value)]);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return pairs;
}

/** The body (or query string) for a Stripe request. */
export function formEncode(params: FormParams): string {
  return new URLSearchParams(formPairs(params)).toString();
}
