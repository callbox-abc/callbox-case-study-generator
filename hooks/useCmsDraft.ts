// "Send to CMS as draft": maps the current case study into the revamp layout and creates
// (or updates) one WordPress draft. The page id is kept so repeat sends update the same draft.

import { useRef, useState, type MutableRefObject } from "react";
import type { RevampCaseStudy } from "@/lib/revamp";
import { exportable } from "@/lib/unbranded";
import type { ImportSource } from "@/components/revamp/DataImport";

export type CmsState = "idle" | "sending" | "done" | "error";

export function useCmsDraft({
  cs,
  importSourceRef,
  saveSheetNow,
  saveMappingExample,
}: {
  cs: RevampCaseStudy;
  importSourceRef: MutableRefObject<ImportSource | null>;
  saveSheetNow: () => Promise<boolean>;
  saveMappingExample: () => void;
}) {
  const [cmsState, setCmsState] = useState<CmsState>("idle");
  const [cmsMsg, setCmsMsg] = useState("");
  const [cmsLink, setCmsLink] = useState("");
  const cmsPageIdRef = useRef<number | null>(null);

  const sendToCms = async () => {
    setCmsState("sending");
    try {
      setCmsMsg("Creating the WordPress draft…");
      const draftRes = await fetch("/api/cms/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revamp: exportable(cs), pageId: cmsPageIdRef.current }),
      });
      const draftJson = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftJson.error || "Could not create the draft.");

      cmsPageIdRef.current = draftJson.id;
      void saveSheetNow(); // what went to the CMS is what the shared copy should hold
      // Show the draft next to the client in "Recently imported clients", so nobody makes a second one.
      // An unbranded draft is kept apart from the client's branded one.
      if (importSourceRef.current) {
        fetch("/api/recent-clients?step=draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: importSourceRef.current.key, id: draftJson.id, editLink: draftJson.editLink, ...(cs.unbranded ? { unbranded: true } : {}) }),
        }).catch(() => {});
      }
      setCmsLink(draftJson.editLink);
      const missing: string[] = draftJson.missingAcfKeys || [];
      const parent = draftJson.parent || {};
      const where =
        parent.status === "set"
          ? ` Placed under “${parent.title}”.`
          : parent.status === "notFound"
            ? " No parent page was set: the success stories page wasn't found, so set the parent in WordPress."
            : "";
      setCmsMsg(
        (missing.length
          ? `Draft #${draftJson.id} saved, but these fields were not stored: ${missing.join(", ")}.`
          : `Draft #${draftJson.id} saved. Review it in WordPress before publishing.`) + where
      );
      setCmsState("done");
      saveMappingExample();
    } catch (e: any) {
      setCmsMsg(e?.message || "Something went wrong.");
      setCmsState("error");
    }
  };

  // A new client gets its own CMS draft.
  const resetCms = () => {
    cmsPageIdRef.current = null;
    setCmsState("idle");
    setCmsMsg("");
    setCmsLink("");
  };

  return { cmsState, cmsMsg, cmsLink, cmsPageIdRef, sendToCms, resetCms };
}
