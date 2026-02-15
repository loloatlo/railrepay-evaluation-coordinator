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
import type { EligibilityClient } from '../services/eligibility-client.js';

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
  toc_code?: string; // AC-2: Optional for backward compatibility
  correlation_id?: string; // Optional in payload
}

/**
 * Handler dependencies
 */
interface DelayDetectedHandlerDeps {
  workflowRepository: WorkflowRepository;
  eligibilityClient: EligibilityClient; // AC-3: NEW dependency
  logger: Logger;
}

/**
 * DelayDetectedHandler class
 */
export class DelayDetectedHandler {
  readonly topic = 'delay.detected';

  private workflowRepository: WorkflowRepository;
  private eligibilityClient: EligibilityClient;
  private logger: Logger;

  constructor(deps: DelayDetectedHandlerDeps) {
    this.workflowRepository = deps.workflowRepository;
    this.eligibilityClient = deps.eligibilityClient;
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

      // AC-9: Check for toc_code - if missing, fail workflow
      if (!typedPayload.toc_code) {
        this.logger.warn('toc_code missing from delay.detected payload, failing workflow', {
          correlation_id: correlationId,
          journey_id: typedPayload.journey_id,
          workflow_id: workflow.id,
        });

        // Create workflow step for ELIGIBILITY_CHECK with FAILED status
        const step = await this.workflowRepository.createWorkflowStep(
          workflow.id,
          'ELIGIBILITY_CHECK',
          correlationId,
          'FAILED'
        );

        // Update step with error details (if step was created successfully)
        if (step && step.id) {
          await this.workflowRepository.updateWorkflowStep(
            step.id,
            'FAILED',
            correlationId,
            null,
            {
              message: 'missing_toc_code',
              reason: 'toc_code is required for eligibility evaluation but was not present in delay.detected payload'
            }
          );
        }

        // Update workflow status to FAILED
        await this.workflowRepository.updateWorkflowStatus(workflow.id, 'FAILED', correlationId);
        return;
      }

      // AC-3: Trigger eligibility evaluation
      try {
        const eligibilityResult = await this.eligibilityClient.evaluate(
          {
            journey_id: typedPayload.journey_id,
            toc_code: typedPayload.toc_code,
            delay_minutes: typedPayload.delay_minutes,
            ticket_fare_pence: 0 // AC-12: Default to 0
          },
          correlationId
        );

        // AC-4: Store eligibility result and update status to COMPLETED
        await this.workflowRepository.updateWorkflowEligibilityResult(
          workflow.id,
          eligibilityResult,
          correlationId
        );

        await this.workflowRepository.updateWorkflowStatus(
          workflow.id,
          'COMPLETED',
          correlationId
        );

        // AC-6: Write outbox event with evaluation result
        await this.workflowRepository.createOutboxEvent(
          workflow.id,
          'EVALUATION_WORKFLOW',
          'evaluation.completed',
          {
            journey_id: typedPayload.journey_id,
            user_id: typedPayload.user_id,
            eligible: eligibilityResult.eligible,
            scheme: eligibilityResult.scheme,
            compensation_pence: eligibilityResult.compensation_pence,
            correlation_id: correlationId
          },
          correlationId
        );

        this.logger.info('Eligibility evaluation completed successfully', {
          correlation_id: correlationId,
          journey_id: typedPayload.journey_id,
          workflow_id: workflow.id,
          eligible: eligibilityResult.eligible,
          scheme: eligibilityResult.scheme
        });

      } catch (evalError) {
        // AC-8: Handle eligibility-engine errors
        this.logger.error('Eligibility evaluation failed', {
          correlation_id: correlationId,
          journey_id: typedPayload.journey_id,
          workflow_id: workflow.id,
          error: evalError instanceof Error ? evalError.message : String(evalError),
        });

        // Create workflow step for ELIGIBILITY_CHECK with FAILED status
        const step = await this.workflowRepository.createWorkflowStep(
          workflow.id,
          'ELIGIBILITY_CHECK',
          correlationId,
          'FAILED'
        );

        // Determine error details based on error type
        let errorDetails: any = {
          message: evalError instanceof Error ? evalError.message : String(evalError)
        };

        if (evalError instanceof Error) {
          if (evalError.message === 'TIMEOUT') {
            errorDetails = {
              message: 'TIMEOUT',
              timeout_ms: 30000
            };
          } else if ((evalError as any).status) {
            errorDetails = {
              message: evalError.message,
              http_status: (evalError as any).status,
              response: (evalError as any).data
            };
          }
        }

        // Update step with error details (if step was created successfully)
        if (step && step.id) {
          await this.workflowRepository.updateWorkflowStep(
            step.id,
            'FAILED',
            correlationId,
            null,
            errorDetails
          );
        }

        // Update workflow status to FAILED
        await this.workflowRepository.updateWorkflowStatus(workflow.id, 'FAILED', correlationId);
      }
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
