/**
 * Delay Detected Event Handler
 *
 * BL-145 (TD-EVAL-COORDINATOR-001): Kafka consumer handler for delay.detected events
 * from delay-tracker service via outbox-relay.
 *
 * AC-3: On delay.detected, create evaluation_workflow with status=INITIATED
 * AC-4: Extract correlation_id from event, propagate through all calls and logs
 * AC-8: Idempotent processing - duplicate events ignored
 * AC-9: Uses @railrepay/winston-logger
 */

import { v4 as uuidv4 } from 'uuid';
import { WorkflowRepository } from '../repositories/workflow-repository.js';

/**
 * Logger interface
 */
interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Payload interface for delay.detected events
 */
export interface DelayDetectedPayload {
  journey_id: string;
  user_id: string;
  delay_minutes: number;
  is_cancellation: boolean;
  correlation_id?: string; // Optional in payload
}

/**
 * Handler dependencies
 */
interface DelayDetectedHandlerDeps {
  workflowRepository: WorkflowRepository;
  logger: Logger;
}

/**
 * DelayDetectedHandler class
 */
export class DelayDetectedHandler {
  readonly topic = 'delay.detected';

  private workflowRepository: WorkflowRepository;
  private logger: Logger;

  constructor(deps: DelayDetectedHandlerDeps) {
    this.workflowRepository = deps.workflowRepository;
    this.logger = deps.logger;
  }

  /**
   * Handle incoming delay.detected event
   *
   * AC-3: Create workflow with status=INITIATED
   * AC-4: Extract and propagate correlation_id
   * AC-8: Idempotent - skip duplicates
   */
  async handle(payload: DelayDetectedPayload | Record<string, unknown>): Promise<void> {
    // Payload validation
    this.validatePayload(payload);

    // AC-4: Extract correlation_id from payload (generate if missing)
    let correlationId = (payload as DelayDetectedPayload).correlation_id;
    if (!correlationId || correlationId.trim() === '') {
      correlationId = uuidv4();
      // AC-4: Log warning when correlation_id missing
      this.logger.warn('correlation_id missing from delay.detected payload, generated new UUID', {
        journey_id: (payload as DelayDetectedPayload).journey_id,
        correlation_id: correlationId,
      });
    }

    const typedPayload = payload as DelayDetectedPayload;

    // AC-8: Idempotent duplicate handling
    const existingWorkflow = await this.workflowRepository.getWorkflowByJourneyId(typedPayload.journey_id);
    if (existingWorkflow) {
      // Already processed - skip to maintain idempotency
      // AC-8: Log at info level when duplicate detected
      this.logger.info('Skipping duplicate delay.detected event', {
        correlation_id: correlationId,
        journey_id: typedPayload.journey_id,
        existing_status: existingWorkflow.status,
      });
      return;
    }

    try {
      // AC-3: Create evaluation_workflow with status=INITIATED
      // AC-4: Propagate correlation_id
      const workflow = await this.workflowRepository.createWorkflow(
        typedPayload.journey_id,
        correlationId
      );

      // AC-9: Log workflow creation with winston-logger
      this.logger.info('Created evaluation workflow for delay.detected event', {
        correlation_id: correlationId,
        journey_id: typedPayload.journey_id,
        workflow_id: workflow.id,
        delay_minutes: typedPayload.delay_minutes,
        is_cancellation: typedPayload.is_cancellation,
      });
    } catch (error) {
      // AC-9: Log errors with winston-logger
      this.logger.error('Failed to create evaluation workflow for delay.detected', {
        correlation_id: correlationId,
        journey_id: typedPayload.journey_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Validate incoming payload
   */
  private validatePayload(payload: DelayDetectedPayload | Record<string, unknown>): void {
    // Required fields validation
    if (!payload.journey_id) {
      throw new Error('Validation error: journey_id is required');
    }
    if (!payload.user_id) {
      throw new Error('Validation error: user_id is required');
    }
    if (payload.delay_minutes === undefined || payload.delay_minutes === null) {
      throw new Error('Validation error: delay_minutes is required');
    }
    if (payload.is_cancellation === undefined || payload.is_cancellation === null) {
      throw new Error('Validation error: is_cancellation is required');
    }

    // Type validation
    if (typeof payload.delay_minutes !== 'number') {
      throw new Error('Validation error: delay_minutes must be a number');
    }
    if (typeof payload.is_cancellation !== 'boolean') {
      throw new Error('Validation error: is_cancellation must be a boolean');
    }
  }
}
