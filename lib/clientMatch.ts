// Does a saved sheet belong to the client it is stored under? Sheets saved while an old bug merged
// two clients (e.g. Logitech's header saved into Derevo's entry) name another client; those are
// ignored on load instead of being restored. Shared by the browser and tests (no server code).

const GENERIC = new Set([
  "inc", "llc", "ltd", "pty", "corp", "co", "group", "global", "holdings", "company", "solutions",
  "technologies", "technology", "systems", "services", "international", "the", "and", "callbox",
]);

const tokens = (t: string | null | undefined) =>
  String(t || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));

// True unless the sheet's client name clearly names someone else: no distinctive word in common
// with the client's names (HubSpot company, CallboxOne client, campaign code letters). An empty
// client name, or a client with no usable names, always matches.
export function sheetMatchesClient(sheetClientName: string, clientNames: (string | null | undefined)[]): boolean {
  const sheet = tokens(sheetClientName);
  if (!sheet.length) return true;
  const known = clientNames.flatMap(tokens);
  if (!known.length) return true;
  return sheet.some((w) => known.some((k) => k === w || k.startsWith(w) || w.startsWith(k)));
}

// Letters at the start of a campaign code: NETRIX25071 -> "NETRIX".
export const codeLetters = (code: string | null | undefined) => /^[A-Za-z]+/.exec(String(code || ""))?.[0] ?? "";
