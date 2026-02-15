/**
 * Delay Not Detected Event Handler
 *
 * BL-145 (TD-EVAL-COORDINATOR-001): Kafka consumer handler for delay.not-detected events
 * from delay-tracker service via outbox-relay.
 *
 * AC-5: On delay.not-detected, create workflow with status=COMPLETED and eligibility_result={eligible: false, reason}
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
 * Payload interface for delay.not-detected events
 */
export interface DelayNotDetectedPayload {
  journey_id: string;
  user_id: string;
  reason: 'below_threshold' | 'darwin_unavailable';
  correlation_id?: string; // Optional in payload
}

/**
 * Handler dependencies
 */
interface DelayNotDetectedHandlerDeps {
  workflowRepository: WorkflowRepository;
  logger: Logger;
}

/**
 * DelayNotDetectedHandler class
 */
export class DelayNotDetectedHandler {
  readonly topic = 'delay.not-detected';

  private workflowRepository: WorkflowRepository;
  private logger: Logger;

  constructor(deps: DelayNotDetectedHandlerDeps) {
    this.workflowRepository = deps.workflowRepository;
    this.logger = deps.logger;
  }

  /**
   * Handle incoming delay.not-detected event
   *
   * AC-5: Create workflow with status=COMPLETED and eligibility_result={eligible: false, reason}
   * AC-4: Extract and propagate correlation_id
   * AC-8: Idempotent - skip duplicates
   */
  async handle(payload: DelayNotDetectedPayload | Record<string, unknown>): Promise<void> {
    // Payload validation
    this.validatePayload(payload);

    // AC-4: Extract correlation_id from payload (generate if missing)
    let correlationId = (payload as DelayNotDetectedPayload).correlation_id;
    if (!correlationId || correlationId.trim() === '') {
      correlationId = uuidv4();
      // AC-4: Log warning when correlation_id missing
      this.logger.warn('correlation_id missing from delay.not-detected payload, generated new UUID', {
        journey_id: (payload as DelayNotDetectedPayload).journey_id,
        correlation_id: correlationId,
      });
    }

    const typedPayload = payload as DelayNotDetectedPayload;

    // AC-8: Idempotent duplicate handling
    const existingWorkflow = await this.workflowRepository.getWorkflowByJourneyId(typedPayload.journey_id);
    if (existingWorkflow) {
      // Already processed - skip to maintain idempotency
      // AC-8: Log at info level when duplicate detected
      this.logger.info('Skipping duplicate delay.not-detected event', {
        correlation_id: correlationId,
        journey_id: typedPayload.journey_id,
        existing_status: existingWorkflow.status,
      });
      return;
    }

    try {
      // AC-5: Create evaluation_workflow with status=INITIATED first
      // AC-4: Propagate correlation_id
      const workflow = await this.workflowRepository.createWorkflow(
        typedPayload.journey_id,
        correlationId
      );

      // AC-5: Update workflow status to COMPLETED
      await this.workflowRepository.updateWorkflowStatus(
        workflow.id,
        'COMPLETED',
        correlationId
      );

      // AC-5: Set eligibility_result={eligible: false, reason: payload.reason}
      await this.workflowRepository.updateWorkflowEligibilityResult(
        workflow.id,
        {
          eligible: false,
          reason: typedPayload.reason,
        },
        correlationId
      );

      // AC-9: Log workflow creation with winston-logger
      this.logger.info('Created COMPLETED workflow for delay.not-detected event', {
        correlation_id: correlationId,
        journey_id: typedPayload.journey_id,
        workflow_id: workflow.id,
        reason: typedPayload.reason,
      });
    } catch (error) {
      // AC-9: Log errors with winston-logger
      this.logger.error('Failed to create evaluation workflow for delay.not-detected', {
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
  private validatePayload(payload: DelayNotDetectedPayload | Record<string, unknown>): void {
    // Required fields validation
    if (!payload.journey_id) {
      throw new Error('Validation error: journey_id is required');
    }
    if (!payload.user_id) {
      throw new Error('Validation error: user_id is required');
    }
    if (!payload.reason) {
      throw new Error('Validation error: reason is required');
    }

    // Type validation
    const validReasons = ['below_threshold', 'darwin_unavailable'];
    if (!validReasons.includes(payload.reason as string)) {
      throw new Error('Validation error: reason must be below_threshold or darwin_unavailable');
    }
  }
}
