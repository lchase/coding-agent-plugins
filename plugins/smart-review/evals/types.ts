// Machine-readable mirror of the finding schema at skills/smart-review/references/finding-schema.md, plus the eval
// corpus types. Keep the Lens union and category expectations in sync with the
// schema doc when you extend the vocabulary.

export type Lens =
  | "spec-conformance"
  | "correctness"
  | "security"
  | "performance"
  | "design"
  | "tests";

export type Severity = "P0" | "P1" | "P2" | "P3";

/** One finding, as every lens emits it and the merge/scorer consume it. */
export interface Finding {
  file: string;
  line_start: number;
  line_end: number;
  lens: Lens;
  category: string;
  severity: Severity;
  title: string;
  why: string;
  proposed_move: string;
  confidence: number; // 0..1
}

/** The findings array a single reviewer run produces for one case. */
export type ActualFindings = Finding[];

/** One planted defect the reviewer is expected to catch. */
export interface ExpectedFinding {
  category: string; // must equal Finding.category
  file: string; // matched on basename
  near_line: number; // matched within +/- window, or inside the finding's span
  min_severity: Severity; // reviewer may rate this severe or worse
  lens?: Lens; // optional: the lens expected to own it
  note?: string; // human description of the planted defect
}

/** Ground truth for one case. */
export interface ExpectedSpec {
  must_find: ExpectedFinding[];
  /** Traps that look like defects but are fine — firing on these is a false positive. */
  must_not_find?: ExpectedFinding[];
}

/** Metadata describing one corpus case. */
export interface CaseMeta {
  id: string;
  title: string;
  primary_lens: Lens; // the lens this case chiefly exercises
  spec?: string; // the intent/spec handed to the reviewer
  files: string[]; // files under review
  pr_description?: string; // the PR body; its claims become the claims list
  context_files?: string[]; // unchanged repo files the reviewer must discover through the context pack
}

/** Severity rank: higher = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  P0: 3,
  P1: 2,
  P2: 1,
  P3: 0,
};
