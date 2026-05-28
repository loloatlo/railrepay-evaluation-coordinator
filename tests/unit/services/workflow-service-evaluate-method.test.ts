/**
 * BL-311: WorkflowService must call evaluate() not checkEligibility()
 *
 * Bug Fix  : BL-311 — coordinator calls deprecated checkEligibility (GET 404) instead of
 *            evaluate() (POST calculate-and-write). No eligibility row ever written;
 *            BFF GET /eligibility/:id 404s forever; poll times out.
 * Phase    : T2-test (Jessie — Test Specification, TDD per ADR-014)
 * Date     : 2026-05-28
 * ADR-029  : Option A fix (human-approved): coordinator must call evaluate() with full payload
 *
 * Test Lock Rule (CLAUDE.md §6): Blake MUST NOT modify these tests.
 * If a test appears wrong, hand back to Jessie with explanation.
 *
 * THESE TESTS MUST FAIL ON CURRENT CODE (HEAD 1b9870f).
 * AC-1 is the dispositive-RED test: WorkflowService.executeEligibilityCheck calls
 * checkEligibility() (not evaluate()), so the assertion
 *   expect(mockEligibilityClient.evaluate).toHaveBeenCalled()
 * will fail with "Expected number of calls: >= 1, Received number of calls: 0".
 *
 * AC coverage map (BL-311 coordinator slice):
 *   AC-1 (DISPOSITIVE): executeEligibilityCheck calls evaluate(), NOT checkEligibility()
 *   AC-2 (payload completeness): evaluate() receives journey_id + toc_code + delay_minutes
 *         + ticket_fare_pence from trigger body (no silent defaults for knowable values)
 *   AC-4 (error logging): when evaluate() rejects, logger.error is called with
 *         correlation_id + cause (current .catch swallows silently — must emit error log)
 *   AC-6 (idempotency regression guard): 422 active-workflow dedup still blocks repeat triggers
 *
 * Mocked dependencies:
 *   ../../../src/repositories/workflow-repository.js
 *   ../../../src/services/eligibility-client.js
 *   ../../../src/lib/logger.js
 *   ../../../src/lib/metrics.js
 *
 * ADR references:
 *   ADR-014 — TDD
 *   ADR-029 — Coordinator must call evaluate() not checkEligibility() (Option A fix)
 *   CLAUDE.md §6.1 — Test Specification Guidelines
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Dependency mocks ─────────────────────────────────────────────────────────
// vi.mock calls are hoisted to the top of the file. Shared logger MUST be
// created via vi.hoisted() so the reference is available when vi.mock factory runs.
// (CLAUDE.md §6.1 #11 — shared mock instance pattern for infrastructure packages)

const sharedLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/repositories/workflow-repository.js', () => ({
  WorkflowRepository: vi.fn()
}));

vi.mock('../../../src/services/eligibility-client.js', () => ({
  EligibilityClient: vi.fn()
}));

vi.mock('../../../src/lib/logger.js', () => ({
  logger: sharedLogger
}));

import { WorkflowService } from '../../../src/services/workflow-service.js';

vi.mock('../../../src/lib/metrics.js', () => ({
  evaluationsStartedCounter: { inc: vi.fn() },
  workflowDurationHistogram: { observe: vi.fn() },
  stepFailuresCounter: { inc: vi.fn() }
}));

import { WorkflowRepository } from '../../../src/repositories/workflow-repository.js';
import { EligibilityClient } from '../../../src/services/eligibility-client.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const JOURNEY_ID = 'cc000000-beef-4000-a000-cc0000000001';
const WORKFLOW_ID = 'cc000000-beef-4000-a000-cc0000000002';
const STEP_ID     = 'cc000000-beef-4000-a000-cc0000000003';

// Values that would come from the trigger body (on-demand path via POST /evaluate/:id)
const TRIGGER_TOC_CODE           = 'VT';   // Virgin Trains (knowable from delay-tracker payload)
const TRIGGER_DELAY_MINUTES      = 47;
const TRIGGER_TICKET_FARE_PENCE  = 9850;

const mockWorkflow = {
  id: WORKFLOW_ID,
  journey_id: JOURNEY_ID,
  correlation_id: 'corr-bl311-001',
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

const mockEligibilityResult = {
  journey_id: JOURNEY_ID,
  eligible: true,
  scheme: 'DR30',
  delay_minutes: TRIGGER_DELAY_MINUTES,
  compensation_percentage: 50,
  compensation_pence: 4925,
  ticket_fare_pence: TRIGGER_TICKET_FARE_PENCE,
  reasons: ['Delay of 47 minutes qualifies for 50% refund under DR30'],
  applied_rules: ['DR30_30MIN_50PCT'],
  evaluation_timestamp: '2026-05-28T12:00:00.000Z',
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('BL-311: WorkflowService — evaluate() vs checkEligibility() method selection', () => {
  let service: WorkflowService;
  let mockDb: Record<string, never>;
  let mockRepo: ReturnType<typeof vi.fn>;
  let mockEligibilityClient: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRepo = {
      createWorkflow: vi.fn(),
      updateWorkflowStatus: vi.fn(),
      createWorkflowStep: vi.fn(),
      updateWorkflowStep: vi.fn(),
      createOutboxEvent: vi.fn(),
      getWorkflowByJourneyId: vi.fn(),
      getWorkflowSteps: vi.fn(),
    } as any;

    mockEligibilityClient = {
      evaluate: vi.fn(),
      checkEligibility: vi.fn(),
    } as any;

    (WorkflowRepository as any).mockImplementation(() => mockRepo);
    (EligibilityClient as any).mockImplementation(() => mockEligibilityClient);

    mockDb = {};
    service = new WorkflowService(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-1 (DISPOSITIVE): must call evaluate(), not checkEligibility()
  // WILL FAIL on HEAD 1b9870f — executeEligibilityCheck calls checkEligibility()
  // Expected failure: "evaluate" mock call count = 0 (not >= 1)
  // ──────────────────────────────────────────────────────────────────────────

  describe('AC-1 (DISPOSITIVE): executeEligibilityCheck calls evaluate() not checkEligibility()', () => {
    it('AC-1: should call eligibilityClient.evaluate() when on-demand trigger fires', async () => {
      // AC-1: The on-demand HTTP trigger path must call evaluate() (POST calculate-and-write),
      // NOT checkEligibility() (GET read — 404s because no row exists yet).
      // This is the root cause of BL-311: checkEligibility is called → 404 forever.
      //
      // DISPOSITIVE: This test MUST FAIL on current code. It will fail with:
      //   AssertionError: Expected "evaluate" to have been called at least once.
      //   Number of calls: 0
      //   (checkEligibility was called instead, but we assert evaluate)

      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockResolvedValue(mockEligibilityResult);
      mockEligibilityClient.checkEligibility.mockResolvedValue(mockEligibilityResult); // old path
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);
      mockRepo.createOutboxEvent.mockResolvedValue(undefined);

      // Supply toc_code so executeEligibilityCheck proceeds past the ADR-030 abort guard
      await service.initiateEvaluation(JOURNEY_ID, { toc_code: 'XC' });
      // Allow background async to settle
      await new Promise(r => setTimeout(r, 20));

      // AC-1: evaluate() MUST have been called (the POST calculate-and-write path)
      expect(mockEligibilityClient.evaluate).toHaveBeenCalled();
    });

    it('AC-1: should NOT call deprecated checkEligibility() when on-demand trigger fires', async () => {
      // AC-1: Complement of the above — checkEligibility() (deprecated GET) must not be called.
      // On current code this assertion PASSES (checkEligibility IS called — wrong method),
      // but coupled with the test above which FAILS, the overall suite is RED.

      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockResolvedValue(mockEligibilityResult);
      mockEligibilityClient.checkEligibility.mockResolvedValue(mockEligibilityResult);
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);
      mockRepo.createOutboxEvent.mockResolvedValue(undefined);

      await service.initiateEvaluation(JOURNEY_ID);
      await new Promise(r => setTimeout(r, 20));

      // AC-1: The deprecated GET method must NOT be called (it returns 404 for new journeys)
      expect(mockEligibilityClient.checkEligibility).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-2: evaluate() payload completeness
  // The EvaluateRequest passed to evaluate() must carry all four knowable fields.
  // WILL FAIL on current code — evaluate() is not called at all.
  // ──────────────────────────────────────────────────────────────────────────

  describe('AC-2: evaluate() receives complete payload (journey_id + toc_code + delay_minutes + ticket_fare_pence)', () => {
    it('AC-2: evaluate() is called with all four required fields from the trigger body', async () => {
      // AC-2: The on-demand trigger carries delay_minutes, toc_code, ticket_fare_pence
      // (added to the HTTP trigger body per ADR-029 Option A). These must arrive in
      // the evaluate() call without silent 'UNKNOWN'/0 defaults for knowable values.
      //
      // WILL FAIL on current code: evaluate() is never called (checkEligibility is called instead).

      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockResolvedValue(mockEligibilityResult);
      mockEligibilityClient.checkEligibility.mockResolvedValue(mockEligibilityResult);
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);
      mockRepo.createOutboxEvent.mockResolvedValue(undefined);

      // The WorkflowService.initiateEvaluation will need to accept these extra fields
      // (from the route body forwarded by evaluate.ts) for the AC-2 payload check.
      // Blake's implementation will accept them as optional params or via a richer
      // EvaluationTrigger interface. For now, we pass them as the second argument;
      // Blake decides the exact signature as long as evaluate() receives these values.
      await service.initiateEvaluation(JOURNEY_ID, {
        toc_code: TRIGGER_TOC_CODE,
        delay_minutes: TRIGGER_DELAY_MINUTES,
        ticket_fare_pence: TRIGGER_TICKET_FARE_PENCE,
      } as any);
      await new Promise(r => setTimeout(r, 20));

      // AC-2: evaluate() must have been called with a request containing all four fields
      expect(mockEligibilityClient.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          journey_id: JOURNEY_ID,
          toc_code: TRIGGER_TOC_CODE,
          delay_minutes: TRIGGER_DELAY_MINUTES,
          ticket_fare_pence: TRIGGER_TICKET_FARE_PENCE,
        }),
        expect.any(String) // correlationId
      );
    });

    it('AC-2: toc_code absent from trigger → ABORT (evaluate NOT called, workflow FAILED, error logged)', async () => {
      // AC-2 re-aligned per ADR-030 / BL-313:
      // The OLD behavior (toc_code absent → evaluate('UNKNOWN')) is ABOLISHED.
      // NEW behavior: toc_code absent/null → coordinator ABORTS immediately:
      //   - logger.error called referencing 'toc_code' + { journey_id }
      //   - workflow status set to FAILED
      //   - evaluate() NOT called
      //
      // NOTE: ticket_fare_pence defaulting to 0 when absent is still valid behavior
      // when toc_code IS present (see AC-2 first test above). This test only covers
      // the toc_code-absent abort path.
      //
      // Self-fix applied by Jessie during T2-test handback (BL-313): the original
      // test asserted evaluate() would be called with 'UNKNOWN' — that premise is
      // abolished by ADR-030. The semantic requirement being tested is now:
      // "absent toc_code → abort, not silent UNKNOWN default".

      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockResolvedValue(mockEligibilityResult);
      mockEligibilityClient.checkEligibility.mockResolvedValue(mockEligibilityResult);
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);

      // Trigger with only delay_minutes — toc_code intentionally absent (triggers abort)
      await service.initiateEvaluation(JOURNEY_ID, {
        delay_minutes: TRIGGER_DELAY_MINUTES,
        // toc_code intentionally absent — ADR-030 abort path
      } as any);
      await new Promise(r => setTimeout(r, 20));

      // AC-2: evaluate() must NOT be called (abort fires before reaching it)
      expect(mockEligibilityClient.evaluate).not.toHaveBeenCalled();
      expect(mockEligibilityClient.checkEligibility).not.toHaveBeenCalled();

      // AC-2: workflow must be set to FAILED (not PARTIAL_SUCCESS or COMPLETED)
      expect(mockRepo.updateWorkflowStatus).toHaveBeenCalledWith(
        WORKFLOW_ID,
        'FAILED',
        expect.any(String)
      );

      // AC-2: logger.error must have been called referencing toc_code
      const errorCalls = sharedLogger.error.mock.calls;
      const hasAbortLog = errorCalls.some((call: any[]) => {
        const msg = call[0] ?? '';
        return typeof msg === 'string' && msg.toLowerCase().includes('toc_code');
      });
      expect(hasAbortLog).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-4: error logging — when evaluate() rejects, logger.error must be called
  // with correlation_id + cause. Current .catch swallows silently.
  // WILL FAIL on current code: (a) evaluate() not called, (b) even if it were,
  // the logger.error call in the catch does not include 'cause' / correlation_id
  // in a testable form per the current implementation.
  // ──────────────────────────────────────────────────────────────────────────

  describe('AC-4: error logging — evaluate() rejection triggers logger.error with correlation_id + cause', () => {
    it('AC-4: should emit logger.error with correlation_id and error cause when evaluate() rejects', async () => {
      // AC-4: Blake found the current .catch on the background promise swallows the error
      // silently. After the fix, when evaluate() throws, logger.error MUST be called with
      // a structured object containing:
      //   - correlation_id
      //   - error / cause (the thrown error's message or object)
      //
      // WILL FAIL on current code because evaluate() is never called.

      const evaluationError = new Error('HTTP_ERROR_500 from eligibility-engine');

      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockRejectedValue(evaluationError);
      mockEligibilityClient.checkEligibility.mockRejectedValue(evaluationError);
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);

      await service.initiateEvaluation(JOURNEY_ID);
      await new Promise(r => setTimeout(r, 20));

      // AC-4: logger.error must have been called with correlation_id in the metadata
      expect(sharedLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          correlation_id: expect.any(String),
        })
      );
    });

    it('AC-4: error log metadata must include the thrown error cause (not just a generic message)', async () => {
      // AC-4: The error cause must be surfaced — not swallowed — so Railway logs show WHY
      // the evaluation failed (HTTP 500, timeout, connection refused, etc.)

      const evaluationError = new Error('TIMEOUT from eligibility-engine');

      mockRepo.createWorkflow.mockResolvedValue(mockWorkflow);
      mockRepo.createWorkflowStep.mockResolvedValue(mockStep);
      mockEligibilityClient.evaluate.mockRejectedValue(evaluationError);
      mockEligibilityClient.checkEligibility.mockRejectedValue(evaluationError);
      mockRepo.updateWorkflowStep.mockResolvedValue(undefined);
      mockRepo.updateWorkflowStatus.mockResolvedValue(undefined);

      // Supply toc_code so executeEligibilityCheck proceeds past the ADR-030 abort guard
      // and reaches the evaluate()-rejection error path that AC-4 is testing
      await service.initiateEvaluation(JOURNEY_ID, { toc_code: 'XC' });
      await new Promise(r => setTimeout(r, 20));

      // AC-4: The error log must carry the error message/cause
      const errorCalls = sharedLogger.error.mock.calls;
      const hasErrorWithCause = errorCalls.some((call: any[]) => {
        const meta = call[1];
        if (!meta) return false;
        // error, cause, message, or err field must contain a reference to the thrown error
        return (
          (typeof meta.error === 'string' && meta.error.length > 0) ||
          (typeof meta.cause === 'string' && meta.cause.length > 0) ||
          (typeof meta.message === 'string' && meta.message.length > 0) ||
          (meta.err instanceof Error)
        );
      });
      expect(hasErrorWithCause).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-6 (regression guard): 422 dedup still blocks repeat triggers
  // This should be GREEN on current code — it is a regression guard ensuring
  // the idempotency logic is preserved through the refactor.
  // ──────────────────────────────────────────────────────────────────────────

  describe('AC-6 (regression guard): 422 active-workflow dedup still blocks repeat triggers', () => {
    it('AC-6: should throw 422-status error when active workflow already exists for journey', async () => {
      // AC-6: Idempotency must survive the evaluate() refactor.
      // WorkflowRepository.createWorkflow throws a 422-status error when an active
      // workflow already exists. The service must propagate this error so the route
      // handler returns 422 to the BFF (preventing duplicate evaluation chains).
      //
      // Expected to be GREEN already — this is a regression guard.

      const duplicateError: any = new Error(
        `Active workflow already exists for journey ${JOURNEY_ID}`
      );
      duplicateError.status = 422;
      mockRepo.createWorkflow.mockRejectedValue(duplicateError);

      await expect(service.initiateEvaluation(JOURNEY_ID)).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining('Active workflow already exists'),
      });
    });

    it('AC-6: should not proceed to evaluate() when workflow creation is rejected with 422', async () => {
      // AC-6: When createWorkflow raises 422, evaluate() must never be reached.

      const duplicateError: any = new Error('Active workflow already exists');
      duplicateError.status = 422;
      mockRepo.createWorkflow.mockRejectedValue(duplicateError);

      try {
        await service.initiateEvaluation(JOURNEY_ID);
      } catch {
        // expected 422 throw
      }

      // Allow any background microtasks to settle
      await new Promise(r => setTimeout(r, 10));

      expect(mockEligibilityClient.evaluate).not.toHaveBeenCalled();
      expect(mockEligibilityClient.checkEligibility).not.toHaveBeenCalled();
    });
  });
});
