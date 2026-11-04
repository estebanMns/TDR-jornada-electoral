import { VOTE_OPTION_IDS, type Votes } from './voteOptions';

/** Sum of every option of the acta: candidates + BLANK + NULL + UNMARKED. */
export function sumVotes(votes: Votes): number {
  return VOTE_OPTION_IDS.reduce((total, option) => total + votes[option], 0);
}

/**
 * Accounting rule of the acta (GENERAL §6.3):
 * Σ candidates + BLANK + NULL + UNMARKED = voters.
 */
export function isTallyBalanced(votes: Votes, voters: number): boolean {
  return sumVotes(votes) === voters;
}

/** Signed difference between the counted votes and the declared voters. */
export function tallyDifference(votes: Votes, voters: number): number {
  return sumVotes(votes) - voters;
}
