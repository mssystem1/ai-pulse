import type {GlobalAssessment} from "@pulse/domain";

/** Both old and new assessments can retain a shorter confirmed-return window.
 * The browser must never keep order review enabled until the longer setup TTL. */
export function globalAssessmentEntryDeadline(assessment:Pick<GlobalAssessment,"expiresAt"|"retestDeadline">):number|null{
  const deadlines=[assessment.expiresAt,assessment.retestDeadline].filter((at):at is number=>at!==null);
  return deadlines.length?Math.min(...deadlines):null;
}
