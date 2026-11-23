"use client";

// The import panel's search box. Clicking it (or the arrow) opens a dropdown of active clients:
// HubSpot companies with a contact whose Lead Status is "Active Client" (lib/hubspot.ts
// activeClients), 10 at a time, most recently updated first. Typing filters the whole list by name
// or website; Enter on a highlighted client picks it, otherwise Enter searches as before.

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Client } from "@/components/revamp/DataImport";
import { Logo } from "@/components/revamp/TopClients";

const SHOWN = 10;

const field: React.CSSProperties = {
  padding: "8px 34px 8px 12px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "#191a1e",
  color: "#f5f5f7",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
const muted: React.CSSProperties = { color: "#a4a4ae", fontSize: 12 };

// The list is the same for everyone and changes slowly: loaded once per page.
let loaded: Promise<Client[]> | null = null;
function loadActiveClients(): Promise<Client[]> {
  loaded ??= fetch("/api/hubspot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "active" }) })
    .then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      return (j?.clients || []) as Client[];
    })
    .catch((e) => {
      loaded = null; // let the next open try again
      throw e;
    });
  return loaded;
}

export function matchesClient(c: Pick<Client, "name" | "domain">, q: string): boolean {
  const t = q.trim().toLowerCase();
  return !t || c.name.toLowerCase().includes(t) || c.domain.toLowerCase().includes(t);
}

export default function ClientSearchBox({
  value,
  onChange,
  onSearch,
  onPick,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSearch: () => void; // Enter without a highlighted client
  onPick: (c: Client) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1); // highlighted option
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open || clients) return;
    let live = true;
    setError("");
    loadActiveClients()
      .then((cs) => live && setClients(cs))
      .catch((e) => live && setError(e?.message || "Could not load active clients."));
    return () => {
      live = false;
    };
  }, [open, clients]);

  const all = clients ?? [];
  const matching = all.filter((c) => matchesClient(c, value));
  const shown = matching.slice(0, SHOWN);
  useEffect(() => setActive(-1), [value, open]);

  const pick = (c: Client) => {
    setOpen(false);
    onPick(c);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (shown.length) setActive((i) => (i + 1) % shown.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length) setActive((i) => (i <= 0 ? shown.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (disabled) return;
      if (open && active >= 0 && shown[active]) pick(shown[active]);
      else {
        setOpen(false);
        onSearch();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;
  return (
    <div style={{ position: "relative", flex: "1 1 240px", minWidth: 0 }}>
      <input
        ref={inputRef}
        id="import-search"
        aria-label="Client name or campaign code"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="Client or campaign code, e.g. Netrix or NETRIX"
        style={field}
      />
      <button
        type="button"
        aria-label={open ? "Hide active clients" : "Show active clients"}
        title="Active clients"
        // Keeps the input focused, so its blur doesn't close the list before the toggle runs.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
        style={{
          position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent",
          color: "#a4a4ae", cursor: "pointer", padding: 4, display: "grid", placeItems: "center",
        }}
      >
        <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Active clients"
          // A click inside the list must not blur the input first (that would close the list).
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 40, maxHeight: "min(520px, 70vh)", overflowY: "auto",
            background: "#232429", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            padding: 6,
          }}
        >
          <div style={{ ...muted, padding: "4px 8px 6px" }}>
            {error ? (
              <span style={{ color: "#fca5a5" }}>Couldn&apos;t load active clients: {error}</span>
            ) : !clients ? (
              "Loading active clients from HubSpot…"
            ) : value.trim() && matching.length !== all.length ? (
              `Active clients · ${matching.length} of ${all.length} match`
            ) : (
              `Active clients · Lead Status “Active Client” in HubSpot · ${all.length}${all.length > SHOWN ? `, type to filter` : ""}`
            )}
          </div>
          {clients && !shown.length && (
            <div style={{ ...muted, padding: "6px 8px 8px" }}>
              No active client matches “{value.trim()}”. Press Enter to search every client in HubSpot and CallboxOne.
            </div>
          )}
          {shown.map((c, i) => (
            <div
              key={c.companyId}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              aria-disabled={disabled || undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => !disabled && pick(c)}
              style={{
                display: "flex", gap: 10, alignItems: "center", padding: "7px 8px", borderRadius: 6,
                cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
                background: i === active ? "rgba(245,185,20,0.1)" : "transparent",
              }}
            >
              <Logo name={c.name} domain={c.domain} size={28} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", color: "#f5f5f7", fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.name}
                </span>
                <span style={{ ...muted, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[c.domain, c.location].filter(Boolean).join(" · ") || "no website or location on record"}
                </span>
              </span>
              <span style={{ ...muted, flex: "0 0 auto" }}>
                {c.deals} deal{c.deals === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
