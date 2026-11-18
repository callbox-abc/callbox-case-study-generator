// One saved import per client + campaign pair. Shared by the server (lib/recentClients.ts) and
// the browser (DataImport), without pulling server code into the browser bundle.
export const recentKey = (clientAccountId?: number | null, companyId?: string | null) =>
  `recent:${clientAccountId || "-"}:${companyId || "-"}`;
