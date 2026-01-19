/**
 * Unit tests for EligibilityClient class
 *
 * Phase: 3.1 Test Specification (Jessie) - BRANCH COVERAGE REMEDIATION
 * Author: Jessie (QA Engineer)
 * Date: 2026-01-19
 *
 * PURPOSE:
 * The EligibilityClient class has uncovered error handling branches per Blake's analysis:
 * - Timeout handling (ETIMEDOUT, ECONNABORTED)
 * - HTTP error handling (4xx, 5xx)
 * - Network error handling (ECONNREFUSED without response object)
 *
 * These tests exercise the REAL class (not mocked httpClient parameter).
 * We mock axios itself to simulate various failure scenarios.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios from 'axios';
import { EligibilityClient } from '../../src/services/eligibility-client.js';

// Mock axios module
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: vi.fn()
  }
}));

describe('EligibilityClient - Error Handling Branches', () => {
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
   * Happy Path - Successful Eligibility Check
   */
  it('should return eligibility result when API call succeeds', async () => {
    // Arrange
    const mockResponse = {
      data: {
        eligible: true,
        compensation_amount_gbp: 25.50,
        reason: 'Delay exceeds 15 minutes'
      }
    };
    vi.mocked(axios.get).mockResolvedValue(mockResponse);

    // Act
    const result = await client.checkEligibility(journeyId, correlationId);

    // Assert
    expect(result).toEqual(mockResponse.data);
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining(`/eligibility/${journeyId}`),
      expect.objectContaining({
        timeout: 30000,
        headers: {
          'X-Correlation-ID': correlationId
        }
      })
    );
  });

  /**
   * BRANCH: ETIMEDOUT - Request timeout
   * Covers: eligibility-client.ts line 50
   */
  it('should throw TIMEOUT error when request times out (ETIMEDOUT)', async () => {
    // Arrange
    const timeoutError = {
      code: 'ETIMEDOUT',
      message: 'timeout of 30000ms exceeded'
    };
    vi.mocked(axios.get).mockRejectedValue(timeoutError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Act & Assert
    await expect(
      client.checkEligibility(journeyId, correlationId)
    ).rejects.toThrow('TIMEOUT');
  });

  /**
   * BRANCH: ECONNABORTED - Connection aborted (another timeout variant)
   * Covers: eligibility-client.ts line 50
   */
  it('should throw TIMEOUT error when connection aborted (ECONNABORTED)', async () => {
    // Arrange
    const abortError = {
      code: 'ECONNABORTED',
      message: 'timeout of 30000ms exceeded'
    };
    vi.mocked(axios.get).mockRejectedValue(abortError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Act & Assert
    await expect(
      client.checkEligibility(journeyId, correlationId)
    ).rejects.toThrow('TIMEOUT');
  });

  /**
   * BRANCH: HTTP 4xx Error
   * Covers: eligibility-client.ts line 58-68
   */
  it('should throw HTTP_ERROR_400 when API returns 400 Bad Request', async () => {
    // Arrange
    const httpError = {
      response: {
        status: 400,
        data: { error: 'Invalid journey_id format' }
      }
    };
    vi.mocked(axios.get).mockRejectedValue(httpError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Act & Assert
    await expect(
      client.checkEligibility(journeyId, correlationId)
    ).rejects.toThrow('HTTP_ERROR_400');

    // Verify error object includes status and data
    try {
      await client.checkEligibility(journeyId, correlationId);
    } catch (error: any) {
      expect(error.status).toBe(400);
      expect(error.data).toEqual({ error: 'Invalid journey_id format' });
    }
  });

  /**
   * BRANCH: HTTP 5xx Error
   * Covers: eligibility-client.ts line 58-68
   */
  it('should throw HTTP_ERROR_500 when API returns 500 Internal Server Error', async () => {
    // Arrange
    const httpError = {
      response: {
        status: 500,
        data: { error: 'INTERNAL_SERVER_ERROR', details: 'Database connection failed' }
      }
    };
    vi.mocked(axios.get).mockRejectedValue(httpError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Act & Assert
    await expect(
      client.checkEligibility(journeyId, correlationId)
    ).rejects.toThrow('HTTP_ERROR_500');

    // Verify error object includes status and data
    try {
      await client.checkEligibility(journeyId, correlationId);
    } catch (error: any) {
      expect(error.status).toBe(500);
      expect(error.data).toEqual({ error: 'INTERNAL_SERVER_ERROR', details: 'Database connection failed' });
    }
  });

  /**
   * BRANCH: HTTP 404 Error
   * Covers: eligibility-client.ts line 58-68
   */
  it('should throw HTTP_ERROR_404 when API returns 404 Not Found', async () => {
    // Arrange
    const httpError = {
      response: {
        status: 404,
        data: { error: 'Journey not found' }
      }
    };
    vi.mocked(axios.get).mockRejectedValue(httpError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Act & Assert
    await expect(
      client.checkEligibility(journeyId, correlationId)
    ).rejects.toThrow('HTTP_ERROR_404');
  });

  /**
   * BRANCH: Network error without response object (ECONNREFUSED, DNS errors)
   * Covers: eligibility-client.ts line 70-78 (else path when no response object)
   */
  it('should re-throw error when network fails without HTTP response (ECONNREFUSED)', async () => {
    // Arrange
    const networkError = {
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:3002'
    };
    vi.mocked(axios.get).mockRejectedValue(networkError);
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    // Act & Assert
    await expect(
      client.checkEligibility(journeyId, correlationId)
    ).rejects.toMatchObject({
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:3002'
    });
  });

  /**
   * BRANCH: Non-Axios error (generic JavaScript error)
   * Covers: eligibility-client.ts line 70-78 (outer catch when not axios error)
   */
  it('should re-throw error when generic JavaScript error occurs', async () => {
    // Arrange
    const genericError = new Error('Unexpected error: out of memory');
    vi.mocked(axios.get).mockRejectedValue(genericError);
    vi.mocked(axios.isAxiosError).mockReturnValue(false); // Not an axios error

    // Act & Assert
    await expect(
      client.checkEligibility(journeyId, correlationId)
    ).rejects.toThrow('Unexpected error: out of memory');
  });

  /**
   * Edge Case: Empty response data
   */
  it('should return empty object when API returns 200 with empty body', async () => {
    // Arrange
    const mockResponse = {
      data: {}
    };
    vi.mocked(axios.get).mockResolvedValue(mockResponse);

    // Act
    const result = await client.checkEligibility(journeyId, correlationId);

    // Assert
    expect(result).toEqual({});
  });

  /**
   * Edge Case: Verify correlation ID is passed in header
   */
  it('should include correlation ID in X-Correlation-ID header', async () => {
    // Arrange
    const mockResponse = {
      data: { eligible: false }
    };
    vi.mocked(axios.get).mockResolvedValue(mockResponse);

    // Act
    await client.checkEligibility(journeyId, correlationId);

    // Assert
    expect(axios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'X-Correlation-ID': correlationId
        }
      })
    );
  });

  /**
   * Edge Case: Verify timeout is 30 seconds
   */
  it('should use 30 second timeout for API requests', async () => {
    // Arrange
    const mockResponse = {
      data: { eligible: false }
    };
    vi.mocked(axios.get).mockResolvedValue(mockResponse);

    // Act
    await client.checkEligibility(journeyId, correlationId);

    // Assert
    expect(axios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        timeout: 30000
      })
    );
  });

  /**
   * Edge Case: Verify correct URL construction
   */
  it('should construct correct URL with journey ID', async () => {
    // Arrange
    const mockResponse = {
      data: { eligible: true }
    };
    vi.mocked(axios.get).mockResolvedValue(mockResponse);

    // Act
    await client.checkEligibility(journeyId, correlationId);

    // Assert
    expect(axios.get).toHaveBeenCalledWith(
      `http://localhost:3002/eligibility/${journeyId}`,
      expect.any(Object)
    );
  });
});
