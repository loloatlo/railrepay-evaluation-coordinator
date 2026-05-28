/**
 * Workflow Service - Core business logic for evaluation workflows
 */

import { v4 as uuidv4 } from 'uuid';
import { WorkflowRepository } from '../repositories/workflow-repository.js';
import { EligibilityClient } from './eligibility-client.js';
import { logger } from '../lib/logger.js';
import { 
  evaluationsStartedCounter, 
  workflowDurationHistogram, 
  stepFailuresCounter 
} from '../lib/metrics.js';

export class WorkflowService {
  private workflowRepo: WorkflowRepository;
  private eligibilityClient: EligibilityClient;

  constructor(db: any) {
    this.workflowRepo = new WorkflowRepository(db);
    this.eligibilityClient = new EligibilityClient();
  }

  async initiateEvaluation(journeyId: string, triggerPayload?: { toc_code?: string | null; delay_minutes?: number; ticket_fare_pence?: number }) {
    const correlationId = uuidv4();

    logger.info('Initiating evaluation workflow', {
      correlation_id: correlationId,
      journey_id: journeyId
    });

    try {
      // Create workflow with status INITIATED
      // (Duplicate check now happens atomically in repository layer)
      const workflow = await this.workflowRepo.createWorkflow(journeyId, correlationId);

      // Increment started metric
      evaluationsStartedCounter.inc({ journey_id: journeyId });

      // Execute eligibility check in background
      this.executeEligibilityCheck(workflow.id, journeyId, correlationId, triggerPayload).catch(err => {
        logger.error('Eligibility check failed', {
          correlation_id: correlationId,
          error: err.message
        });
      });

      return {
        workflow_id: workflow.id,
        journey_id: workflow.journey_id,
        correlation_id: workflow.correlation_id,
        status: workflow.status
      };
    } catch (error) {
      logger.error('Failed to initiate evaluation workflow', {
        correlation_id: correlationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private async executeEligibilityCheck(workflowId: string, journeyId: string, correlationId: string, triggerPayload?: { toc_code?: string | null; delay_minutes?: number; ticket_fare_pence?: number }) {
    const startTime = Date.now();

    try {
      // BL-313 AC-4/AC-5: Abort early if toc_code is null or absent.
      // Calling evaluate() with UNKNOWN toc_code produces a silent wrong result
      // (engine finds no rulepack, returns eligible:false incorrectly). Loud failure is better.
      if (!triggerPayload?.toc_code) {
        logger.error('Aborting eligibility check: toc_code is null or absent in triggerPayload', {
          journey_id: journeyId,
          correlation_id: correlationId,
        });
        await this.workflowRepo.updateWorkflowStatus(workflowId, 'FAILED', correlationId);
        return;
      }

      // Create workflow step for eligibility check
      const step = await this.workflowRepo.createWorkflowStep(
        workflowId,
        'ELIGIBILITY_CHECK',
        correlationId,
        'PENDING'
      );

      // Call eligibility engine using evaluate() (POST calculate-and-write — ADR-029 Option A)
      // delay_minutes defaults to 0 only when genuinely absent from the trigger payload
      const evaluateRequest = {
        journey_id: journeyId,
        toc_code: triggerPayload.toc_code,
        delay_minutes: triggerPayload?.delay_minutes ?? 0,
        ticket_fare_pence: triggerPayload?.ticket_fare_pence,
      };
      const eligibilityResult = await this.eligibilityClient.evaluate(evaluateRequest, correlationId);

      // Update step status to COMPLETED with payload
      await this.workflowRepo.updateWorkflowStep(
        step.id,
        'COMPLETED',
        correlationId,
        eligibilityResult
      );

      logger.info('Eligibility check completed', { 
        correlation_id: correlationId, 
        eligible: eligibilityResult.eligible 
      });

      // If eligible, trigger claim submission
      if (eligibilityResult.eligible) {
        await this.triggerClaimSubmission(workflowId, journeyId, eligibilityResult, correlationId);
      } else {
        // Update workflow status to indicate completion without claim
        await this.workflowRepo.updateWorkflowStatus(workflowId, 'COMPLETED', correlationId);
      }

      // Record workflow duration
      const duration = (Date.now() - startTime) / 1000;
      workflowDurationHistogram.observe({ status: 'success' }, duration);

    } catch (error) {
      logger.error('Eligibility check error', { 
        correlation_id: correlationId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });

      // Handle different error types
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStatus = errorMessage.includes('TIMEOUT') ? 'TIMEOUT' : 'FAILED';
      const errorDetails: any = { message: errorMessage };

      if ((error as any).status) {
        errorDetails.http_status = (error as any).status;
        errorDetails.response = (error as any).data;
      }

      // Update step status to FAILED/TIMEOUT
      const step = await this.workflowRepo.createWorkflowStep(
        workflowId,
        'ELIGIBILITY_CHECK',
        correlationId,
        errorStatus
      );
      
      await this.workflowRepo.updateWorkflowStep(
        step.id,
        errorStatus,
        correlationId,
        null,
        errorDetails
      );

      // Update workflow status to PARTIAL_SUCCESS (critical step failed but workflow continues)
      await this.workflowRepo.updateWorkflowStatus(workflowId, 'PARTIAL_SUCCESS', correlationId);

      // Increment error counter
      stepFailuresCounter.inc({ 
        step_type: 'ELIGIBILITY_CHECK',
        error_type: errorStatus 
      });
    }
  }

  private async triggerClaimSubmission(
    workflowId: string,
    journeyId: string,
    eligibilityResult: any,
    correlationId: string
  ) {
    logger.info('Triggering claim submission', { 
      correlation_id: correlationId, 
      workflow_id: workflowId 
    });

    // Create workflow step for claim creation
    await this.workflowRepo.createWorkflowStep(
      workflowId,
      'CLAIM_CREATION',
      correlationId,
      'PENDING'
    );

    // Update workflow status to IN_PROGRESS
    await this.workflowRepo.updateWorkflowStatus(workflowId, 'IN_PROGRESS', correlationId);

    // Write outbox event for claim submission
    await this.workflowRepo.createOutboxEvent(
      workflowId,
      'EVALUATION_WORKFLOW',
      'CLAIM_SUBMISSION_REQUESTED',
      {
        journey_id: journeyId,
        eligibility_result: eligibilityResult,
        correlation_id: correlationId
      },
      correlationId
    );

    logger.info('Claim submission triggered', { 
      correlation_id: correlationId, 
      workflow_id: workflowId 
    });
  }

  async getWorkflowStatus(journeyId: string) {
    const workflow = await this.workflowRepo.getWorkflowByJourneyId(journeyId);
    
    if (!workflow) {
      return null;
    }

    const steps = await this.workflowRepo.getWorkflowSteps(workflow.id);

    // Extract eligibility result from completed eligibility check step
    const eligibilityStep = steps.find(s => s.step_type === 'ELIGIBILITY_CHECK' && s.status === 'COMPLETED');
    const eligibilityResult = eligibilityStep?.payload || null;

    return {
      workflow_id: workflow.id,
      journey_id: workflow.journey_id,
      status: workflow.status,
      eligibility_result: eligibilityResult,
      steps: steps.map(step => ({
        step_type: step.step_type,
        status: step.status,
        started_at: step.started_at,
        completed_at: step.completed_at
      }))
    };
  }
}
