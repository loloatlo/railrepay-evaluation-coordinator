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
 * - AC-9: Handle missing toc_code — use default 'UNKNOWN' if not in payload
 * - AC-12: ticket_fare_pence defaults to 0 when unavailable
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios from 'axios';
import { EligibilityClient } from '../../../src/services/eligibility-client.js';

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
   * AC-9: Handle missing toc_code — default to 'UNKNOWN'
   */
  it('should default toc_code to UNKNOWN when not provided in request', async () => {
    // Arrange
    const evaluateRequest = {
      journey_id: journeyId,
      // toc_code intentionally omitted
      delay_minutes: 45,
      ticket_fare_pence: 2500
    };

    const mockResponse = {
      data: {
        journey_id: journeyId,
        eligible: false,
        scheme: 'UNKNOWN_TOC',
        delay_minutes: 45,
        compensation_percentage: 0,
        compensation_pence: 0,
        ticket_fare_pence: 2500,
        reasons: ['TOC code UNKNOWN not recognized, eligibility cannot be determined'],
        applied_rules: [],
        evaluation_timestamp: '2026-02-15T10:00:00.000Z'
      }
    };
    vi.mocked(axios.post).mockResolvedValue(mockResponse);

    // Act
    const result = await client.evaluate(evaluateRequest, correlationId);

    // Assert - AC-9: toc_code should be 'UNKNOWN' in request
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:3002/eligibility/evaluate',
      expect.objectContaining({
        journey_id: journeyId,
        toc_code: 'UNKNOWN', // Defaulted to UNKNOWN
        delay_minutes: 45,
        ticket_fare_pence: 2500
      }),
      expect.any(Object)
    );

    expect(result.eligible).toBe(false);
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
