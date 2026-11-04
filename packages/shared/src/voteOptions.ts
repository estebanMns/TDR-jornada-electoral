/** Real candidates. They are the only options ranked in `rank:*` sorted sets. */
export const CANDIDATE_IDS = ['C1', 'C2', 'C3', 'C4', 'C5'] as const;

/** Non-candidate options that are part of the tally but never ranked. */
export const SPECIAL_VOTE_IDS = ['BLANK', 'NULL', 'UNMARKED'] as const;

/** Every field of an acta `votes` object, in display order. */
export const VOTE_OPTION_IDS = [...CANDIDATE_IDS, ...SPECIAL_VOTE_IDS] as const;

export type CandidateId = (typeof CANDIDATE_IDS)[number];
export type SpecialVoteId = (typeof SPECIAL_VOTE_IDS)[number];
export type VoteOptionId = (typeof VOTE_OPTION_IDS)[number];

export type Votes = Record<VoteOptionId, number>;

/**
 * Reserved hash fields inside `tot:*` hashes. They start with `_` so they can
 * never collide with a vote option id.
 */
export const TOTALS_FIELDS = {
  /** Number of tables whose acta currently contributes to the level. */
  reported: '_reported',
  /** Sum of `voters` of the contributing actas. */
  voters: '_voters',
} as const;
