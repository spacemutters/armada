/** Joins class names, skipping the empty ones. Plain code, safe in server and client components. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
