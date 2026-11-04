import { createHash } from 'node:crypto';
import {
  DOUBT_REASONS,
  tallyDifference,
  VOTE_OPTION_IDS,
  type ActaSubmission,
  type DoubtReason,
} from '@preconteo/contracts';
import type { CatalogTableEntry, ReviewPlacement } from './actas.types';

export interface ActaAssessment {
  doubtful: boolean;
  reason: DoubtReason | '';
  /** Σ votes − voters (0 when the tally is balanced). */
  tallyDifference: number;
}

/**
 * Business rules of GENERAL §6.3. A doubtful acta is still registered (the
 * juror gets an unambiguous receipt) but it contributes 0 until reviewed.
 */
export function assessActa(submission: ActaSubmission, table: CatalogTableEntry): ActaAssessment {
  const difference = tallyDifference(submission.votes, submission.voters);
  if (submission.voters > table.enabled) {
    return { doubtful: true, reason: DOUBT_REASONS.votersExceedEnabled, tallyDifference: difference };
  }
  if (difference !== 0) {
    return { doubtful: true, reason: DOUBT_REASONS.tallyMismatch, tallyDifference: difference };
  }
  return { doubtful: false, reason: '', tallyDifference: 0 };
}

const LARGE_MISMATCH_RATIO = 0.05;
const LOWEST_LEVEL = 3;
/** Same formula as `scoreDeCaso` of the verification module. */
const LEVEL_WEIGHT = 1e13;

export function reviewPlacement(level: number, enqueuedAt: number): ReviewPlacement {
  return { level, score: level * LEVEL_WEIGHT + enqueuedAt };
}

/**
 * Review priority (1 = first … 3 = normal): corrections (version > 1) and
 * large mismatches move up one level each; within a level, oldest first.
 */
export function reviewPriority(
  submission: ActaSubmission,
  assessment: ActaAssessment,
  receivedAt: number,
): ReviewPlacement {
  let level = LOWEST_LEVEL;
  if (submission.version > 1) level -= 1;
  const largeMismatch =
    assessment.reason === DOUBT_REASONS.votersExceedEnabled ||
    Math.abs(assessment.tallyDifference) > Math.max(1, submission.voters * LARGE_MISMATCH_RATIO);
  if (largeMismatch) level -= 1;
  return reviewPlacement(level, receivedAt);
}

/** Two different copies of the same version: always reviewed first. */
export function conflictPriority(receivedAt: number): ReviewPlacement {
  return reviewPlacement(1, receivedAt);
}

/**
 * Hash of what the acta says (not of how it was sent). Two submissions of the
 * same version with the same hash are the same acta; different hashes are a conflict.
 */
export function contentHash(submission: ActaSubmission): string {
  const canonical = [
    submission.actaId,
    submission.version,
    submission.tableId,
    ...VOTE_OPTION_IDS.map((option) => `${option}=${submission.votes[option]}`),
    `voters=${submission.voters}`,
    submission.photoHash,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
