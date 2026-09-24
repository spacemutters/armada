// Browsers still ask for /favicon.ico on their own; point them at the real icon.
export function GET(request: Request) {
  return Response.redirect(new URL("/icon.svg", request.url), 308);
}
