export type SolutionService = { title: string; desc: string };
export type Phase = { phase: string; steps: string[] };
export type Metric = { value: string; label: string };

export type CaseStudy = {
  title: string;
  industry: string;
  targetIndustries: string;
  program: string;
  targetLocation: string;
  duration: string;
  targetProspects: string;
  businessSize: string;
  clientLocation: string;
  keyHighlights: string[];
  challenge: string;
  programGoals: string[];
  solutionIntro: string;
  solutionServices: SolutionService[];
  howItRan: Phase[];
  metrics: Metric[];
};

export const EMPTY_CASE: CaseStudy = {
  title: "",
  industry: "",
  targetIndustries: "",
  program: "",
  targetLocation: "",
  duration: "",
  targetProspects: "",
  businessSize: "",
  clientLocation: "",
  keyHighlights: ["", "", ""],
  challenge: "",
  programGoals: ["", "", ""],
  solutionIntro: "",
  solutionServices: [
    { title: "", desc: "" },
    { title: "", desc: "" },
    { title: "", desc: "" },
    { title: "", desc: "" },
  ],
  howItRan: [
    { phase: "", steps: [""] },
    { phase: "", steps: [""] },
  ],
  metrics: [
    { value: "", label: "" },
    { value: "", label: "" },
    { value: "", label: "" },
    { value: "", label: "" },
  ],
};

export const FIELD_LABELS: Record<string, string> = {
  industry: "Industry",
  targetIndustries: "Target Industries",
  program: "Program",
  targetLocation: "Target Location",
  duration: "Duration",
  targetProspects: "Target Prospects",
  businessSize: "Target Business Size",
  clientLocation: "Location",
};

export function mergeMapped(parsed: Partial<CaseStudy>): CaseStudy {
  return {
    ...EMPTY_CASE,
    ...parsed,
    keyHighlights: parsed.keyHighlights?.length ? parsed.keyHighlights : EMPTY_CASE.keyHighlights,
    programGoals: parsed.programGoals?.length ? parsed.programGoals : EMPTY_CASE.programGoals,
    solutionServices: parsed.solutionServices?.length ? parsed.solutionServices : EMPTY_CASE.solutionServices,
    howItRan: parsed.howItRan?.length ? parsed.howItRan : EMPTY_CASE.howItRan,
    metrics: parsed.metrics?.length ? parsed.metrics : EMPTY_CASE.metrics,
  };
}

export function buildPlainText(cs: CaseStudy): string {
  let x = (cs.title || "Untitled Case Study").toUpperCase() + "\n" + "=".repeat(50) + "\n\n";
  x += "CLIENT SNAPSHOT\n";
  Object.keys(FIELD_LABELS).forEach((k) => {
    const v = (cs as any)[k];
    if (v) x += FIELD_LABELS[k] + ": " + v + "\n";
  });
  x += "\n";
  const highlights = cs.keyHighlights.filter(Boolean);
  if (highlights.length) {
    x += "KEY HIGHLIGHTS\n";
    highlights.forEach((h) => (x += "- " + h + "\n"));
    x += "\n";
  }
  if (cs.challenge) x += "THE CHALLENGE\n" + cs.challenge + "\n\n";
  const goals = cs.programGoals.filter(Boolean);
  if (goals.length) {
    x += "PROGRAM GOALS\n";
    goals.forEach((g, i) => (x += i + 1 + ". " + g + "\n"));
    x += "\n";
  }
  if (cs.solutionIntro || cs.solutionServices.some((s) => s.title)) {
    x += "THE SOLUTION\n";
    if (cs.solutionIntro) x += cs.solutionIntro + "\n\n";
    cs.solutionServices.forEach((s) => {
      if (s.title) x += s.title + "\n" + (s.desc || "") + "\n\n";
    });
  }
  if (cs.howItRan.some((p) => p.phase)) {
    x += "HOW IT RAN\n";
    cs.howItRan.forEach((p, i) => {
      if (!p.phase) return;
      x += i + 1 + ". " + p.phase + "\n";
      (p.steps || []).filter(Boolean).forEach((s) => (x += "   - " + s + "\n"));
    });
    x += "\n";
  }
  if (cs.metrics.some((m) => m.value)) {
    x += "RESULTS\n";
    cs.metrics.forEach((m) => {
      if (m.value) x += m.value + " " + (m.label || "") + "\n";
    });
    x += "\n";
  }
  x += "---\nCallbox Inc.\n";
  return x;
}

export function copyText(txt: string, setCopied: (v: string | null) => void, key: string) {
  try {
    const el = document.createElement("textarea");
    el.value = txt;
    el.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  } catch {}
  setCopied(key);
  setTimeout(() => setCopied(null), 2000);
}
