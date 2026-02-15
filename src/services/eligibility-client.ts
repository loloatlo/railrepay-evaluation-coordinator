/**
 * Eligibility Engine API Client
 */

import axios, { AxiosError } from 'axios';
import { logger } from '../lib/logger.js';

export interface EvaluateRequest {
  journey_id: string;
  toc_code?: string;
  delay_minutes: number;
  ticket_fare_pence?: number;
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

    // AC-9: Default toc_code to 'UNKNOWN' if not provided
    const toc_code = request.toc_code ?? 'UNKNOWN';

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
