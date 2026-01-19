/**
 * Winston logger setup for evaluation-coordinator service
 * Uses @railrepay/winston-logger (ADR-002)
 */

import { createLogger } from '@railrepay/winston-logger';

export const logger = createLogger({
  serviceName: 'evaluation-coordinator',
  level: process.env.LOG_LEVEL || 'info'
});
