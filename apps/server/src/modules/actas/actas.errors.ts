/** Domain errors of the actas module. Routes map them to HTTP responses. */
export abstract class ActasError extends Error {
  abstract readonly statusCode: number;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The request is well formed but contradicts the catalog or the contract. */
export class ActaValidationError extends ActasError {
  readonly statusCode = 422;
}

/** The juror tries to act on a table that is not theirs. */
export class ActaForbiddenError extends ActasError {
  readonly statusCode = 403;
}

export class ActaNotFoundError extends ActasError {
  readonly statusCode = 404;
}

/** Redis (the source of truth of ingestion) could not be reached: nothing was written. */
export class IngestionUnavailableError extends ActasError {
  readonly statusCode = 503;
  constructor(override readonly cause: unknown) {
    super('NOT_REGISTERED', 'Ingestion storage unavailable');
  }
}

/** Photo storage (Supabase Storage) failed; the client should retry later. */
export class PhotoStorageUnavailableError extends ActasError {
  readonly statusCode = 503;
  constructor(override readonly cause: unknown) {
    super('PHOTO_STORAGE_UNAVAILABLE', 'Photo storage unavailable');
  }
}
