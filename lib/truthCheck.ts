// "Verifying truth data": once CallboxOne numbers are on the sheet (after the initial data, HubSpot
// or a document or template, and the secondary data, CallboxOne, are plotted), every number in the
// sheet's text is checked against the data. CallboxOne is the source of truth: a sentence with a
// number the data doesn't back (a draft's "1,622 emails" when CallboxOne has 117,570) is flagged.
// The writer removes it (the AI then redrafts an emptied field from the data) or keeps it, for a
// number that isn't a campaign result ("a 40-person IT team").
//
// The same number rules as the AI's guard (lib/narrative.ts): percentages and "x times" need both
// source numbers in the sentence, and counts up to 24 always pass.

import { allowedNumbers, splitSentences, unbackedNumbers } from "@/lib/narrative";
import type { RevampCaseStudy, TitledItem } from "@/lib/revamp";

export type TextFinding = {
  path: string; // where the sentence is, e.g. "dek", "situation.body.0", "whereNext.recommendations.1.body"
  label: string; // the field's name for the writer
  sentence: string;
  numbers: string[]; // the numbers the data doesn't back, as written
};

type TextField = { path: string; label: string; text: string };

// Every piece of written text on the sheet. Data (hero stats, facts, channel rows, roles, periods,
// funnel) and the lines generated from it (chart meta, roles footnote, methodology) are the truth
// the text is checked against, so they are not in this list.
function textFields(r: RevampCaseStudy): TextField[] {
  const out: TextField[] = [];
  const add = (path: string, label: string, text: string) => {
    if (text?.trim()) out.push({ path, label, text });
  };
  const paras = (path: string, label: string, xs: string[]) =>
    xs.forEach((t, i) => add(`${path}.${i}`, xs.length > 1 ? `${label}, paragraph ${i + 1}` : label, t));
  const items = (path: string, label: string, xs: TitledItem[]) =>
    xs.forEach((x, i) => {
      add(`${path}.${i}.title`, `${label} ${i + 1} title`, x.title);
      add(`${path}.${i}.body`, `${label} ${i + 1}`, x.body);
    });

  add("headline", "Headline", r.headline);
  add("dek", "Dek", r.dek);
  add("subDek", "Sub-dek", r.subDek);
  add("situation.heading", "Situation heading", r.situation.heading);
  paras("situation.body", "Situation text", r.situation.body);
  add("situation.pullStat", "Pull stat", r.situation.pullStat);
  add("channels.heading", "Channels heading", r.channels.heading);
  add("channels.intro", "Channels intro", r.channels.intro);
  items("channels.takeaways", "Channel takeaway", r.channels.takeaways);
  add("primaryContact.heading", "Contact heading", r.primaryContact.heading);
  add("primaryContact.intro", "Contact intro", r.primaryContact.intro);
  add("primaryContact.context", "Contact context", r.primaryContact.context);
  items("primaryContact.pressures", "Role pressure", r.primaryContact.pressures);
  items("primaryContact.partnerReasons", "Partner reason", r.primaryContact.partnerReasons);
  add("howItRan.heading", "How it ran heading", r.howItRan.heading);
  items("howItRan.steps", "Step", r.howItRan.steps);
  add("howItRan.rolesHeading", "Roles heading", r.howItRan.rolesHeading);
  add("howItRan.rolesIntro", "Roles intro", r.howItRan.rolesIntro);
  add("progression.heading", "Progression heading", r.progression.heading);
  paras("progression.body", "Progression text", r.progression.body);
  r.progression.quarters.forEach((q, i) => add(`progression.quarters.${i}.note`, `${q.label} note`, q.note));
  add("progression.footnote", "Progression footnote", r.progression.footnote);
  add("funnel.heading", "Funnel heading", r.funnel.heading);
  add("funnel.intro", "Funnel intro", r.funnel.intro);
  add("whatChanged.heading", "What changed heading", r.whatChanged.heading);
  r.whatChanged.outcomes.forEach((t, i) => add(`whatChanged.outcomes.${i}`, `Outcome ${i + 1}`, t));
  add("whatChanged.quote.text", "Client quote", r.whatChanged.quote.text);
  add("whereNext.heading", "Where next heading", r.whereNext.heading);
  add("whereNext.intro", "Where next intro", r.whereNext.intro);
  items("whereNext.recommendations", "Recommendation", r.whereNext.recommendations);
  return out;
}

export function findUnbackedNumbers(r: RevampCaseStudy): TextFinding[] {
  const A = allowedNumbers(r);
  const out: TextFinding[] = [];
  for (const f of textFields(r)) {
    for (const sentence of splitSentences(f.text.trim())) {
      const numbers = unbackedNumbers(sentence, A);
      if (numbers.length) out.push({ path: f.path, label: f.label, sentence, numbers });
    }
  }
  return out;
}

export const findingKey = (f: TextFinding) => `${f.path}|${f.sentence}`;

// "" is the sheet itself (the parent of top-level fields such as "dek").
const getPath = (o: any, path: string) => (path ? path.split(".").reduce((x, k) => x?.[k], o) : o);

// Lists whose entries are dropped once empty: paragraphs and outcomes, and titled items whose
// title and text are both empty. (Periods are never dropped: an emptied note just stays empty.)
const PARAGRAPH_LISTS = ["situation.body", "progression.body", "whatChanged.outcomes"];
const ITEM_LISTS = ["channels.takeaways", "primaryContact.pressures", "primaryContact.partnerReasons", "howItRan.steps", "whereNext.recommendations"];

// Removes the flagged sentences, leaving the rest of each field as written. An emptied headline
// also clears its highlight. The sheet passed in is not changed.
export function removeFindings(r: RevampCaseStudy, findings: TextFinding[]): RevampCaseStudy {
  const next: RevampCaseStudy = structuredClone(r);
  for (const f of findings) {
    const parts = f.path.split(".");
    const last = parts.pop() as string;
    const parent = getPath(next, parts.join("."));
    if (!parent || typeof parent[last] !== "string") continue;
    parent[last] = splitSentences(parent[last].trim())
      .filter((s) => s !== f.sentence)
      .join(" ")
      .trim();
  }
  // Pruned only after every removal, so the indexes in the findings' paths stay valid.
  for (const path of PARAGRAPH_LISTS) {
    const list: string[] = getPath(next, path);
    const kept = list.filter((t) => t.trim());
    if (kept.length !== list.length) list.splice(0, list.length, ...kept);
  }
  for (const path of ITEM_LISTS) {
    const list: TitledItem[] = getPath(next, path);
    const kept = list.filter((x) => x.title.trim() || x.body.trim());
    if (kept.length !== list.length) list.splice(0, list.length, ...kept);
  }
  if (!next.headline.trim()) next.headlineHighlight = "";
  return next;
}
