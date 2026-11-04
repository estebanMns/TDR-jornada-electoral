export const ROLES = ['PUBLIC', 'JUROR', 'AUDITOR', 'COORDINATOR', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Claims carried by every JWT (HS256, 8 h). */
export interface JwtPayload {
  sub: string;
  role: Role;
  name: string;
  /** Global table number (1..6400). Only present for `JUROR`. */
  tableId?: number;
}
