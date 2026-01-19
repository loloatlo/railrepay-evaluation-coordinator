/**
 * Metrics setup for evaluation-coordinator service
 * Uses @railrepay/metrics-pusher with prom-client
 */

import { MetricsPusher, Counter, Histogram } from '@railrepay/metrics-pusher';
import { logger } from './logger.js';

// Initialize metrics pusher
export const metricsPusher = new MetricsPusher({
  serviceName: 'evaluation-coordinator',
  alloyUrl: process.env.ALLOY_URL || 'http://localhost:9091/api/v1/write',
  logger: logger
});

// Create metrics using prom-client (exported by metrics-pusher)
export const evaluationsStartedCounter = new Counter({
  name: 'evaluation_coordinator_evaluations_started',
  help: 'Total number of evaluation workflows started',
  labelNames: ['journey_id']
});

export const workflowDurationHistogram = new Histogram({
  name: 'evaluation_coordinator_workflow_duration_seconds',
  help: 'Duration of evaluation workflows in seconds',
  labelNames: ['status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
});

export const stepFailuresCounter = new Counter({
  name: 'evaluation_coordinator_step_failures_total',
  help: 'Total number of workflow step failures',
  labelNames: ['step_type', 'error_type']
});
