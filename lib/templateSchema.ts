// The downloadable Word template ("Callbox Case Study Template"): one schema drives both the
// .docx (scripts/build-template.mjs) and the reader that turns a filled template back into a
// sheet (lib/templateParse.ts), so a label can never drift between the two.
//
// Pure data, no imports: the build script runs it directly in Node.
//
// Every field is a row in a 2-column table: grey label cell (label + guide) | white answer cell.
// Lists are their own table: first row = label (merged), second row = column headers, then rows.
// Labels are unique: the reader finds fields by label text.

export const TEMPLATE_TITLE = "Callbox Case Study Template";
export const TEMPLATE_VERSION = "Template v1";
export const TEMPLATE_FILE = "callbox-case-study-template.docx";

export type TextField = { kind: "text"; path: string; label: string; guide?: string };
// Answer paragraphs become a string[] (one paragraph per line in the box).
export type ParasField = { kind: "paras"; path: string; label: string; guide?: string };
export type ListColumn = { key: string; label: string; numeric?: boolean; width: number };
export type ListField = {
  kind: "list";
  path: string;
  label: string;
  guide?: string;
  columns: ListColumn[];
  rows: number;
  // Rows shown pre-filled (e.g. standard funnel stage names); the writer adds the rest.
  prefill?: Record<string, string>[];
  // A one-column list read as string[] instead of objects (e.g. outcomes).
  flat?: boolean;
};
export type TemplateField = TextField | ParasField | ListField;
export type TemplateSection = { title: string; intro?: string; fields: TemplateField[] };

const titled = (title: string, body: string): ListColumn[] => [
  { key: "title", label: title, width: 3000 },
  { key: "body", label: body, width: 6936 },
];

export const TEMPLATE_SECTIONS: TemplateSection[] = [
  {
    title: "Masthead",
    fields: [
      { kind: "text", path: "clientName", label: "Client name", guide: "The company name, as the client approves it." },
      { kind: "text", path: "solutionLines", label: "Solution line", guide: "The client's ONE core solution, e.g. Cybersecurity." },
      { kind: "text", path: "country", label: "Country", guide: "Where the client is based, e.g. United States." },
      {
        kind: "text",
        path: "headline",
        label: "Headline (H1)",
        guide:
          "Title Case, 9 to 16 words. Describe the client by type, never by name: client type + verb + qualified outcome + market + channel or duration. " +
          "Example: IT Provider Builds Qualified Pipeline Across US Spanish-Speaking Markets With Multilingual Outreach.",
      },
      { kind: "text", path: "headlineHighlight", label: "Headline highlight", guide: "The exact words from the headline to show in yellow." },
      { kind: "text", path: "dek", label: "Dek", guide: "1 to 2 sentences: the sharpest result, not a repeat of the headline." },
      { kind: "text", path: "subDek", label: "Sub-dek", guide: "Optional. One sentence of context: the period, the market and the scale of the program." },
      {
        kind: "list",
        path: "heroStats",
        label: "Hero stats",
        guide: "Up to 4. The first one gets the yellow accent. Example: 111 | Sales-qualified appointments.",
        columns: [
          { key: "value", label: "Number", width: 2400 },
          { key: "label", label: "What it counts", width: 7536 },
        ],
        rows: 4,
      },
      {
        kind: "list",
        path: "facts",
        label: "Facts",
        guide: "Up to 8 label and value pairs. Leave a value empty to skip that fact; HubSpot and CallboxOne can fill most of them.",
        columns: [
          { key: "label", label: "Label", width: 3000 },
          { key: "value", label: "Value", width: 6936 },
        ],
        rows: 8,
        prefill: [
          { label: "Industry" },
          { label: "Headquarters" },
          { label: "Company size" },
          { label: "Client since" },
          { label: "Period measured" },
          { label: "Market" },
          { label: "Channels worked" },
        ],
      },
    ],
  },
  {
    title: "01 · The situation",
    fields: [
      { kind: "text", path: "situation.heading", label: "Situation heading", guide: "Says what the situation was. Not \"The situation\"." },
      { kind: "paras", path: "situation.body", label: "Situation text", guide: "The context before results. One paragraph per line." },
      { kind: "text", path: "situation.pullStat", label: "Pull stat", guide: "One sentence with the most striking comparison." },
    ],
  },
  {
    title: "02 · Where the pipeline came from",
    intro: "Leave the channel rows empty to import them from CallboxOne.",
    fields: [
      { kind: "text", path: "channels.heading", label: "Channels heading", guide: "Which channel carried the program, and how the others compared." },
      { kind: "text", path: "channels.intro", label: "Channels intro" },
      {
        kind: "list",
        path: "channels.rows",
        label: "Channel rows",
        guide: "Activity example: 13,483 messages sent · 2,484 replies. Leave Appointments empty if they aren't tracked.",
        columns: [
          { key: "name", label: "Channel", width: 2000 },
          { key: "activity", label: "Activity", width: 5936 },
          { key: "appointments", label: "Appointments", numeric: true, width: 2000 },
        ],
        rows: 4,
      },
      { kind: "list", path: "channels.takeaways", label: "Channel takeaways", guide: "Up to 2, each with a different number.", columns: titled("Title", "Text"), rows: 2 },
    ],
  },
  {
    title: "03 · The primary contact",
    intro: "The section is hidden unless the role is filled in. Describe the buyer by role, never by name.",
    fields: [
      { kind: "text", path: "primaryContact.heading", label: "Contact heading" },
      { kind: "text", path: "primaryContact.intro", label: "Contact intro", guide: "The buyer is a person with a job, a target and a reason to look for help." },
      { kind: "text", path: "primaryContact.role", label: "Contact role", guide: "Job title only, e.g. Senior Director of Marketing." },
      { kind: "text", path: "primaryContact.context", label: "Contact context", guide: "One sentence on what this role owns at the client." },
      {
        kind: "list",
        path: "primaryContact.pressures",
        label: "What this role is carrying",
        guide: "Up to 6. Confirm these with the CSM: they are the role's situation, not a client quote.",
        columns: titled("Pressure", "Text"),
        rows: 4,
      },
      { kind: "list", path: "primaryContact.partnerReasons", label: "Why a partner rather than a hire", guide: "Up to 3.", columns: titled("Reason", "Text"), rows: 3 },
    ],
  },
  {
    title: "04 · How it ran",
    fields: [
      { kind: "text", path: "howItRan.heading", label: "How it ran heading" },
      { kind: "list", path: "howItRan.steps", label: "Steps", guide: "Up to 6, in order.", columns: titled("Step", "Text"), rows: 4 },
      { kind: "text", path: "howItRan.rolesHeading", label: "Roles heading", guide: "Who actually said yes." },
      { kind: "text", path: "howItRan.rolesIntro", label: "Roles intro" },
      {
        kind: "list",
        path: "howItRan.roles",
        label: "Appointments by role",
        guide: "Leave empty to import from CallboxOne. Put Other roles last.",
        columns: [
          { key: "role", label: "Role level", width: 6936 },
          { key: "count", label: "Appointments", numeric: true, width: 3000 },
        ],
        rows: 6,
      },
      { kind: "text", path: "howItRan.rolesFootnote", label: "Roles footnote" },
    ],
  },
  {
    title: "05 · The progression",
    fields: [
      { kind: "text", path: "progression.heading", label: "Progression heading" },
      { kind: "paras", path: "progression.body", label: "Progression text", guide: "The shape over time. One paragraph per line." },
      { kind: "text", path: "progression.chartTitle", label: "Chart title", guide: "e.g. Sales-qualified appointments, by quarter." },
      {
        kind: "list",
        path: "progression.quarters",
        label: "Periods",
        guide: "Leave empty to import from CallboxOne. Example: Q3 2025 | 20 | Launch quarter.",
        columns: [
          { key: "label", label: "Period", width: 2400 },
          { key: "count", label: "Appointments", numeric: true, width: 2000 },
          { key: "note", label: "Note", width: 5536 },
        ],
        rows: 6,
      },
      { kind: "text", path: "progression.footnote", label: "Progression footnote" },
    ],
  },
  {
    title: "06 · Pre-close progression",
    intro: "Shown only when at least 3 stages have a number.",
    fields: [
      { kind: "text", path: "funnel.heading", label: "Funnel heading" },
      { kind: "text", path: "funnel.intro", label: "Funnel intro" },
      {
        kind: "list",
        path: "funnel.stages",
        label: "Funnel stages",
        guide: "Fill in the numbers you have; leave the rest empty.",
        columns: [
          { key: "name", label: "Stage", width: 3000 },
          { key: "description", label: "Description", width: 4936 },
          { key: "value", label: "Number", numeric: true, width: 2000 },
        ],
        rows: 5,
        prefill: [
          { name: "Appointments set", description: "Sales-qualified appointments handed to the client." },
          { name: "First appointment transpired", description: "Confirmed as held." },
          { name: "Second appointment transpired", description: "The stakeholder meeting, where the buying group forms." },
          { name: "Opportunity created", description: "Logged as a live deal in the client's CRM." },
          { name: "Closed won", description: "Revenue attributable to the program." },
        ],
      },
    ],
  },
  {
    title: "07 · What changed",
    fields: [
      { kind: "text", path: "whatChanged.heading", label: "What changed heading" },
      {
        kind: "list",
        path: "whatChanged.outcomes",
        label: "Outcomes",
        guide: "Up to 5, one sentence each, each with a different number.",
        columns: [{ key: "text", label: "Outcome", width: 9936 }],
        rows: 4,
        flat: true,
      },
      { kind: "text", path: "whatChanged.quote.text", label: "Client quote", guide: "Only a quote the client approved, word for word." },
      { kind: "text", path: "whatChanged.quote.name", label: "Quote: name" },
      { kind: "text", path: "whatChanged.quote.title", label: "Quote: job title" },
    ],
  },
  {
    title: "08 · Where it goes next",
    fields: [
      { kind: "text", path: "whereNext.heading", label: "Where next heading" },
      { kind: "text", path: "whereNext.intro", label: "Where next intro" },
      { kind: "list", path: "whereNext.recommendations", label: "Recommendations", guide: "Up to 3 Callbox recommendations.", columns: titled("Recommendation", "Text"), rows: 3 },
      { kind: "text", path: "whereNext.footnote", label: "Where next footnote" },
    ],
  },
  {
    title: "Methodology",
    fields: [
      {
        kind: "text",
        path: "methodologyNote",
        label: "Methodology note",
        guide: "Where the figures come from and the period. Filled automatically when you import from CallboxOne.",
      },
    ],
  },
];
