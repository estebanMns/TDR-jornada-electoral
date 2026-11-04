import { z } from 'zod';
import { RECEIPT_RESULTS, REVIEW_DECISIONS } from './acta';
import { VOTE_OPTION_IDS, type VoteOptionId } from './voteOptions';

const voteCount = z.number().int().nonnegative().max(100_000);

export const votesSchema = z
  .object(
    Object.fromEntries(VOTE_OPTION_IDS.map((option) => [option, voteCount])) as Record<
      VoteOptionId,
      typeof voteCount
    >,
  )
  .strict();

export const ACTA_ID_PATTERN = /^E14-\d+-\d{4}-\d{2}$/;
export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export const actaSubmissionSchema = z
  .object({
    actaId: z.string().regex(ACTA_ID_PATTERN),
    version: z.number().int().min(1).max(1_000),
    tableId: z.number().int().positive(),
    votes: votesSchema,
    voters: voteCount,
    photoHash: z.string().regex(SHA256_HEX_PATTERN),
  })
  .strict();

/** Client-generated key, created ONCE per logical submission (UUID recommended). */
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const actaReceiptSchema = z.object({
  actaId: z.string(),
  version: z.number().int(),
  result: z.enum(RECEIPT_RESULTS),
  reason: z.string().optional(),
  instance: z.string(),
  registeredAt: z.number().optional(),
  receiptId: z.string().optional(),
  replayed: z.boolean().optional(),
});

export const resolutionInputSchema = z
  .object({
    actaId: z.string().regex(ACTA_ID_PATTERN),
    version: z.number().int().min(1),
    decision: z.enum(REVIEW_DECISIONS),
    votes: votesSchema.optional(),
    voters: voteCount.optional(),
    auditor: z.string().min(1),
    fencing: z.number().int().nonnegative(),
    reason: z.string().max(500).optional(),
  })
  .refine((input) => input.decision !== 'APPROVE_WITH_CORRECTION' || input.votes !== undefined, {
    message: 'votes are required for APPROVE_WITH_CORRECTION',
    path: ['votes'],
  });
