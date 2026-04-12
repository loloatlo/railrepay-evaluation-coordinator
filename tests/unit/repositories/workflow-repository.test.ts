/**
 * Unit tests for WorkflowRepository
 *
 * Coverage target: repositories/workflow-repository.ts >= 80%
 *
 * Covers:
 * - createWorkflow: happy path, duplicate active workflow (422), invalid result
 * - updateWorkflowStatus
 * - updateWorkflowEligibilityResult
 * - createWorkflowStep: happy path, invalid result
 * - updateWorkflowStep
 * - createOutboxEvent: happy path, invalid result
 * - getWorkflowByJourneyId: found, not found, null result
 * - getWorkflowSteps: returns steps, empty, null result
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowRepository } from '../../../src/repositories/workflow-repository.js';

vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

const JOURNEY_ID = '550e8400-e29b-41d4-a716-446655440000';
const WORKFLOW_ID = '770e8400-e29b-41d4-a716-446655440002';
const CORRELATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const STEP_ID = 'aaa00000-e29b-41d4-a716-446655440099';

const mockWorkflowRow = {
  id: WORKFLOW_ID,
  journey_id: JOURNEY_ID,
  correlation_id: CORRELATION_ID,
  status: 'INITIATED',
  created_at: new Date(),
  updated_at: new Date()
};

const mockStepRow = {
  id: STEP_ID,
  workflow_id: WORKFLOW_ID,
  step_type: 'ELIGIBILITY_CHECK',
  status: 'PENDING',
  payload: {},
  started_at: new Date()
};

const mockOutboxRow = {
  id: 'evt-001',
  aggregate_id: WORKFLOW_ID,
  aggregate_type: 'EVALUATION_WORKFLOW',
  event_type: 'CLAIM_SUBMISSION_REQUESTED',
  payload: {},
  correlation_id: CORRELATION_ID,
  published: false,
  created_at: new Date()
};

describe('WorkflowRepository', () => {
  let repo: WorkflowRepository;
  let mockDb: any;

  beforeEach(() => {
    mockDb = { query: vi.fn(), transaction: vi.fn() };
    repo = new WorkflowRepository(mockDb);
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // createWorkflow
  // ─────────────────────────────────────────────

  describe('createWorkflow', () => {
    it('creates and returns workflow row when no active workflow exists', async () => {
      // First query: check for existing (none)
      mockDb.query
        .mockResolvedValueOnce([]) // existing check returns empty
        .mockResolvedValueOnce([mockWorkflowRow]); // INSERT returns row

      const result = await repo.createWorkflow(JOURNEY_ID, CORRELATION_ID);

      expect(result).toEqual(mockWorkflowRow);
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('throws 422 error when active workflow already exists', async () => {
      // First query: check returns existing active workflow
      mockDb.query.mockResolvedValueOnce([{ id: WORKFLOW_ID, status: 'INITIATED' }]);

      await expect(repo.createWorkflow(JOURNEY_ID, CORRELATION_ID)).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining(JOURNEY_ID)
      });

      // INSERT should NOT be called
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('throws when INSERT returns null result', async () => {
      mockDb.query
        .mockResolvedValueOnce([]) // no existing
        .mockResolvedValueOnce(null); // INSERT returns null

      await expect(repo.createWorkflow(JOURNEY_ID, CORRELATION_ID)).rejects.toThrow(
        'Failed to create workflow: invalid result from database'
      );
    });

    it('throws when INSERT returns non-array result', async () => {
      mockDb.query
        .mockResolvedValueOnce([]) // no existing
        .mockResolvedValueOnce('not-an-array'); // INSERT returns wrong type

      await expect(repo.createWorkflow(JOURNEY_ID, CORRELATION_ID)).rejects.toThrow(
        'Failed to create workflow: invalid result from database'
      );
    });

    it('throws when INSERT returns empty array', async () => {
      mockDb.query
        .mockResolvedValueOnce([]) // no existing
        .mockResolvedValueOnce([]); // INSERT returns no rows

      await expect(repo.createWorkflow(JOURNEY_ID, CORRELATION_ID)).rejects.toThrow(
        'Failed to create workflow: no row returned from INSERT'
      );
    });

    it('includes PARTIAL_SUCCESS in the existing-workflow check', async () => {
      mockDb.query.mockResolvedValueOnce([{ id: WORKFLOW_ID, status: 'PARTIAL_SUCCESS' }]);

      await expect(repo.createWorkflow(JOURNEY_ID, CORRELATION_ID)).rejects.toMatchObject({
        status: 422
      });
    });
  });

  // ─────────────────────────────────────────────
  // updateWorkflowStatus
  // ─────────────────────────────────────────────

  describe('updateWorkflowStatus', () => {
    it('calls db.query with correct status and workflow id', async () => {
      mockDb.query.mockResolvedValue(undefined);

      await repo.updateWorkflowStatus(WORKFLOW_ID, 'COMPLETED', CORRELATION_ID);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE evaluation_coordinator.evaluation_workflows'),
        ['COMPLETED', WORKFLOW_ID]
      );
    });

    it('handles PARTIAL_SUCCESS status update', async () => {
      mockDb.query.mockResolvedValue(undefined);

      await expect(
        repo.updateWorkflowStatus(WORKFLOW_ID, 'PARTIAL_SUCCESS', CORRELATION_ID)
      ).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────
  // updateWorkflowEligibilityResult
  // ─────────────────────────────────────────────

  describe('updateWorkflowEligibilityResult', () => {
    it('calls db.query with eligibility result and workflow id', async () => {
      mockDb.query.mockResolvedValue(undefined);
      const eligibilityResult = { eligible: true, scheme: 'DR30' };

      await repo.updateWorkflowEligibilityResult(WORKFLOW_ID, eligibilityResult, CORRELATION_ID);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('eligibility_result'),
        [eligibilityResult, WORKFLOW_ID]
      );
    });
  });

  // ─────────────────────────────────────────────
  // createWorkflowStep
  // ─────────────────────────────────────────────

  describe('createWorkflowStep', () => {
    it('creates and returns step row', async () => {
      mockDb.query.mockResolvedValue([mockStepRow]);

      const result = await repo.createWorkflowStep(
        WORKFLOW_ID,
        'ELIGIBILITY_CHECK',
        CORRELATION_ID,
        'PENDING'
      );

      expect(result).toEqual(mockStepRow);
    });

    it('uses default status PENDING when not provided', async () => {
      mockDb.query.mockResolvedValue([mockStepRow]);

      await repo.createWorkflowStep(WORKFLOW_ID, 'ELIGIBILITY_CHECK', CORRELATION_ID);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['PENDING'])
      );
    });

    it('throws when result is null', async () => {
      mockDb.query.mockResolvedValue(null);

      await expect(
        repo.createWorkflowStep(WORKFLOW_ID, 'ELIGIBILITY_CHECK', CORRELATION_ID)
      ).rejects.toThrow('Failed to create workflow step: no result returned from database');
    });

    it('throws when result is empty array', async () => {
      mockDb.query.mockResolvedValue([]);

      await expect(
        repo.createWorkflowStep(WORKFLOW_ID, 'ELIGIBILITY_CHECK', CORRELATION_ID)
      ).rejects.toThrow('Failed to create workflow step: no result returned from database');
    });

    it('creates CLAIM_CREATION step with PENDING status', async () => {
      const claimStep = { ...mockStepRow, step_type: 'CLAIM_CREATION' };
      mockDb.query.mockResolvedValue([claimStep]);

      const result = await repo.createWorkflowStep(
        WORKFLOW_ID,
        'CLAIM_CREATION',
        CORRELATION_ID,
        'PENDING'
      );

      expect(result.step_type).toBe('CLAIM_CREATION');
    });
  });

  // ─────────────────────────────────────────────
  // updateWorkflowStep
  // ─────────────────────────────────────────────

  describe('updateWorkflowStep', () => {
    it('calls db.query to update step status', async () => {
      mockDb.query.mockResolvedValue(undefined);

      await repo.updateWorkflowStep(
        STEP_ID,
        'COMPLETED',
        CORRELATION_ID,
        { eligible: true },
        null
      );

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE evaluation_coordinator.workflow_steps'),
        ['COMPLETED', { eligible: true }, null, STEP_ID]
      );
    });

    it('uses empty object for payload when not provided', async () => {
      mockDb.query.mockResolvedValue(undefined);

      await repo.updateWorkflowStep(STEP_ID, 'FAILED', CORRELATION_ID);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        ['FAILED', {}, undefined, STEP_ID]
      );
    });

    it('updates step with TIMEOUT status and error details', async () => {
      mockDb.query.mockResolvedValue(undefined);
      const errorDetails = { message: 'TIMEOUT', code: 'ETIMEDOUT' };

      await repo.updateWorkflowStep(STEP_ID, 'TIMEOUT', CORRELATION_ID, null, errorDetails);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        ['TIMEOUT', {}, errorDetails, STEP_ID]
      );
    });
  });

  // ─────────────────────────────────────────────
  // createOutboxEvent
  // ─────────────────────────────────────────────

  describe('createOutboxEvent', () => {
    it('creates and returns outbox event row', async () => {
      mockDb.query.mockResolvedValue([mockOutboxRow]);

      const result = await repo.createOutboxEvent(
        WORKFLOW_ID,
        'EVALUATION_WORKFLOW',
        'CLAIM_SUBMISSION_REQUESTED',
        { journey_id: JOURNEY_ID },
        CORRELATION_ID
      );

      expect(result).toEqual(mockOutboxRow);
      expect(result.published).toBe(false);
    });

    it('inserts with published=false (transactional outbox pattern)', async () => {
      mockDb.query.mockResolvedValue([mockOutboxRow]);

      await repo.createOutboxEvent(
        WORKFLOW_ID,
        'EVALUATION_WORKFLOW',
        'evaluation.completed',
        {},
        CORRELATION_ID
      );

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([false])
      );
    });

    it('throws when result is null', async () => {
      mockDb.query.mockResolvedValue(null);

      await expect(
        repo.createOutboxEvent(WORKFLOW_ID, 'TYPE', 'EVENT', {}, CORRELATION_ID)
      ).rejects.toThrow('Failed to create outbox event: no result returned from database');
    });

    it('throws when result is empty array', async () => {
      mockDb.query.mockResolvedValue([]);

      await expect(
        repo.createOutboxEvent(WORKFLOW_ID, 'TYPE', 'EVENT', {}, CORRELATION_ID)
      ).rejects.toThrow('Failed to create outbox event: no result returned from database');
    });
  });

  // ─────────────────────────────────────────────
  // getWorkflowByJourneyId
  // ─────────────────────────────────────────────

  describe('getWorkflowByJourneyId', () => {
    it('returns workflow row when found', async () => {
      mockDb.query.mockResolvedValue([mockWorkflowRow]);

      const result = await repo.getWorkflowByJourneyId(JOURNEY_ID);

      expect(result).toEqual(mockWorkflowRow);
    });

    it('returns null when no workflow found', async () => {
      mockDb.query.mockResolvedValue([]);

      const result = await repo.getWorkflowByJourneyId(JOURNEY_ID);

      expect(result).toBeNull();
    });

    it('returns null when query result is null', async () => {
      mockDb.query.mockResolvedValue(null);

      const result = await repo.getWorkflowByJourneyId(JOURNEY_ID);

      expect(result).toBeNull();
    });

    it('returns null when query result is not an array', async () => {
      mockDb.query.mockResolvedValue('unexpected-string');

      const result = await repo.getWorkflowByJourneyId(JOURNEY_ID);

      expect(result).toBeNull();
    });

    it('calls db.query with journey_id', async () => {
      mockDb.query.mockResolvedValue([]);

      await repo.getWorkflowByJourneyId(JOURNEY_ID);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE journey_id = $1'),
        [JOURNEY_ID]
      );
    });
  });

  // ─────────────────────────────────────────────
  // getWorkflowSteps
  // ─────────────────────────────────────────────

  describe('getWorkflowSteps', () => {
    it('returns array of steps', async () => {
      mockDb.query.mockResolvedValue([mockStepRow]);

      const result = await repo.getWorkflowSteps(WORKFLOW_ID);

      expect(result).toEqual([mockStepRow]);
    });

    it('returns empty array when no steps', async () => {
      mockDb.query.mockResolvedValue([]);

      const result = await repo.getWorkflowSteps(WORKFLOW_ID);

      expect(result).toEqual([]);
    });

    it('returns empty array when query result is null', async () => {
      mockDb.query.mockResolvedValue(null);

      const result = await repo.getWorkflowSteps(WORKFLOW_ID);

      expect(result).toEqual([]);
    });

    it('returns empty array when query result is not an array', async () => {
      mockDb.query.mockResolvedValue('bad-value');

      const result = await repo.getWorkflowSteps(WORKFLOW_ID);

      expect(result).toEqual([]);
    });

    it('calls db.query with workflow_id', async () => {
      mockDb.query.mockResolvedValue([]);

      await repo.getWorkflowSteps(WORKFLOW_ID);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE workflow_id = $1'),
        [WORKFLOW_ID]
      );
    });

    it('returns multiple steps ordered correctly', async () => {
      const step1 = { ...mockStepRow, id: 'step-1', step_type: 'ELIGIBILITY_CHECK' };
      const step2 = { ...mockStepRow, id: 'step-2', step_type: 'CLAIM_CREATION' };
      mockDb.query.mockResolvedValue([step1, step2]);

      const result = await repo.getWorkflowSteps(WORKFLOW_ID);

      expect(result).toHaveLength(2);
      expect(result[0].step_type).toBe('ELIGIBILITY_CHECK');
      expect(result[1].step_type).toBe('CLAIM_CREATION');
    });
  });
});
