import { randomUUID } from 'node:crypto';
import {
  type ActaReceipt,
  type ActaSubmission,
  type JurorActaState,
  type JwtPayload,
  type ReceiptResult,
  type ResolutionInput,
  type ResolutionReceipt,
  type ResolutionResult,
} from '@preconteo/contracts';
import type { Metrics } from '../../core/metrics';
import {
  ActaForbiddenError,
  ActaNotFoundError,
  ActaValidationError,
  IngestionUnavailableError,
  PhotoStorageUnavailableError,
} from './actas.errors';
import type { ActasRepository } from './actas.repository';
import { assessActa, conflictPriority, contentHash, reviewPriority, sha256Hex } from './actas.rules';
import type { ApplyActaOutcome, CatalogTableEntry } from './actas.types';
import { actaPhotoPath, type PhotoStorage } from './photo.storage';

export interface ActasServiceDependencies {
  repository: ActasRepository;
  photoStorage: PhotoStorage;
  metrics: Metrics;
  instanceId: string;
  now?: () => number;
  newReceiptId?: () => string;
}

export interface SubmitActaCommand {
  submission: ActaSubmission;
  idempotencyKey: string;
  juror: JwtPayload;
}

export interface StorePhotoCommand {
  actaId: string;
  version: number;
  bytes: Uint8Array;
  contentType: string;
  juror: JwtPayload;
}

/** Use cases of the ingestion module (GENERAL §9.1). */
export class ActasService {
  private readonly now: () => number;
  private readonly newReceiptId: () => string;

  constructor(private readonly deps: ActasServiceDependencies) {
    this.now = deps.now ?? Date.now;
    this.newReceiptId = deps.newReceiptId ?? randomUUID;
  }

  /**
   * Registers a juror submission. The receipt only reflects what the atomic
   * script actually wrote; if Redis cannot be reached nothing is written and
   * {@link IngestionUnavailableError} is thrown (→ 503 NOT_REGISTERED).
   */
  async submit({ submission, idempotencyKey, juror }: SubmitActaCommand): Promise<ActaReceipt> {
    const receivedAt = this.now();
    this.deps.metrics.inc('actas_received');

    if (juror.tableId !== submission.tableId) {
      throw new ActaForbiddenError('TABLE_NOT_ASSIGNED', 'The acta does not belong to your table');
    }
    const table = await this.withStorage(() => this.deps.repository.findCatalogTable(submission.tableId));
    this.assertActaMatchesTable(submission.actaId, table);

    const assessment = assessActa(submission, table);
    const startedAt = performance.now();
    const outcome = await this.withStorage(() =>
      this.deps.repository.applyActa({
        mode: 'SUBMIT',
        actaId: submission.actaId,
        version: submission.version,
        tableId: table.tableId,
        stationId: table.stationId,
        munId: table.munId,
        enabled: table.enabled,
        stationName: table.stationName,
        munName: table.munName,
        tsRx: receivedAt,
        instance: this.deps.instanceId,
        juror: juror.sub,
        votes: submission.votes,
        voters: submission.voters,
        photoHash: submission.photoHash,
        contentHash: contentHash(submission),
        idempotencyKey,
        receiptId: this.newReceiptId(),
        doubtful: assessment.doubtful,
        reason: assessment.reason,
        review: reviewPriority(submission, assessment, receivedAt),
        conflictReview: conflictPriority(receivedAt),
      }),
    );
    this.deps.metrics.observe('actas_lua_ms', performance.now() - startedAt);

    if (outcome.error === 'IDEMPOTENCY_KEY_REUSED') {
      throw new ActaValidationError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different acta or content',
      );
    }
    const result = outcome.result as ReceiptResult;
    this.deps.metrics.inc(`actas_result_${result.toLowerCase()}`);
    return this.toReceipt(submission, result, outcome);
  }

  /**
   * Applies an auditor decision (called by the verification module, GENERAL §7.5).
   * Uses the same atomic script: an approved version is applied exactly like a
   * valid one; a rejected one keeps contributing 0.
   */
  async applyResolution(input: ResolutionInput): Promise<ResolutionReceipt> {
    const version = await this.withStorage(() => this.deps.repository.findVersion(input.actaId, input.version));
    if (!version) throw new ActaNotFoundError('VERSION_NOT_FOUND', 'Unknown acta version');
    if (input.decision === 'APPROVE_WITH_CORRECTION' && !input.votes) {
      throw new ActaValidationError('VOTES_REQUIRED', 'APPROVE_WITH_CORRECTION requires the corrected votes');
    }
    const table = await this.withStorage(() => this.deps.repository.findCatalogTable(version.tableId));
    this.assertActaMatchesTable(input.actaId, table);

    const outcome = await this.withStorage(() =>
      this.deps.repository.applyActa({
        mode: 'RESOLUTION',
        actaId: input.actaId,
        version: input.version,
        tableId: table.tableId,
        stationId: table.stationId,
        munId: table.munId,
        enabled: table.enabled,
        stationName: table.stationName,
        munName: table.munName,
        tsRx: this.now(),
        instance: this.deps.instanceId,
        decision: input.decision,
        ...(input.decision === 'APPROVE_WITH_CORRECTION'
          ? { votes: input.votes, voters: input.voters ?? version.voters }
          : {}),
        auditor: input.auditor,
        fencing: input.fencing,
        reason: input.reason ?? '',
      }),
    );
    this.deps.metrics.inc(`actas_resolution_${String(outcome.result).toLowerCase()}`);
    return {
      actaId: input.actaId,
      version: input.version,
      result: outcome.result as ResolutionResult,
      ...(outcome.status ? { status: outcome.status } : {}),
    };
  }

  async listJurorActas(juror: JwtPayload): Promise<JurorActaState[]> {
    return this.withStorage(() => this.deps.repository.listJurorActas(juror.sub));
  }

  /** Stores the photo of an already registered version. Idempotent (PUT semantics). */
  async storePhoto({ actaId, version, bytes, contentType, juror }: StorePhotoCommand): Promise<void> {
    if (juror.tableId === undefined) throw new ActaForbiddenError('TABLE_NOT_ASSIGNED', 'No table assigned');
    const table = await this.withStorage(() => this.deps.repository.findCatalogTable(juror.tableId!));
    if (!table || table.actaId !== actaId) {
      throw new ActaForbiddenError('TABLE_NOT_ASSIGNED', 'The acta does not belong to your table');
    }
    const record = await this.withStorage(() => this.deps.repository.findVersion(actaId, version));
    if (!record) throw new ActaNotFoundError('VERSION_NOT_FOUND', 'Send the acta before its photo');
    if (sha256Hex(bytes) !== record.photoHash) {
      throw new ActaValidationError('PHOTO_HASH_MISMATCH', 'The photo does not match the registered hash');
    }

    const path = actaPhotoPath(actaId, version);
    try {
      await this.deps.photoStorage.put(path, bytes, contentType);
    } catch (error) {
      throw new PhotoStorageUnavailableError(error);
    }
    this.deps.metrics.inc('actas_photos_stored');
    // Best effort: the path is deterministic, the history row can be completed later.
    await this.deps.repository.recordPhotoStored(actaId, version, path).catch(() => undefined);
  }

  private assertActaMatchesTable(
    actaId: string,
    table: CatalogTableEntry | null,
  ): asserts table is CatalogTableEntry {
    if (!table) throw new ActaValidationError('UNKNOWN_TABLE', 'The table does not exist in the catalog');
    if (table.actaId !== actaId) {
      throw new ActaValidationError('ACTA_TABLE_MISMATCH', 'The acta code does not match the table');
    }
  }

  private toReceipt(submission: ActaSubmission, result: ReceiptResult, outcome: ApplyActaOutcome): ActaReceipt {
    return {
      actaId: submission.actaId,
      version: submission.version,
      result,
      instance: this.deps.instanceId,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      ...(outcome.registeredAt !== undefined ? { registeredAt: outcome.registeredAt } : {}),
      ...(outcome.receiptId ? { receiptId: outcome.receiptId } : {}),
      ...(outcome.replayed ? { replayed: true } : {}),
    };
  }

  /** Any storage failure means nothing was (or can be known to be) written. */
  private async withStorage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.deps.metrics.inc('actas_storage_errors');
      throw new IngestionUnavailableError(error);
    }
  }
}
