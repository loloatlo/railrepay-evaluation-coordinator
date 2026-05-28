/**
 * BL-313: evaluation-coordinator Fix A — abort on null/absent toc_code
 *
 *   Fix A (AC-4/AC-5): Abort on missing/null toc_code instead of defaulting 'UNKNOWN'
 *     EligibilityClient.evaluate() currently defaults toc_code to 'UNKNOWN' when absent.
 *     With ADR-030, the coordinator now ALWAYS receives a real toc_code or null from
 *     the BFF trigger payload. Calling evaluate() with 'UNKNOWN' produces a silent
 *     wrong-result (engine finds no rulepack, returns eligible:false incorrectly).
 *     Fix: if toc_code is absent or null in triggerPayload, log an error and update
 *     the workflow to FAILED without calling evaluate() — loud failure, observable.
 *
 * Fix B (dedup unlock) is in: bl313-dedup-unlock-repo.test.ts
 *   (Separated because Fix B tests the real WorkflowRepository class directly, while
 *    Fix A tests need WorkflowRepository mocked so WorkflowService can be tested.)
 *
 * Phase    : T2-test (Jessie — Test Specification, TDD per ADR-014)
 * Date     : 2026-05-28
 * ADR-030  : Option B — coordinator abort + dedup unlock
 *
 * Test Lock Rule (CLAUDE.md §6): Blake MUST NOT modify these tests.
 * If a test appears wrong, hand back to Jessie with explanation.
 *
 * THESE TESTS MUST FAIL ON CURRENT CODE (evaluation-coordinator HEAD).
 *
 * Fix A failures:
 *   Current code: EligibilityClient.evaluate() is called with toc_code='UNKNOWN'
 *   when triggerPayload.toc_code is undefined/null.
 *   Assertion "evaluate() must NOT be called when toc_code is null" → fails.
 *
 * AC coverage map (BL-313 evaluation-coordinator Fix A slice):
 *   AC-4 (DISPOSITIVE): when toc_code is null in triggerPayload, evaluate() is NOT called
 *   AC-5: when toc_code is null/absent, coordinator logs error with journey_id context
 *   AC-5: workflow status updated to FAILED (not PARTIAL_SUCCESS) when toc_code is null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowService } from '../../../src/services/workflow-service.js';

// ─── Logger mock ──────────────────────────────────────────────────────────────
// vi.mock is hoisted — cannot reference outer const/let in factory.
// Use vi.hoisted() to declare the shared mock before the hoist boundary.
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../../../src/lib/logger.js', () => ({
  logger: mockLogger,
}));

// ─── Metrics mock ─────────────────────────────────────────────────────────────
vi.mock('../../../src/lib/metrics.js', () => ({
  evaluationsStartedCounter: { inc: vi.fn() },
  workflowDurationHistogram: { observe: vi.fn() },
  stepFailuresCounter: { inc: vi.fn() },
}));

// ─── EligibilityClient mock ───────────────────────────────────────────────────
const mockEvaluate = vi.fn();
vi.mock('../../../src/services/eligibility-client.js', () => ({
  EligibilityClient: vi.fn().mockImplementation(() => ({
    evaluate: mockEvaluate,
  })),
}));

// ─── WorkflowRepository mock (spy-based) ─────────────────────────────────────
// We mock the entire module so WorkflowService instantiates our mock.
const mockCreateWorkflow = vi.fn();
const mockCreateWorkflowStep = vi.fn();
const mockUpdateWorkflowStep = vi.fn();
const mockUpdateWorkflowStatus = vi.fn();
const mockCreateOutboxEvent = vi.fn();

vi.mock('../../../src/repositories/workflow-repository.js', () => ({
  WorkflowRepository: vi.fn().mockImplementation(() => ({
    createWorkflow: mockCreateWorkflow,
    createWorkflowStep: mockCreateWorkflowStep,
    updateWorkflowStep: mockUpdateWorkflowStep,
    updateWorkflowStatus: mockUpdateWorkflowStatus,
    createOutboxEvent: mockCreateOutboxEvent,
  })),
}));

// ─── Constants ────────────────────────────────────────────────────────────────
const JOURNEY_ID = '550e8400-e29b-41d4-a716-446655440000';
const WORKFLOW_ID = '770e8400-e29b-41d4-a716-446655440002';

const BASE_WORKFLOW = {
  id: WORKFLOW_ID,
  journey_id: JOURNEY_ID,
  correlation_id: '123e4567-e89b-42d3-a456-426614174000',
  status: 'INITIATED',
  created_at: new Date(),
  updated_at: new Date(),
};

const ELIGIBILITY_RESULT = {
  journey_id: JOURNEY_ID,
  eligible: true,
  scheme: 'DR30',
  delay_minutes: 118,
  compensation_percentage: 50,
  compensation_pence: 2500,
  ticket_fare_pence: 5000,
  reasons: ['Eligible — XC rulepack, 118 min delay'],
  applied_rules: ['XC_30MIN_50PCT'],
  evaluation_timestamp: '2025-03-11T12:30:00.000Z',
};

// ─────────────────────────────────────────────────────────────────────────────

describe('BL-313: evaluation-coordinator Fix A — abort when toc_code is null/absent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: createWorkflow succeeds (no dupe)
    mockCreateWorkflow.mockResolvedValue(BASE_WORKFLOW);
    mockCreateWorkflowStep.mockResolvedValue({
      id: 'step-001',
      workflow_id: WORKFLOW_ID,
      step_type: 'ELIGIBILITY_CHECK',
      status: 'PENDING',
      started_at: new Date(),
    });
    mockUpdateWorkflowStep.mockResolvedValue(undefined);
    mockUpdateWorkflowStatus.mockResolvedValue(undefined);
    mockCreateOutboxEvent.mockResolvedValue({});
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-4 (DISPOSITIVE): evaluate() NOT called when toc_code null/absent
  //
  // WILL FAIL on current code: executeEligibilityCheck calls
  //   evaluate({ ..., toc_code: triggerPayload?.toc_code }) where toc_code is
  //   undefined or null — EligibilityClient.evaluate() then defaults to 'UNKNOWN'.
  //   The mock WILL be called. Our assertion "not.toHaveBeenCalled()" fails.
  // ──────────────────────────────────────────────────────────────────────────

  it('AC-4 (DISPOSITIVE): evaluate() is NOT called when triggerPayload.toc_code is null', async () => {
    // AC-4: When the BFF sends toc_code: null (delay_services.toc_code IS NULL),
    // the coordinator MUST abort the eligibility check and mark the workflow FAILED.
    // evaluate() must NOT be called — calling it with 'UNKNOWN' produces wrong results.
    //
    // WILL FAIL on current code: EligibilityClient.evaluate() defaults toc_code to
    // 'UNKNOWN' and IS called. expect(mockEvaluate).not.toHaveBeenCalled() fails.

    const mockDb = { query: vi.fn(), transaction: vi.fn() };
    const service = new WorkflowService(mockDb);

    await service.initiateEvaluation(JOURNEY_ID, {
      delay_minutes: 118,
      toc_code: null,          // BL-313: null toc_code from BFF
      ticket_fare_pence: 5000,
    });

    // Allow the background async to settle
    await new Promise(resolve => setTimeout(resolve, 20));

    // AC-4 DISPOSITIVE: evaluate() must NOT be called with null/UNKNOWN toc_code
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('AC-4: evaluate() is NOT called when toc_code is undefined in triggerPayload', async () => {
    // AC-4: Same as above but toc_code is absent from the payload (undefined).
    // This handles the case where BFF sends no toc_code key at all.
    //
    // WILL FAIL on current code: EligibilityClient.evaluate() is called.

    const mockDb = { query: vi.fn(), transaction: vi.fn() };
    const service = new WorkflowService(mockDb);

    await service.initiateEvaluation(JOURNEY_ID, {
      delay_minutes: 118,
      // toc_code intentionally absent
      ticket_fare_pence: 5000,
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('AC-5: logger.error called with journey_id context when toc_code is null', async () => {
    // AC-5: The abort must be LOUD — an error log with the journey_id so ops can
    // investigate why toc_code was not available.
    //
    // WILL FAIL on current code: there is no abort path, no error log for null toc_code.

    const mockDb = { query: vi.fn(), transaction: vi.fn() };
    const service = new WorkflowService(mockDb);

    await service.initiateEvaluation(JOURNEY_ID, {
      delay_minutes: 118,
      toc_code: null,
      ticket_fare_pence: 5000,
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    // AC-5: error must have been logged with journey_id context
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('toc_code'),
      expect.objectContaining({ journey_id: JOURNEY_ID })
    );
  });

  it('AC-5: workflow status updated to FAILED when toc_code is null (visible outcome)', async () => {
    // AC-5: When the coordinator aborts due to null toc_code, the workflow must
    // be updated to a terminal state (FAILED) so re-evaluation is possible after
    // dedup unlock (Fix B). A workflow stuck in INITIATED with no progress is silent.
    //
    // WILL FAIL on current code: no abort path exists; workflow either stays INITIATED
    // or moves to PARTIAL_SUCCESS after evaluate('UNKNOWN') fails.

    const mockDb = { query: vi.fn(), transaction: vi.fn() };
    const service = new WorkflowService(mockDb);

    await service.initiateEvaluation(JOURNEY_ID, {
      delay_minutes: 118,
      toc_code: null,
      ticket_fare_pence: 5000,
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    // AC-5: updateWorkflowStatus must be called with FAILED
    expect(mockUpdateWorkflowStatus).toHaveBeenCalledWith(
      WORKFLOW_ID,
      'FAILED',
      expect.any(String)
    );
  });

  it('AC-4: evaluate() IS called when toc_code is a valid non-empty string', async () => {
    // AC-4: Positive guard — when toc_code = 'XC' is supplied, evaluate() MUST be called.
    // Ensures the abort logic is conditional on null/absent toc_code only.

    mockEvaluate.mockResolvedValue(ELIGIBILITY_RESULT);

    const mockDb = { query: vi.fn(), transaction: vi.fn() };
    const service = new WorkflowService(mockDb);

    await service.initiateEvaluation(JOURNEY_ID, {
      delay_minutes: 118,
      toc_code: 'XC',
      ticket_fare_pence: 5000,
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    // evaluate() MUST be called with the real toc_code
    expect(mockEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({ toc_code: 'XC', delay_minutes: 118 }),
      expect.any(String)
    );
  });
});
