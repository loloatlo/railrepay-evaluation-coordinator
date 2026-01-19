/**
 * Eligibility Engine API Client
 */

import axios, { AxiosError } from 'axios';
import { logger } from '../lib/logger.js';

export interface EligibilityResult {
  eligible: boolean;
  compensation_amount_gbp?: number;
  reason?: string;
}

export class EligibilityClient {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    this.baseUrl = process.env.ELIGIBILITY_ENGINE_URL || 'http://localhost:3002';
    this.timeout = 30000; // 30s timeout
  }

  async checkEligibility(journeyId: string, correlationId: string): Promise<EligibilityResult> {
    const url = `${this.baseUrl}/eligibility/${journeyId}`;
    
    logger.info('Calling eligibility engine API', { 
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
