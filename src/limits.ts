/** Validation bounds shared between host schemas and management panel forms. */
export const LIMITS = {
  ruleName: 100,
  ruleInstruction: 2000,
  evalTimeoutSeconds: { min: 30, max: 600 },
  maxWorkers: { min: 1, max: 16 },
  prepareCommand: 4000,
  promptMaxChars: { min: 1000, max: 1_000_000 },
  admissionContextMaxPages: { min: 1, max: 100 },
  admissionContextTimeoutMs: { min: 1, max: 90_000 },
  /** A pending reply older than this is surfaced as an owed delivery; retry policy stays in Effects. */
  owedReplyAfterMs: 60_000,
  /** Record-only worker tool-call telemetry: a turn over this cap is counted once per turn. */
  telemetry: { callCapPerTurn: 8, windowDays: 7 },
} as const
