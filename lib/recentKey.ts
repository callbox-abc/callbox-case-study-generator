// One saved entry per campaign; an import with no campaign (HubSpot only) gets one per company.
// The key does not depend on whether HubSpot matched the campaign, so an entry saved before the
// match and one saved after it are the same entry. Shared by the server (lib/recentClients.ts) and
// the browser (DataImport), without pulling server code into the browser bundle.
export const recentKey = (clientAccountId?: number | null, companyId?: string | null) =>
  clientAccountId ? `recent:${clientAccountId}` : `recent:-:${companyId || "-"}`;

// Keys from before (recent:<campaign>:<company>) name the same entry as recent:<campaign>.
const LEGACY = /^recent:(\d+):[^:]*$/;
export const isLegacyRecentKey = (key: string) => LEGACY.test(key);
export const canonicalRecentKey = (key: string) => {
  const m = LEGACY.exec(key);
  return m ? `recent:${m[1]}` : key;
};
