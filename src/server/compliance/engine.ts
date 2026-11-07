/**
 * Content compliance engine. Pure: rules in, result out.
 *
 * Every piece of agent content runs through this before it can enter the
 * Approval Queue. Rules are stored in the database and edited by executives.
 *
 * Outcome:
 *   PASS  no findings
 *   WARN  only LOW/MEDIUM findings (staff may decide)
 *   FAIL  any HIGH/CRITICAL finding (executive decision + acknowledgement needed)
 */
import type {
  ComplianceOutcome,
  ComplianceRuleType,
  ContentChannel,
  RiskLevel,
} from "@/generated/prisma/enums";

export interface ComplianceRuleInput {
  id: string;
  type: ComplianceRuleType;
  pattern: string;
  isRegex: boolean;
  /** Empty = every channel. */
  channels: ContentChannel[];
  severity: RiskLevel;
  description: string;
  suggestion?: string | null;
  active?: boolean;
}

export interface Violation {
  ruleId: string;
  type: ComplianceRuleType;
  match: string;
  index: number;
  message: string;
  severity: RiskLevel;
  suggestion: string | null;
}

export interface ComplianceResult {
  outcome: ComplianceOutcome;
  risk: RiskLevel;
  violations: Violation[];
}

const SEVERITY_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
/** Bounded input keeps regex evaluation predictable. */
export const MAX_CONTENT_LENGTH = 10_000;
const MAX_MATCHES_PER_RULE = 20;

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds the matcher for a rule, or null if a regex rule is invalid. */
export function compileRule(rule: Pick<ComplianceRuleInput, "pattern" | "isRegex">): RegExp | null {
  try {
    const source = rule.isRegex
      ? rule.pattern
      : // Whole-word, case-insensitive, tolerant of spacing differences.
        `(?<![\\p{L}\\p{N}])${escapeRegex(rule.pattern.trim()).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`;
    return new RegExp(source, "giu");
  } catch {
    return null;
  }
}

export function maxSeverity(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>(
    (max, level) => (SEVERITY_ORDER[level] > SEVERITY_ORDER[max] ? level : max),
    "LOW",
  );
}

export function evaluateContent(
  text: string,
  channel: ContentChannel,
  rules: ComplianceRuleInput[],
): ComplianceResult {
  const content = text.slice(0, MAX_CONTENT_LENGTH);
  const violations: Violation[] = [];

  for (const rule of rules) {
    if (rule.active === false) continue;
    if (rule.channels.length > 0 && !rule.channels.includes(channel)) continue;
    const matcher = compileRule(rule);
    if (!matcher) continue;

    let found = 0;
    for (const m of content.matchAll(matcher)) {
      if (!m[0]) continue;
      violations.push({
        ruleId: rule.id,
        type: rule.type,
        match: m[0],
        index: m.index ?? 0,
        message: rule.description,
        severity: rule.severity,
        suggestion: rule.suggestion ?? null,
      });
      if (++found >= MAX_MATCHES_PER_RULE) break;
    }
  }

  violations.sort((a, b) => a.index - b.index);
  const risk = maxSeverity(violations.map((v) => v.severity));
  const outcome: ComplianceOutcome =
    violations.length === 0
      ? "PASS"
      : SEVERITY_ORDER[risk] >= SEVERITY_ORDER.HIGH
        ? "FAIL"
        : "WARN";

  return { outcome, risk, violations };
}

/** Splits text into plain and flagged segments for highlighting in the UI. */
export function segmentByViolations(
  text: string,
  violations: Pick<Violation, "index" | "match" | "severity" | "message">[],
): { text: string; violation?: Pick<Violation, "severity" | "message"> }[] {
  const segments: { text: string; violation?: Pick<Violation, "severity" | "message"> }[] = [];
  let cursor = 0;
  for (const v of [...violations].sort((a, b) => a.index - b.index)) {
    if (v.index < cursor || text.slice(v.index, v.index + v.match.length) !== v.match) continue;
    if (v.index > cursor) segments.push({ text: text.slice(cursor, v.index) });
    segments.push({ text: v.match, violation: { severity: v.severity, message: v.message } });
    cursor = v.index + v.match.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/** Collapses repeats of the same rule and phrase (e.g. in both title and caption) for display. */
export function groupViolations<
  V extends { ruleId?: string; match: string; severity: RiskLevel; message: string },
>(violations: V[]): (V & { count: number })[] {
  const groups = new Map<string, V & { count: number }>();
  for (const v of violations) {
    const key = `${v.ruleId ?? v.message}|${v.match.toLowerCase()}`;
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { ...v, count: 1 });
  }
  return [...groups.values()].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
  );
}
