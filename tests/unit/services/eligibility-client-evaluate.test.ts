/**
 * Unit tests for EligibilityClient.evaluate() - BL-146 (TD-EVAL-COORDINATOR-002)
 *
 * Phase: TD-1 Test Specification (Jessie)
 * Author: Jessie (QA Engineer)
 * Date: 2026-02-15
 *
 * PURPOSE:
 * Tests for the CORRECTED EligibilityClient that calls POST /eligibility/evaluate
 * instead of GET /eligibility/:id. This is the core fix for BL-146.
 *
 * ACCEPTANCE CRITERIA COVERAGE:
 * - AC-1: Fix EligibilityClient to call POST /eligibility/evaluate (not GET)
 * - AC-2: Pass required fields: journey_id, toc_code, delay_minutes, ticket_fare_pence
 * - AC-5: Correlation ID propagation on HTTP calls (X-Correlation-ID header)
 * - AC-8: Handle eligibility-engine unavailability gracefully (timeout, 5xx, connection refused)
 * - AC-9: [SUPERSEDED BY BL-315 AC-V4] — original: "use default 'UNKNOWN' if not in payload".
 *         BL-315 AC-V4 intentionally replaces this behavior: sending 'UNKNOWN' caused the
 *         eligibility-engine to return 400, which propagated as a workflow failure and a
 *         ~30-second BFF timeout. The corrected contract is: do NOT send 'UNKNOWN'; instead
 *         log a logger.warn with journey_id context and fail fast. See the updated test below.
 * - AC-12: ticket_fare_pence defaults to 0 when unavailable
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios from 'axios';
import { EligibilityClient } from '../../../src/services/eligibility-client.js';

// ---------------------------------------------------------------------------
// Shared logger mock (guideline #11 — OUTSIDE factory via vi.hoisted(), same instance)
// vi.hoisted() is required in Vitest so the reference is available when vi.mock()
// factory is hoisted to the top of the module (avoids "Cannot access before init" TDZ).
// ---------------------------------------------------------------------------
const sharedLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// Mock axios module
vi.mock('axios', () => ({
  default: {
    post: vi.fn(), // Changed from get to post for AC-1
    isAxiosError: vi.fn()
  }
}));

describe('BL-146: EligibilityClient.evaluate() - POST /eligibility/evaluate', () => {
  let client: EligibilityClient;
  const journeyId = '550e8400-e29b-41d4-a716-446655440000';
  const correlationId = '123e4567-e89b-42d3-a456-426614174000';

  beforeEach(() => {
    client = new EligibilityClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * AC-1: EligibilityClient calls POST /eligibility/evaluate (not GET /eligibility/:id)
   * AC-2: Pass required fields: journey_id, toc_code, delay_minutes, ticket_fare_pence
   * AC-5: X-Correlation-ID header propagation
   */
  it('should call POST /eligibility/evaluate with correct payload and headers', async () => {
    // Arrange
    const evaluateRequest = {
      journey_id: journeyId,
      toc_code: 'GW',
      delay_minutes: 45,
      ticket_fare_pence: 2500
    };

    const mockResponse = {
      data: {
        journey_id: journeyId,
        eligible: true,
        scheme: 'DR30',
        delay_minutes: 45,
        compensation_percentage: 50,
        compensation_pence: 1250,
        ticket_fare_pence: 2500,
        reasons: ['Delay of 45 minutes qualifies for 50% refund under DR30 scheme'],
        applied_rules: ['DR30_30MIN_50PCT'],
        evaluation_timestamp: '2026-02-15T10:00:00.000Z'
      }
    };
    vi.mocked(axios.post).mockResolvedValue(mockResponse);

    // Act
    const result = await client.evaluate(evaluateRequest, correlationId);

    // Assert - AC-1: POST to /eligibility/evaluate endpoint
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:3002/eligibility/evaluate', // Correct endpoint
      evaluateRequest, // AC-2: Request body with all required fields
      expect.objectContaining({
        timeout: 30000,
        headers: {
          'X-Correlation-ID': correlationId // AC-5: Correlation ID header
        }
      })
    );

    // Assert - Response includes all fields from eligibility-engine
    expect(result).toEqual(mockResponse.data);
    expect(result.journey_id).toBe(journeyId);
    expect(result.eligible).toBe(true);
    expect(result.scheme).toBe('DR30');
    expect(result.compensation_pence).toBe(1250);
  });

  /**
   * AC-12: ticket_fare_pence defaults to 0 when not provided
   */
  it('should default ticket_fare_pence to 0 when not provided in request', async () => {
    // Arrange
    const evaluateRequest = {
      journey_id: journeyId,
      toc_code: 'GW',
      delay_minutes: 45
      // ticket_fare_pence intentionally omitted
    };

    const mockResponse = {
      data: {
        journey_id: journeyId,
        eligible: true,
        scheme: 'DR30',
        delay_minutes: 45,
        compensation_percentage: 50,
        compensation_pence: 0, // 0 because ticket_fare_pence was 0
        ticket_fare_pence: 0,
        reasons: ['Delay qualifies but compensation is 0 due to missing fare'],
        applied_rules: ['DR30_30MIN_50PCT'],
        evaluation_timestamp: '2026-02-15T10:00:00.000Z'
      }
    };
    vi.mocked(axios.post).mockResolvedValue(mockResponse);

    // Act
    const result = await client.evaluate(evaluateRequest, correlationId);

    // Assert - AC-12: ticket_fare_pence should be 0 in the request sent to eligibility-engine
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:3002/eligibility/evaluate',
      expect.objectContaining({
        journey_id: journeyId,
        toc_code: 'GW',
        delay_minutes: 45,
        ticket_fare_pence: 0 // Defaulted to 0
      }),
      expect.any(Object)
    );

    expect(result.compensation_pence).toBe(0);
  });

  /**
   * AC-9: Handle missing toc_code — corrected behavior per BL-315 AC-V4
   *
   * Superseded by BL-315 AC-V4: the OLD AC-9 contract ("default to 'UNKNOWN'")
   * is intentionally replaced. Sending 'UNKNOWN' to the eligibility-engine causes
   * a 400 "Unknown TOC code: UNKNOWN" which propagated as a ~30s BFF timeout.
   *
   * NEW contract (BL-315 AC-V4): when toc_code is missing/null/undefined,
   * EligibilityClient.evaluate() MUST:
   *   (a) NOT call axios.post with toc_code === 'UNKNOWN'
   *   (b) emit logger.warn with journey_id context
   *   (c) fail fast (reject or return without a successful downstream call)
   *
   * FAILS TODAY (before Blake's fix): the code still does `request.toc_code ?? 'UNKNOWN'`
   * and calls axios.post — so (a) and (b) fail.
   */
  it('should NOT send toc_code="UNKNOWN" when toc_code is missing — warn and fail fast (BL-315 AC-V4, supersedes BL-146 AC-9)', async () => {
    // Arrange — toc_code intentionally omitted (undefined)
    const evaluateRequest = {
      journey_id: journeyId,
      // toc_code intentionally omitted — BL-315 AC-V4 trigger condition
      delay_minutes: 45,
      ticket_fare_pence: 2500
    };

    // axios.post mock present in case current code reaches it (allows us to inspect calls)
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        journey_id: journeyId,
        eligible: false,
        scheme: 'DR30',
        delay_minutes: 45,
        compensation_percentage: 0,
        compensation_pence: 0,
        ticket_fare_pence: 2500,
        reasons: [],
        applied_rules: [],
        evaluation_timestamp: '2026-02-15T10:00:00.000Z'
      }
    });

    // Act — swallow any thrown error (fast-fail is the expected new behavior)
    try {
      await client.evaluate(evaluateRequest, correlationId);
    } catch (_e) {
      // fast-fail expected — swallow
    }

    // Assert (a): axios.post must NOT have been called with toc_code === 'UNKNOWN'
    // FAILS TODAY: post IS called with { toc_code: 'UNKNOWN', ... }
    if (vi.mocked(axios.post).mock.calls.length > 0) {
      for (const call of vi.mocked(axios.post).mock.calls) {
        const body = call[1] as Record<string, unknown>;
        expect(body.toc_code).not.toBe('UNKNOWN');
      }
    }

    // Assert (b): logger.warn MUST have been called with journey_id context
    // FAILS TODAY: no warn logged — code silently substitutes 'UNKNOWN'
    expect(sharedLogger.warn).toHaveBeenCalled();
    const warnCalls = sharedLogger.warn.mock.calls;
    const anyCallHasJourneyId = warnCalls.some(([, meta]: [string, Record<string, unknown>]) =>
      meta && typeof meta === 'object' && meta.journey_id === journeyId
    );
    expect(anyCallHasJourneyId).toBe(true);
  });

  /**
   * AC-8: Handle eligibility-engine timeout (ETIMEDOUT)
   */
  it('should throw TIMEOUT error when eligibility-engine request times out', async () => {
    // Arrange
    const evaluateRequest = {
      journey_id: journeyId,
      toc_code: 'GW',
      delay_minutes: 45,
      ticket_fare_pence: 2500
    };

    const timeoutError = {
      code: 'ETIMEDOUT',
      message: 'timeout of 30000ms exceeded'
    };
    vi.mocked(axios.post).mockRejectedValue(timeoutError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Act & Assert - AC-8: Timeout handling
    await expect(
      client.evaluate(evaluateRequest, correlationId)
    ).rejects.toThrow('TIMEOUT');
  });

  /**
   * AC-8: Handle eligibility-engine 5xx error
   */
  it('should throw HTTP_ERROR_500 when eligibility-engine returns 500', async () => {
    // Arrange
    const evaluateRequest = {
      journey_id: journeyId,
      toc_code: 'GW',
      delay_minutes: 45,
      ticket_fare_pence: 2500
    };

    const httpError = {
      response: {
        status: 500,
        data: { error: 'INTERNAL_SERVER_ERROR', details: 'Database connection failed' }
      }
    };
    vi.mocked(axios.post).mockRejectedValue(httpError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Act & Assert - AC-8: HTTP 500 error handling
    await expect(
      client.evaluate(evaluateRequest, correlationId)
    ).rejects.toThrow('HTTP_ERROR_500');

    // Verify error object includes status and data
    try {
      await client.evaluate(evaluateRequest, correlationId);
    } catch (error: any) {
      expect(error.status).toBe(500);
      expect(error.data).toEqual({ error: 'INTERNAL_SERVER_ERROR', details: 'Database connection failed' });
    }
  });

  /**
   * AC-8: Handle eligibility-engine connection refused
   */
  it('should re-throw error when eligibility-engine is unavailable (ECONNREFUSED)', async () => {
    // Arrange
    const evaluateRequest = {
      journey_id: journeyId,
      toc_code: 'GW',
      delay_minutes: 45,
      ticket_fare_pence: 2500
    };

    const networkError = {
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:3002'
    };
    vi.mocked(axios.post).mockRejectedValue(networkError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Act & Assert - AC-8: Connection refused handling
    await expect(
      client.evaluate(evaluateRequest, correlationId)
    ).rejects.toMatchObject({
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:3002'
    });
  });

  /**
   * AC-8: Handle eligibility-engine 400 validation error (invalid TOC code)
   */
  it('should throw HTTP_ERROR_400 when eligibility-engine returns validation error', async () => {
    // Arrange
    const evaluateRequest = {
      journey_id: journeyId,
      toc_code: 'INVALID_TOC_THAT_IS_TOO_LONG', // Exceeds 5 char max
      delay_minutes: 45,
      ticket_fare_pence: 2500
    };

    const httpError = {
      response: {
        status: 400,
        data: { error: 'Validation failed', details: 'toc_code must be at most 5 characters' }
      }
    };
    vi.mocked(axios.post).mockRejectedValue(httpError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Act & Assert - AC-8: Validation error from eligibility-engine
    await expect(
      client.evaluate(evaluateRequest, correlationId)
    ).rejects.toThrow('HTTP_ERROR_400');
  });

  /**
   * Edge Case: eligibility-engine returns eligible: false (below threshold)
   */
  it('should return eligible: false when delay does not meet compensation threshold', async () => {
    // Arrange
    const evaluateRequest = {
      journey_id: journeyId,
      toc_code: 'GW',
      delay_minutes: 10, // Below 15-minute threshold
      ticket_fare_pence: 2500
    };

    const mockResponse = {
      data: {
        journey_id: journeyId,
        eligible: false,
        scheme: 'DR30',
        delay_minutes: 10,
        compensation_percentage: 0,
        compensation_pence: 0,
        ticket_fare_pence: 2500,
        reasons: ['Delay of 10 minutes does not meet minimum 15-minute threshold for DR30'],
        applied_rules: [],
        evaluation_timestamp: '2026-02-15T10:00:00.000Z'
      }
    };
    vi.mocked(axios.post).mockResolvedValue(mockResponse);

    // Act
    const result = await client.evaluate(evaluateRequest, correlationId);

    // Assert
    expect(result.eligible).toBe(false);
    expect(result.compensation_pence).toBe(0);
    expect(result.reasons).toContain('Delay of 10 minutes does not meet minimum 15-minute threshold for DR30');
  });

  /**
   * Edge Case: Verify 30-second timeout is used
   */
  it('should use 30-second timeout for eligibility-engine requests', async () => {
    // Arrange
    const evaluateRequest = {
      journey_id: journeyId,
      toc_code: 'GW',
      delay_minutes: 45,
      ticket_fare_pence: 2500
    };

    const mockResponse = {
      data: {
        journey_id: journeyId,
        eligible: true,
        scheme: 'DR30',
        delay_minutes: 45,
        compensation_percentage: 50,
        compensation_pence: 1250,
        ticket_fare_pence: 2500,
        reasons: ['Eligible'],
        applied_rules: ['DR30_30MIN_50PCT'],
        evaluation_timestamp: '2026-02-15T10:00:00.000Z'
      }
    };
    vi.mocked(axios.post).mockResolvedValue(mockResponse);

    // Act
    await client.evaluate(evaluateRequest, correlationId);

    // Assert - Verify 30s timeout
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        timeout: 30000
      })
    );
  });
});
