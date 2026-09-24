import "server-only";

/** The passkey "relying party" is whatever host Armada is being served from. */
export function relyingParty(request: Request): { rpID: string; origin: string; rpName: string } {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? url.host;
  const proto = forwardedProto ?? url.protocol.replace(":", "");
  const hostname = host.split(":")[0];
  return { rpID: hostname, origin: `${proto}://${host}`, rpName: "Armada" };
}
