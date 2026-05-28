/**
 * BL-311: POST /evaluate/:journey_id route must accept + forward body fields
 *
 * Bug Fix  : BL-311 — coordinator route ignores delay_minutes/toc_code/ticket_fare_pence
 *            from the BFF trigger body; WorkflowService therefore has no data to pass
 *            to evaluate(). Fix: route extracts those fields and passes them to
 *            workflowService.initiateEvaluation() as a trigger payload.
 * Phase    : T2-test (Jessie — Test Specification, TDD per ADR-014)
 * Date     : 2026-05-28
 * ADR-029  : Option A fix
 *
 * Test Lock Rule (CLAUDE.md §6): Blake MUST NOT modify these tests.
 * If a test appears wrong, hand back to Jessie with explanation.
 *
 * THESE TESTS MUST FAIL ON CURRENT CODE (HEAD 1b9870f).
 * The current route handler calls workflowService.initiateEvaluation(journey_id) with
 * only the journey_id — no body fields. After the fix the route must read
 * delay_minutes, toc_code, ticket_fare_pence from req.body and forward them.
 *
 * AC coverage map (BL-311 route slice):
 *   AC-5 (route body forwarding): route reads delay_minutes, toc_code, ticket_fare_pence
 *         from request body and forwards them to initiateEvaluation()
 *   AC-6 (idempotency regression): route still returns 422 when active workflow exists
 *
 * Mocked dependencies:
 *   ../../../src/services/workflow-service.js
 *   ../../../src/lib/logger.js
 *
 * ADR references:
 *   ADR-014 — TDD
 *   ADR-029 — Coordinator must call evaluate() not checkEligibility() (Option A fix)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEvaluateRouter } from '../../../src/routes/evaluate.js';

// Mock WorkflowService — we only care what arguments initiateEvaluation receives
vi.mock('../../../src/services/workflow-service.js', () => ({
  WorkflowService: vi.fn().mockImplementation(() => ({
    initiateEvaluation: vi.fn()
  }))
}));

vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { WorkflowService } from '../../../src/services/workflow-service.js';

const VALID_JOURNEY_ID = '550e8400-e29b-41d4-a716-446655440001';

function buildApp() {
  const mockDb = {};
  const app = express();
  app.use(express.json());
  app.use('/evaluate', createEvaluateRouter(mockDb));
  return app;
}

describe('BL-311: POST /evaluate/:journey_id route — body field forwarding (AC-5)', () => {
  let mockInitiateEvaluation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInitiateEvaluation = vi.fn();
    (WorkflowService as any).mockImplementation(() => ({
      initiateEvaluation: mockInitiateEvaluation
    }));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-5 (DISPOSITIVE): route must forward body fields to initiateEvaluation()
  // WILL FAIL on current code: initiateEvaluation is called with only journey_id.
  // The assertion checks the second argument (trigger payload) is present.
  // ──────────────────────────────────────────────────────────────────────────

  describe('AC-5: route forwards delay_minutes + toc_code + ticket_fare_pence from request body', () => {
    it('AC-5: initiateEvaluation receives delay_minutes from request body', async () => {
      // AC-5: The BFF sends delay_minutes in the POST body (ADR-029 Option A).
      // The route MUST extract this and forward it into initiateEvaluation.
      //
      // WILL FAIL on current code:
      //   mockInitiateEvaluation is called with only journey_id string;
      //   second argument (the trigger payload) is undefined.
      //   The assertion "toHaveBeenCalledWith(VALID_JOURNEY_ID, expect.objectContaining({delay_minutes: 47}))"
      //   will fail.

      mockInitiateEvaluation.mockResolvedValue({
        workflow_id: 'wf-bl311-001',
        journey_id: VALID_JOURNEY_ID,
        correlation_id: 'corr-bl311-route-001',
        status: 'INITIATED'
      });

      const app = buildApp();
      const res = await request(app)
        .post(`/evaluate/${VALID_JOURNEY_ID}`)
        .send({ delay_minutes: 47, toc_code: 'VT', ticket_fare_pence: 9850 });

      expect(res.status).toBe(202);

      // AC-5: initiateEvaluation must have received the trigger payload with delay_minutes
      expect(mockInitiateEvaluation).toHaveBeenCalledWith(
        VALID_JOURNEY_ID,
        expect.objectContaining({ delay_minutes: 47 })
      );
    });

    it('AC-5: initiateEvaluation receives toc_code from request body', async () => {
      // AC-5: toc_code is required for evaluate() to produce a correct eligibility result.

      mockInitiateEvaluation.mockResolvedValue({
        workflow_id: 'wf-bl311-002',
        journey_id: VALID_JOURNEY_ID,
        correlation_id: 'corr-bl311-route-002',
        status: 'INITIATED'
      });

      const app = buildApp();
      await request(app)
        .post(`/evaluate/${VALID_JOURNEY_ID}`)
        .send({ delay_minutes: 47, toc_code: 'VT', ticket_fare_pence: 9850 });

      expect(mockInitiateEvaluation).toHaveBeenCalledWith(
        VALID_JOURNEY_ID,
        expect.objectContaining({ toc_code: 'VT' })
      );
    });

    it('AC-5: initiateEvaluation receives ticket_fare_pence from request body', async () => {
      // AC-5: ticket_fare_pence is used by evaluate() to calculate compensation_pence.

      mockInitiateEvaluation.mockResolvedValue({
        workflow_id: 'wf-bl311-003',
        journey_id: VALID_JOURNEY_ID,
        correlation_id: 'corr-bl311-route-003',
        status: 'INITIATED'
      });

      const app = buildApp();
      await request(app)
        .post(`/evaluate/${VALID_JOURNEY_ID}`)
        .send({ delay_minutes: 47, toc_code: 'VT', ticket_fare_pence: 9850 });

      expect(mockInitiateEvaluation).toHaveBeenCalledWith(
        VALID_JOURNEY_ID,
        expect.objectContaining({ ticket_fare_pence: 9850 })
      );
    });

    it('AC-5: all three trigger fields forwarded in a single call', async () => {
      // AC-5: Comprehensive — all three fields present simultaneously.

      mockInitiateEvaluation.mockResolvedValue({
        workflow_id: 'wf-bl311-004',
        journey_id: VALID_JOURNEY_ID,
        correlation_id: 'corr-bl311-route-004',
        status: 'INITIATED'
      });

      const app = buildApp();
      const triggerBody = {
        delay_minutes: 118,
        toc_code: 'GW',
        ticket_fare_pence: 12500,
      };

      await request(app)
        .post(`/evaluate/${VALID_JOURNEY_ID}`)
        .send(triggerBody);

      expect(mockInitiateEvaluation).toHaveBeenCalledWith(
        VALID_JOURNEY_ID,
        expect.objectContaining({
          delay_minutes: 118,
          toc_code: 'GW',
          ticket_fare_pence: 12500,
        })
      );
    });

    it('AC-5: route still works with no body (backward compat — empty trigger payload)', async () => {
      // AC-5: When BFF sends no body (legacy / minimal trigger), route must still
      // invoke initiateEvaluation with journey_id and an empty/undefined payload
      // (evaluate() client defaults apply: toc_code = UNKNOWN, ticket_fare_pence = 0).

      mockInitiateEvaluation.mockResolvedValue({
        workflow_id: 'wf-bl311-005',
        journey_id: VALID_JOURNEY_ID,
        correlation_id: 'corr-bl311-route-005',
        status: 'INITIATED'
      });

      const app = buildApp();
      const res = await request(app)
        .post(`/evaluate/${VALID_JOURNEY_ID}`)
        // No body / empty body
        .send({});

      expect(res.status).toBe(202);
      // initiateEvaluation must still have been called with the journey_id
      expect(mockInitiateEvaluation).toHaveBeenCalledWith(
        VALID_JOURNEY_ID,
        expect.anything()
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC-6 (regression guard): 422 dedup still works after body-forwarding change
  // Should be GREEN on current code — regression guard.
  // ──────────────────────────────────────────────────────────────────────────

  describe('AC-6 (regression guard): 422 dedup still returned for duplicate active workflow', () => {
    it('AC-6: route returns 422 when workflow service throws 422-status error', async () => {
      const duplicateError: any = new Error('Active workflow already exists');
      duplicateError.status = 422;
      mockInitiateEvaluation.mockRejectedValue(duplicateError);

      const app = buildApp();
      const res = await request(app)
        .post(`/evaluate/${VALID_JOURNEY_ID}`)
        .send({ delay_minutes: 47, toc_code: 'VT', ticket_fare_pence: 9850 });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Active workflow already exists');
    });
  });
});
