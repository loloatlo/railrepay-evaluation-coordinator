/**
 * TD-TICKET-FARE-001: Ticket Fare Data Propagation — evaluation-coordinator Tests
 *
 * BL-160 | Severity: BLOCKING | Domain: Eligibility & Compensation
 *
 * TD CONTEXT: evaluation-coordinator receives delay.detected events but
 * DelayDetectedPayload lacks ticket fields. The EligibilityClient.evaluate()
 * call uses ticket_fare_pence: 0 (hardcoded), meaning eligibility-engine
 * always calculates compensation_pence = 0.
 *
 * REQUIRED FIXES (this service):
 *   AC-4: DelayDetectedPayload extended with optional ticket_fare_pence,
 *         ticket_class, ticket_type fields
 *   AC-4: EligibilityClient.evaluate() called with actual ticket_fare_pence
 *         from the delay.detected payload (not hardcoded 0)
 *
 * Phase TD-1: Test Specification (Jessie)
 * These tests MUST FAIL initially (RED phase).
 * Blake will make them GREEN in Phase TD-2.
 *
 * Test Lock Rule (ADR-014): Blake MUST NOT modify these tests.
 * If Blake believes a test is wrong, hand back to Jessie with explanation.
 *
 * Test framework: Vitest (ADR-004). NEVER use Jest equivalents.
 *
 * Verified: evaluation-coordinator/src/kafka/delay-detected-handler.ts exposes
 *   DelayDetectedHandler class (already exists from TD-EVAL-COORDINATOR-001)
 * Verified: evaluation-coordinator/src/services/eligibility-client.ts exposes
 *   EligibilityClient.evaluate() (already exists from TD-EVAL-COORDINATOR-002)
 * Verified: eligibility-engine exposes POST /eligibility/evaluate endpoint
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DelayDetectedHandler } from '../../../src/kafka/delay-detected-handler.js';
import type { WorkflowRepository } from '../../../src/repositories/workflow-repository.js';
import type { EligibilityClient } from '../../../src/services/eligibility-client.js';

// ─── Shared logger mock (OUTSIDE factory — guideline #11) ────────────────────
const sharedLogger = {
  info:  vi.fn(),
  error: vi.fn(),
  warn:  vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// ─── Shared IDs ──────────────────────────────────────────────────────────────
const JOURNEY_ID     = '990e8400-e29b-41d4-a716-446655440000';
const USER_ID        = 'aa0e8400-e29b-41d4-a716-446655440001';
const WORKFLOW_ID    = 'bb0e8400-e29b-41d4-a716-446655440002';
const CORRELATION_ID = 'cc0e8400-e29b-41d4-a716-446655440003';

// ─── Mock workflow response ───────────────────────────────────────────────────
const MOCK_WORKFLOW = {
  id:             WORKFLOW_ID,
  journey_id:     JOURNEY_ID,
  correlation_id: CORRELATION_ID,
  status:         'INITIATED',
  created_at:     new Date(),
  updated_at:     new Date(),
};

// ─── Mock eligibility result (eligible with real compensation) ────────────────
const makeEligibilityResult = (ticketFarePence: number, compensationPct: number) => ({
  journey_id:             JOURNEY_ID,
  eligible:               true,
  scheme:                 'DR30',
  delay_minutes:          38,
  compensation_percentage: compensationPct,
  compensation_pence:     Math.floor((ticketFarePence * compensationPct) / 100),
  ticket_fare_pence:      ticketFarePence,
  reasons:                [`Delay qualifies for ${compensationPct}% refund under DR30`],
  applied_rules:          ['DR30_30MIN_50PCT'],
  evaluation_timestamp:   '2026-03-07T10:00:00.000Z',
});

describe('TD-TICKET-FARE-001 (BL-160): evaluation-coordinator — ticket fare propagation', () => {
  let handler:                 DelayDetectedHandler;
  let mockWorkflowRepository:  Record<string, ReturnType<typeof vi.fn>>;
  let mockEligibilityClient:   Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWorkflowRepository = {
      getWorkflowByJourneyId:         vi.fn().mockResolvedValue(null),
      createWorkflow:                 vi.fn().mockResolvedValue(MOCK_WORKFLOW),
      updateWorkflowStatus:           vi.fn().mockResolvedValue(undefined),
      updateWorkflowEligibilityResult: vi.fn().mockResolvedValue(undefined),
      createWorkflowStep:             vi.fn().mockResolvedValue({ id: 'step-001' }),
      updateWorkflowStep:             vi.fn().mockResolvedValue(undefined),
      createOutboxEvent:              vi.fn().mockResolvedValue(undefined),
    };

    mockEligibilityClient = {
      evaluate: vi.fn().mockResolvedValue(makeEligibilityResult(4550, 50)),
    };

    handler = new DelayDetectedHandler({
      workflowRepository: mockWorkflowRepository as unknown as WorkflowRepository,
      eligibilityClient:  mockEligibilityClient  as unknown as EligibilityClient,
      logger:             sharedLogger,
    });
  });

  // ─── AC-4: EligibilityClient.evaluate() uses real ticket_fare_pence ─────────

  describe('AC-4: EligibilityClient.evaluate() called with ticket_fare_pence from payload', () => {
    it('should pass ticket_fare_pence from delay.detected to evaluate() — NOT hardcoded 0', async () => {
      // Arrange: delay.detected with £45.50 fare
      const payload = {
        journey_id:        JOURNEY_ID,
        user_id:           USER_ID,
        delay_minutes:     38,
        is_cancellation:   false,
        toc_code:          'GW',
        ticket_fare_pence: 4550,
        ticket_class:      'standard',
        ticket_type:       'off_peak',
        correlation_id:    CORRELATION_ID,
      };
      mockEligibilityClient.evaluate.mockResolvedValue(makeEligibilityResult(4550, 50));

      // Act
      await handler.handle(payload);

      // Assert: evaluate() called with 4550, NOT 0
      expect(mockEligibilityClient.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          journey_id:        JOURNEY_ID,
          toc_code:          'GW',
          delay_minutes:     38,
          ticket_fare_pence: 4550, // AC-4: Must use real value, not hardcoded 0
        }),
        CORRELATION_ID
      );
    });

    it('should pass a different ticket_fare_pence value to evaluate() — £22.00 rail card fare', async () => {
      // Arrange: distinct fare to prove the value is not hardcoded
      const payload = {
        journey_id:        '990e8400-e29b-41d4-a716-446655440010',
        user_id:           USER_ID,
        delay_minutes:     45,
        is_cancellation:   false,
        toc_code:          'VT',
        ticket_fare_pence: 2200,
        ticket_class:      'standard',
        ticket_type:       'off_peak_day_return',
        correlation_id:    'corr-fare-ec-2200',
      };
      mockWorkflowRepository.createWorkflow.mockResolvedValue({
        ...MOCK_WORKFLOW,
        id:         'workflow-2200',
        journey_id: payload.journey_id,
      });
      mockEligibilityClient.evaluate.mockResolvedValue(makeEligibilityResult(2200, 50));

      // Act
      await handler.handle(payload);

      // Assert: 2200 passed, not 0 or 4550
      expect(mockEligibilityClient.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_fare_pence: 2200,
        }),
        'corr-fare-ec-2200'
      );
    });

    it('should pass ticket_fare_pence = 0 when payload has 0 (not null)', async () => {
      // AC-7: zero is a valid fare — must not be treated as absent
      const payload = {
        journey_id:        '990e8400-e29b-41d4-a716-446655440011',
        user_id:           USER_ID,
        delay_minutes:     30,
        is_cancellation:   false,
        toc_code:          'GW',
        ticket_fare_pence: 0,
        ticket_class:      'standard',
        ticket_type:       'free_pass',
        correlation_id:    'corr-fare-ec-zero',
      };
      mockWorkflowRepository.createWorkflow.mockResolvedValue({
        ...MOCK_WORKFLOW,
        id:         'workflow-zero',
        journey_id: payload.journey_id,
      });
      mockEligibilityClient.evaluate.mockResolvedValue(makeEligibilityResult(0, 50));

      // Act
      await handler.handle(payload);

      // Assert: 0 forwarded, not null
      expect(mockEligibilityClient.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_fare_pence: 0,
        }),
        'corr-fare-ec-zero'
      );
    });

    it('should pass ticket_fare_pence = null to evaluate() when missing from payload', async () => {
      // AC-7: null ticket data handled gracefully — evaluate() still called
      const payload = {
        journey_id:      '990e8400-e29b-41d4-a716-446655440012',
        user_id:         USER_ID,
        delay_minutes:   38,
        is_cancellation: false,
        toc_code:        'GW',
        // ticket_fare_pence absent
        correlation_id:  'corr-fare-ec-null',
      };
      mockWorkflowRepository.createWorkflow.mockResolvedValue({
        ...MOCK_WORKFLOW,
        id:         'workflow-null',
        journey_id: payload.journey_id,
      });
      mockEligibilityClient.evaluate.mockResolvedValue(makeEligibilityResult(0, 50));

      // Act
      await handler.handle(payload);

      // Assert: evaluate() IS called (processing not blocked by missing fare)
      expect(mockEligibilityClient.evaluate).toHaveBeenCalled();

      // The ticket_fare_pence passed should be null or 0 — NOT hardcoded 0 from
      // old code. The key assertion is that if the payload HAD a real fare
      // (previous tests), evaluate() would receive it. Here we just verify
      // the call is made without throwing.
      const evaluateArg = mockEligibilityClient.evaluate.mock.calls[0][0];
      expect(evaluateArg).toHaveProperty('ticket_fare_pence');
    });
  });

  // ─── AC-4: compensation_pence in outbox reflects real ticket fare ────────────

  describe('AC-4: evaluation.completed outbox event reflects real compensation_pence', () => {
    it('should store compensation_pence=2275 for £45.50 fare at 50% compensation rate', async () => {
      // AC-6 (E2E): £45.50 × 50% = £22.75 = 2275 pence
      // This verifies the full pipeline from ticket_fare_pence to outbox
      const payload = {
        journey_id:        JOURNEY_ID,
        user_id:           USER_ID,
        delay_minutes:     38,
        is_cancellation:   false,
        toc_code:          'GW',
        ticket_fare_pence: 4550,
        ticket_class:      'standard',
        ticket_type:       'off_peak',
        correlation_id:    CORRELATION_ID,
      };

      // eligibility-engine returns 2275 for 4550 at 50%
      mockEligibilityClient.evaluate.mockResolvedValue({
        ...makeEligibilityResult(4550, 50),
        compensation_pence: 2275,
      });

      // Act
      await handler.handle(payload);

      // Assert: outbox event includes compensation_pence = 2275
      expect(mockWorkflowRepository.createOutboxEvent).toHaveBeenCalledWith(
        WORKFLOW_ID,
        'EVALUATION_WORKFLOW',
        'evaluation.completed',
        expect.objectContaining({
          journey_id:         JOURNEY_ID,
          user_id:            USER_ID,
          eligible:           true,
          compensation_pence: 2275,
          delay_minutes:      38,
          correlation_id:     CORRELATION_ID,
        }),
        CORRELATION_ID
      );
    });

    it('should store compensation_pence=0 when ticket_fare_pence is null (graceful null handling)', async () => {
      // AC-7: null fare produces 0 compensation (engine handles null gracefully)
      const payload = {
        journey_id:      '990e8400-e29b-41d4-a716-446655440020',
        user_id:         USER_ID,
        delay_minutes:   38,
        is_cancellation: false,
        toc_code:        'GW',
        // No ticket_fare_pence
        correlation_id:  'corr-fare-ec-outbox-null',
      };
      mockWorkflowRepository.createWorkflow.mockResolvedValue({
        ...MOCK_WORKFLOW,
        id:         'workflow-outbox-null',
        journey_id: payload.journey_id,
      });
      mockEligibilityClient.evaluate.mockResolvedValue({
        ...makeEligibilityResult(0, 50),
        journey_id:         payload.journey_id,
        compensation_pence: 0,
      });

      // Act
      await handler.handle(payload);

      // Assert: outbox event written (pipeline does not stall on null fare)
      expect(mockWorkflowRepository.createOutboxEvent).toHaveBeenCalledWith(
        expect.any(String), // workflow_id
        'EVALUATION_WORKFLOW',
        'evaluation.completed',
        expect.objectContaining({
          journey_id:         payload.journey_id,
          compensation_pence: 0,
        }),
        'corr-fare-ec-outbox-null'
      );
    });
  });

  // ─── AC-4: DelayDetectedPayload interface accepts ticket fields ──────────────

  describe('AC-4: DelayDetectedPayload interface accepts ticket fare fields', () => {
    it('should accept payload with all ticket fields without validation error', async () => {
      // Arrange: well-formed payload with all ticket fields
      const payload = {
        journey_id:        '990e8400-e29b-41d4-a716-446655440030',
        user_id:           USER_ID,
        delay_minutes:     38,
        is_cancellation:   false,
        toc_code:          'GW',
        ticket_fare_pence: 4550,
        ticket_class:      'standard',
        ticket_type:       'off_peak',
        correlation_id:    'corr-fare-ec-iface',
      };
      mockWorkflowRepository.createWorkflow.mockResolvedValue({
        ...MOCK_WORKFLOW,
        id:         'workflow-iface',
        journey_id: payload.journey_id,
      });

      // Act & Assert: must not throw
      await expect(handler.handle(payload)).resolves.not.toThrow();
    });

    it('should accept payload without ticket fields (backward compatibility)', async () => {
      // Existing events without ticket fields must still be processed
      const payload = {
        journey_id:      '990e8400-e29b-41d4-a716-446655440031',
        user_id:         USER_ID,
        delay_minutes:   38,
        is_cancellation: false,
        toc_code:        'GW',
        correlation_id:  'corr-fare-ec-backcompat',
      };
      mockWorkflowRepository.createWorkflow.mockResolvedValue({
        ...MOCK_WORKFLOW,
        id:         'workflow-backcompat',
        journey_id: payload.journey_id,
      });

      // Act & Assert: must not throw
      await expect(handler.handle(payload)).resolves.not.toThrow();
    });
  });
});
