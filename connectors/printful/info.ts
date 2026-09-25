import type { ConnectorInfo } from "@/lib/connections/types";

// Printful (print on demand) as a supplier. Connected in one press through the connection service,
// which has its own approved Printful app; Armada needs no app of its own there.
export const printfulInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "printful",
  name: "Printful",
  kind: "supplier",
  blurb: "Your designs printed on shirts, mugs and posters, made and shipped for you.",
  method: "redirect",
  requiredEnv: [],
  ownerSetup: "Connects through the connection service (Pipedream). Nothing to set up here.",
  // Only ever through the connection service.
  available: () => false,
};
