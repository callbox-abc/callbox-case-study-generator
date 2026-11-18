"use client";

import { useRef, useState } from "react";
import { MAX_FACTS, mergeFacts, type RevampCaseStudy } from "@/lib/revamp";
import { box, btn, input, readJson } from "@/components/revamp/CallboxOneImport";

type Candidate = { companyId: string; name: string; domain: string; location: string; deals: number; firstDeal: string | null };

const post = (body: unknown) =>
  fetch("/api/hubspot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => readJson(res, "HubSpot"));

// "Import client from HubSpot": client facts from Callbox's own HubSpot portal (industry, HQ,
// company size, client since, program growth). Fills client name and country only when empty.
export default function HubSpotImport({
  up,
  sheet,
}: {
  up: (fn: (d: RevampCaseStudy) => void) => void;
  sheet: Pick<RevampCaseStudy, "facts" | "clientName" | "country">;
}) {
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const [q, setQ] = useState(sheet.clientName);
  const [results, setResults] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState<"" | "search" | "import">("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState(false);

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy("search");
    setMsg("");
    setErr(false);
    try {
      const json = await post({ step: "search", q: q.trim() });
      setResults(json.clients || []);
      if (!json.clients?.length) setMsg("No HubSpot company with deals matches that name. Try a shorter name, e.g. the first word.");
    } catch (e: any) {
      setErr(true);
      setMsg(e?.message || "Search failed.");
    } finally {
      setBusy("");
    }
  };

  const importClient = async (c: Candidate) => {
    setBusy("import");
    setErr(false);
    setMsg(`Reading ${c.name} from HubSpot…`);
    try {
      const json = await post({ step: "client", companyId: c.companyId });
      const now = sheetRef.current;
      const { dropped } = mergeFacts(now.facts, json.facts);
      up((d) => {
        d.facts = mergeFacts(d.facts, json.facts).facts;
        if (!d.clientName.trim() && json.company.name) d.clientName = json.company.name;
        if (!d.country.trim() && json.company.country) d.country = json.company.country;
      });

      const kept: string[] = [];
      if (now.country.trim() && json.company.country && now.country.trim() !== json.company.country) {
        kept.push(`country (HubSpot says ${json.company.country})`);
      }
      if (now.clientName.trim() && json.company.name && now.clientName.trim() !== json.company.name) {
        kept.push(`client name (HubSpot says ${json.company.name})`);
      }
      setMsg(
        `Imported ${json.facts.length} client fact${json.facts.length === 1 ? "" : "s"} from ${json.company.name || c.name}. ` +
          (kept.length ? `Kept the sheet's ${kept.join(" and ")}. ` : "") +
          (dropped.length ? `Left out to stay within ${MAX_FACTS} facts: ${dropped.join(", ")}. ` : "") +
          (json.notes || []).join(" ")
      );
    } catch (e: any) {
      setErr(true);
      setMsg(e?.message || "Import failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="app-toolbar" style={box}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <b style={{ color: "#f5f5f7" }}>Import client from HubSpot</b>
        <input
          id="hs-search"
          aria-label="Client company name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Client company, e.g. Netrix"
          style={{ ...input, flex: "1 1 240px" }}
        />
        <button style={btn} onClick={search} disabled={busy !== ""}>
          {busy === "search" ? "Searching…" : "Search"}
        </button>
      </div>

      {results.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {results.map((c) => (
            <button
              key={c.companyId}
              onClick={() => importClient(c)}
              disabled={busy !== ""}
              style={{ ...btn, textAlign: "left", display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}
            >
              <span>
                <b>{c.name}</b>
                {c.domain ? ` · ${c.domain}` : ""}
                {c.location ? ` · ${c.location}` : ""}
              </span>
              <span style={{ color: "#a4a4ae" }}>
                {c.deals} deal{c.deals === 1 ? "" : "s"}
                {c.firstDeal ? ` · first ${c.firstDeal}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {msg && <div style={{ marginTop: 10, color: err ? "#fca5a5" : "#c7c8d3" }}>{msg}</div>}
    </div>
  );
}
