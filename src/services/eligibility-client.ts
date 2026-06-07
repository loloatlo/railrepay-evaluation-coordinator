/**
 * Eligibility Engine API Client
 */

import axios, { AxiosError } from 'axios';
import { logger } from '../lib/logger.js';

export interface EvaluateRequest {
  journey_id: string;
  toc_code?: string;
  delay_minutes: number;
  ticket_fare_pence?: number | null;
}

export interface EligibilityResult {
  journey_id: string;
  eligible: boolean;
  scheme: string;
  delay_minutes: number;
  compensation_percentage: number;
  compensation_pence: number;
  ticket_fare_pence: number;
  reasons: string[];
  applied_rules: string[];
  evaluation_timestamp: string;
}

export class EligibilityClient {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    this.baseUrl = process.env.ELIGIBILITY_ENGINE_URL || 'http://localhost:3002';
    this.timeout = 30000; // 30s timeout
  }

  async evaluate(request: EvaluateRequest, correlationId: string): Promise<EligibilityResult> {
    // AC-12: Default ticket_fare_pence to 0 if not provided
    const ticket_fare_pence = request.ticket_fare_pence ?? 0;

    // BL-315 AC-V4: Guard against null/undefined/empty toc_code.
    // Sending 'UNKNOWN' to the eligibility-engine causes a 400 response which
    // propagates as a workflow failure and ~30s BFF timeout. Fail fast instead.
    if (!request.toc_code) {
      logger.warn('EligibilityClient.evaluate() called with missing toc_code — failing fast, NOT sending UNKNOWN downstream', {
        journey_id: request.journey_id,
        toc_code: request.toc_code,
        correlation_id: correlationId,
      });
      throw new Error('MISSING_TOC_CODE');
    }
    const toc_code = request.toc_code;

    const url = `${this.baseUrl}/eligibility/evaluate`;
    const payload = {
      journey_id: request.journey_id,
      toc_code,
      delay_minutes: request.delay_minutes,
      ticket_fare_pence
    };

    logger.info('Calling eligibility engine API', {
      correlation_id: correlationId,
      journey_id: request.journey_id,
      url,
      payload
    });

    try {
      const response = await axios.post(url, payload, {
        timeout: this.timeout,
        headers: {
          'X-Correlation-ID': correlationId
        }
      });

      logger.info('Eligibility evaluation successful', {
        correlation_id: correlationId,
        eligible: response.data.eligible
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        
        if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') {
          logger.error('Eligibility check timeout', { 
            correlation_id: correlationId, 
            error: 'TIMEOUT' 
          });
          throw new Error('TIMEOUT');
        }

        if (axiosError.response) {
          logger.error('Eligibility check failed', { 
            correlation_id: correlationId, 
            status: axiosError.response.status,
            error: axiosError.response.data 
          });
          
          const httpError = new Error(`HTTP_ERROR_${axiosError.response.status}`);
          (httpError as any).status = axiosError.response.status;
          (httpError as any).data = axiosError.response.data;
          throw httpError;
        }
      }

      logger.error('Eligibility check error', { 
        correlation_id: correlationId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      
      throw error;
    }
  }

  /**
   * Legacy method for backward compatibility with WorkflowService
   * @deprecated Use evaluate() instead for new code
   */
  async checkEligibility(journeyId: string, correlationId: string): Promise<any> {
    // Call the old GET endpoint for backward compatibility
    const url = `${this.baseUrl}/eligibility/${journeyId}`;

    logger.info('Calling legacy eligibility engine API', {
      correlation_id: correlationId,
      journey_id: journeyId,
      url
    });

    try {
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'X-Correlation-ID': correlationId
        }
      });

      logger.info('Eligibility check successful', {
        correlation_id: correlationId,
        eligible: response.data.eligible
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') {
          logger.error('Eligibility check timeout', {
            correlation_id: correlationId,
            error: 'TIMEOUT'
          });
          throw new Error('TIMEOUT');
        }

        if (axiosError.response) {
          logger.error('Eligibility check failed', {
            correlation_id: correlationId,
            status: axiosError.response.status,
            error: axiosError.response.data
          });

          const httpError = new Error(`HTTP_ERROR_${axiosError.response.status}`);
          (httpError as any).status = axiosError.response.status;
          (httpError as any).data = axiosError.response.data;
          throw httpError;
        }
      }

      logger.error('Eligibility check error', {
        correlation_id: correlationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }
}
