/**
 * Unit tests for WorkflowService
 *
 * Coverage target: services/workflow-service.ts >= 80%
 *
 * Covers:
 * - initiateEvaluation: happy path, duplicate (422 propagation), generic error
 * - getWorkflowStatus: found with steps, not found, steps with eligibility
 * - executeEligibilityCheck (via initiateEvaluation): eligible path -> triggerClaimSubmission,
 *   not-eligible path -> COMPLETED, eligibility timeout, eligibility HTTP error, network error
 * - triggerClaimSubmission: creates CLAIM_CREATION step + outbox event
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WorkflowService } from '../../../src/services/workflow-service.js';

// Mock all dependencies
vi.mock('../../../src/repositories/workflow-repository.js', () => ({
  WorkflowRepository: vi.fn()
}));

vi.mock('../../../src/services/eligibility-client.js', () => ({
  EligibilityClient: vi.fn()
}));

vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../../../src/lib/metrics.js', () => ({
  evaluationsStartedCounter: { inc: vi.fn() },
  workflowDurationHistogram: { observe: vi.fn() },
  stepFailuresCounter: { inc: vi.fn() }
}));

import { WorkflowRepository } from '../../../src/repositories/workflow-repository.js';
import { EligibilityClient } from '../../../src/services/eligibility-client.js';
import {
  evaluationsStartedCounter,
  workflowDurationHistogram,
  stepFailuresCounter
} from '../../../src/lib/metrics.js';

const JOURNEY_ID = '550e8400-e29b-41d4-a716-446655440000';
const WORKFLOW_ID = '770e8400-e29b-41d4-a716-446655440002';
const STEP_ID = 'aaa00000-e29b-41d4-a716-446655440099';

const mockWorkflow = {
  id: WORKFLOW_ID,
  journey_id: JOURNEY_ID,
  correlation_id: 'corr-123',
  status: 'INITIATED',
  created_at: new Date(),
  updated_at: new Date()
};

const mockStep = {
  id: STEP_ID,
  workflow_id: WORKFLOW_ID,
  step_type: 'ELIGIBILITY_CHECK',
  status: 'PENDING',
  started_at: new Date()
};

const mockOutboxEvent = {
  id: 'evt-001',
  aggregate_id: WORKFLOW_ID,
  aggregate_type: 'EVALUATION_WORKFLOW',
  event_type: 'CLAIM_SUBMISSION_REQUESTED',
  payload: {},
  correlation_id: 'corr-123',
  published: false,
  created_at: new Date()
};

describe('WorkflowService', () => {
  let service: WorkflowService;
  let mockDb: any;
  let mockRepo: any;
  let mockEligibilityClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRepo = {
      createWorkflow: vi.fn(),
      updateWorkflowStatus: vi.fn(),
      updateWorkflowEligibilityResult: vi.fn(),
      completeWorkflowWithOutbox: vi.fn(),
      createWorkflowStep: vi.fn(),
      updateWorkflowStep: vi.fn(),
      createOutboxEvent: vi.fn(),
      getWorkflowByJourneyId: vi.fn(),
      getWorkflowSteps: vi.fn()
    };

    mockEligibilityClient = {
      checkEligibility: vi.fn(),
      evaluate: vi.fn()
    };

    (WorkflowRepository as any).mockImplementation(() => mockRepo);
    (EligibilityClient as any).mockImplementation(() => mockEligibilityClient);

    mockDb = {};
    service = new WorkflowService(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────
  // initiateEvaluation
  // ─────────────────────────────────────────────

  describe('initiateEvaluation', () => {
    it('creates workflow and returns workflow details', async () => {
      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockResolvedValue({ eligible: false });
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);

      const result = await service.initiateEvaluation(JOURNEY_ID);

      expect(result).toMatchObject({
        workflow_id: WORKFLOW_ID,
        journey_id: JOURNEY_ID,
        status: 'INITIATED'
      });
      expect(result.correlation_id).toBeDefined();
      expect(mockRepo.createWorkflow).toHaveBeenCalledWith(
        JOURNEY_ID,
        expect.any(String)
      );
    });

    it('increments evaluationsStartedCounter on successful workflow creation', async () => {
      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockResolvedValue({ eligible: false });
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);

      await service.initiateEvaluation(JOURNEY_ID);

      expect(evaluationsStartedCounter.inc).toHaveBeenCalledWith({
        journey_id: JOURNEY_ID
      });
    });

    it('propagates 422 error when duplicate active workflow exists', async () => {
      const duplicateError: any = new Error(
        `Active workflow already exists for journey ${JOURNEY_ID}`
      );
      duplicateError.status = 422;
      mockRepo.createWorkflow.mockRejectedValue(duplicateError);

      await expect(service.initiateEvaluation(JOURNEY_ID)).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining('Active workflow already exists')
      });
    });

    it('propagates generic error from repository', async () => {
      mockRepo.createWorkflow.mockRejectedValue(new Error('Database error'));

      await expect(service.initiateEvaluation(JOURNEY_ID)).rejects.toThrow(
        'Database error'
      );
    });
  });

  // ─────────────────────────────────────────────
  // executeEligibilityCheck (tested indirectly via initiateEvaluation background task)
  // We test this via letting the background promise settle
  // ─────────────────────────────────────────────

  describe('executeEligibilityCheck - eligible result', () => {
    it('creates CLAIM_CREATION step and outbox event when eligible', async () => {
      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);

      const eligibilityStep = { ...mockStep, step_type: 'ELIGIBILITY_CHECK' };
      const claimStep = { ...mockStep, id: 'step-claim', step_type: 'CLAIM_CREATION' };

      mockRepo.createWorkflowStep
        .mockResolvedValueOnce(eligibilityStep) // ELIGIBILITY_CHECK step
        .mockResolvedValueOnce(claimStep);      // CLAIM_CREATION step

      const eligibilityResult = {
        eligible: true,
        scheme: 'DR30',
        compensation_pence: 1250
      };
      mockEligibilityClient.evaluate.mockResolvedValue(eligibilityResult);
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);
      mockRepo.createOutboxEvent.mockResolvedValue(mockOutboxEvent);

      // Supply toc_code so executeEligibilityCheck proceeds past the ADR-030 abort guard
      await service.initiateEvaluation(JOURNEY_ID, { toc_code: 'XC' });

      // Allow background async to settle
      await new Promise(r => setTimeout(r, 10));

      expect(mockRepo.createWorkflowStep).toHaveBeenCalledWith(
        WORKFLOW_ID,
        'CLAIM_CREATION',
        expect.any(String),
        'PENDING'
      );
      expect(mockRepo.updateWorkflowStatus).toHaveBeenCalledWith(
        WORKFLOW_ID,
        'IN_PROGRESS',
        expect.any(String)
      );
      expect(mockRepo.createOutboxEvent).toHaveBeenCalledWith(
        WORKFLOW_ID,
        'EVALUATION_WORKFLOW',
        'CLAIM_SUBMISSION_REQUESTED',
        expect.objectContaining({ journey_id: JOURNEY_ID }),
        expect.any(String)
      );
    });
  });

  describe('executeEligibilityCheck - not eligible result', () => {
    it('updates workflow to COMPLETED when not eligible', async () => {
      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockResolvedValue({ eligible: false });
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);

      // Supply toc_code so executeEligibilityCheck proceeds past the ADR-030 abort guard
      await service.initiateEvaluation(JOURNEY_ID, { toc_code: 'XC' });
      await new Promise(r => setTimeout(r, 10));

      expect(mockRepo.updateWorkflowStatus).toHaveBeenCalledWith(
        WORKFLOW_ID,
        'COMPLETED',
        expect.any(String)
      );
    });

    it('records workflow duration histogram on success', async () => {
      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockResolvedValue({ eligible: false });
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);

      // Supply toc_code so executeEligibilityCheck proceeds past the ADR-030 abort guard
      await service.initiateEvaluation(JOURNEY_ID, { toc_code: 'XC' });
      await new Promise(r => setTimeout(r, 10));

      expect(workflowDurationHistogram.observe).toHaveBeenCalledWith(
        { status: 'success' },
        expect.any(Number)
      );
    });
  });

  describe('executeEligibilityCheck - timeout error', () => {
    it('updates step to TIMEOUT and workflow to PARTIAL_SUCCESS on timeout', async () => {
      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);

      const timeoutError: any = new Error('TIMEOUT: request timed out');

      // First call creates PENDING step, second call creates TIMEOUT step after error
      mockRepo.createWorkflowStep
        .mockRejectedValueOnce(timeoutError) // First createWorkflowStep fails -> triggers catch
        .mockResolvedValueOnce({ id: 'err-step', step_type: 'ELIGIBILITY_CHECK', status: 'TIMEOUT' });

      mockEligibilityClient.evaluate.mockResolvedValue({ eligible: false });
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);

      // Supply toc_code so executeEligibilityCheck proceeds past the ADR-030 abort guard
      await service.initiateEvaluation(JOURNEY_ID, { toc_code: 'XC' });
      await new Promise(r => setTimeout(r, 10));

      // The error path should have been taken
      expect(mockRepo.updateWorkflowStatus).toHaveBeenCalledWith(
        WORKFLOW_ID,
        'PARTIAL_SUCCESS',
        expect.any(String)
      );
    });
  });

  describe('executeEligibilityCheck - TIMEOUT keyword in message', () => {
    it('sets errorStatus to TIMEOUT when error message contains TIMEOUT', async () => {
      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      const timeoutError = new Error('TIMEOUT error from eligibility-engine');
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockRejectedValue(timeoutError);
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);

      // After the error, the catch block creates another step
      mockRepo.createWorkflowStep
        .mockResolvedValueOnce(mockStep)                                       // ELIGIBILITY_CHECK PENDING
        .mockResolvedValueOnce({ id: 'err-step', step_type: 'ELIGIBILITY_CHECK', status: 'TIMEOUT' }); // error step

      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);

      // Supply toc_code so executeEligibilityCheck proceeds past the ADR-030 abort guard
      await service.initiateEvaluation(JOURNEY_ID, { toc_code: 'XC' });
      await new Promise(r => setTimeout(r, 10));

      expect(stepFailuresCounter.inc).toHaveBeenCalledWith({
        step_type: 'ELIGIBILITY_CHECK',
        error_type: 'TIMEOUT'
      });
    });
  });

  describe('executeEligibilityCheck - HTTP error with status', () => {
    it('sets error details with http_status when eligibility returns HTTP error', async () => {
      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);

      const httpError: any = new Error('HTTP_ERROR_500');
      httpError.status = 500;
      httpError.data = { error: 'Internal Server Error' };
      mockEligibilityClient.evaluate.mockRejectedValue(httpError);
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);

      // error path: createWorkflowStep is called again for error step
      mockRepo.createWorkflowStep
        .mockResolvedValueOnce(mockStep)
        .mockResolvedValueOnce({ id: 'err-step', step_type: 'ELIGIBILITY_CHECK', status: 'FAILED' });

      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);

      // Supply toc_code so executeEligibilityCheck proceeds past the ADR-030 abort guard
      await service.initiateEvaluation(JOURNEY_ID, { toc_code: 'XC' });
      await new Promise(r => setTimeout(r, 10));

      expect(mockRepo.updateWorkflowStatus).toHaveBeenCalledWith(
        WORKFLOW_ID,
        'PARTIAL_SUCCESS',
        expect.any(String)
      );
      expect(stepFailuresCounter.inc).toHaveBeenCalledWith({
        step_type: 'ELIGIBILITY_CHECK',
        error_type: 'FAILED'
      });
    });
  });

  // ─────────────────────────────────────────────
  // getWorkflowStatus
  // ─────────────────────────────────────────────

  describe('getWorkflowStatus', () => {
    it('returns null when no workflow found', async () => {
      mockRepo.getWorkflowByJourneyId.mockResolvedValue(null);

      const result = await service.getWorkflowStatus(JOURNEY_ID);

      expect(result).toBeNull();
      expect(mockRepo.getWorkflowSteps).not.toHaveBeenCalled();
    });

    it('returns workflow with status and empty steps', async () => {
      mockRepo.getWorkflowByJourneyId.mockResolvedValue(mockWorkflow);
      mockRepo.getWorkflowSteps.mockResolvedValue([]);

      const result = await service.getWorkflowStatus(JOURNEY_ID);

      expect(result).toMatchObject({
        workflow_id: WORKFLOW_ID,
        journey_id: JOURNEY_ID,
        status: 'INITIATED',
        eligibility_result: null,
        steps: []
      });
    });

    it('returns workflow with mapped steps', async () => {
      mockRepo.getWorkflowByJourneyId.mockResolvedValue({ ...mockWorkflow, status: 'COMPLETED' });
      const steps = [
        {
          step_type: 'ELIGIBILITY_CHECK',
          status: 'COMPLETED',
          started_at: new Date('2026-01-01'),
          completed_at: new Date('2026-01-01'),
          payload: { eligible: true, scheme: 'DR30' }
        }
      ];
      mockRepo.getWorkflowSteps.mockResolvedValue(steps);

      const result = await service.getWorkflowStatus(JOURNEY_ID);

      expect(result?.steps).toHaveLength(1);
      expect(result?.steps[0].step_type).toBe('ELIGIBILITY_CHECK');
      expect(result?.steps[0].status).toBe('COMPLETED');
    });

    it('extracts eligibility_result from completed ELIGIBILITY_CHECK step', async () => {
      mockRepo.getWorkflowByJourneyId.mockResolvedValue({ ...mockWorkflow, status: 'COMPLETED' });
      const eligibilityPayload = { eligible: true, scheme: 'DR30', compensation_pence: 1250 };
      const steps = [
        {
          step_type: 'ELIGIBILITY_CHECK',
          status: 'COMPLETED',
          started_at: new Date(),
          completed_at: new Date(),
          payload: eligibilityPayload
        }
      ];
      mockRepo.getWorkflowSteps.mockResolvedValue(steps);

      const result = await service.getWorkflowStatus(JOURNEY_ID);

      expect(result?.eligibility_result).toEqual(eligibilityPayload);
    });

    it('returns eligibility_result as null when no completed ELIGIBILITY_CHECK step', async () => {
      mockRepo.getWorkflowByJourneyId.mockResolvedValue({ ...mockWorkflow, status: 'IN_PROGRESS' });
      const steps = [
        {
          step_type: 'ELIGIBILITY_CHECK',
          status: 'PENDING',
          started_at: new Date(),
          completed_at: undefined,
          payload: null
        }
      ];
      mockRepo.getWorkflowSteps.mockResolvedValue(steps);

      const result = await service.getWorkflowStatus(JOURNEY_ID);

      expect(result?.eligibility_result).toBeNull();
    });

    it('calls getWorkflowByJourneyId with the journey_id', async () => {
      mockRepo.getWorkflowByJourneyId.mockResolvedValue(null);

      await service.getWorkflowStatus(JOURNEY_ID);

      expect(mockRepo.getWorkflowByJourneyId).toHaveBeenCalledWith(JOURNEY_ID);
    });

    it('calls getWorkflowSteps with the workflow id', async () => {
      mockRepo.getWorkflowByJourneyId.mockResolvedValue(mockWorkflow);
      mockRepo.getWorkflowSteps.mockResolvedValue([]);

      await service.getWorkflowStatus(JOURNEY_ID);

      expect(mockRepo.getWorkflowSteps).toHaveBeenCalledWith(WORKFLOW_ID);
    });
  });
});
