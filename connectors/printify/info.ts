import type { ConnectorInfo } from "@/lib/connections/types";

// Printify (print on demand) as a supplier. Connected in one press through the connection service,
// which has its own approved Printify app; Armada needs no app of its own there.
export const printifyInfo: ConnectorInfo & { available: () => boolean } = {
  provider: "printify",
  name: "Printify",
  kind: "supplier",
  blurb: "Print on demand from printers near your buyers.",
  method: "redirect",
  requiredEnv: [],
  ownerSetup: "Connects through the connection service (Pipedream). Nothing to set up here.",
  // Only ever through the connection service.
  available: () => false,
};
