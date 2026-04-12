/**
 * Unit tests for evaluate routes
 *
 * Coverage target: routes/evaluate.ts >= 80%
 * Covers: POST /evaluate/:journey_id — happy path, invalid UUID, duplicate workflow (422), 500
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEvaluateRouter } from '../../../src/routes/evaluate.js';

// Mock the WorkflowService so we can control its behaviour
vi.mock('../../../src/services/workflow-service.js', () => ({
  WorkflowService: vi.fn().mockImplementation(() => ({
    initiateEvaluation: vi.fn()
  }))
}));

// Mock logger to keep test output clean
vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { WorkflowService } from '../../../src/services/workflow-service.js';

const VALID_JOURNEY_ID = '550e8400-e29b-41d4-a716-446655440000';
const CORRELATION_ID = '123e4567-e89b-42d3-a456-426614174000';

function buildApp() {
  const mockDb = {};
  const app = express();
  app.use(express.json());
  app.use('/evaluate', createEvaluateRouter(mockDb));
  return app;
}

describe('Evaluate Routes - POST /evaluate/:journey_id', () => {
  let mockInitiateEvaluation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInitiateEvaluation = vi.fn();
    (WorkflowService as any).mockImplementation(() => ({
      initiateEvaluation: mockInitiateEvaluation
    }));
  });

  // Happy path
  it('returns 202 with workflow details when journey_id is valid UUID', async () => {
    const mockResult = {
      workflow_id: 'wf-123',
      journey_id: VALID_JOURNEY_ID,
      correlation_id: CORRELATION_ID,
      status: 'INITIATED'
    };
    mockInitiateEvaluation.mockResolvedValue(mockResult);

    const app = buildApp();
    const res = await request(app).post(`/evaluate/${VALID_JOURNEY_ID}`);

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      workflow_id: 'wf-123',
      journey_id: VALID_JOURNEY_ID,
      correlation_id: CORRELATION_ID,
      status: 'INITIATED'
    });
  });

  // Invalid UUID validation
  it('returns 400 when journey_id is not a valid UUID', async () => {
    const app = buildApp();
    const res = await request(app).post('/evaluate/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid journey_id format/);
    expect(mockInitiateEvaluation).not.toHaveBeenCalled();
  });

  it('returns 400 when journey_id is a plain string', async () => {
    const app = buildApp();
    const res = await request(app).post('/evaluate/abc123');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  // Duplicate workflow - 422 from service layer
  it('returns 422 when active workflow already exists for journey', async () => {
    const duplicateError: any = new Error('Active workflow already exists');
    duplicateError.status = 422;
    mockInitiateEvaluation.mockRejectedValue(duplicateError);

    const app = buildApp();
    const res = await request(app).post(`/evaluate/${VALID_JOURNEY_ID}`);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Active workflow already exists');
  });

  // Internal server error
  it('returns 500 when service throws unexpected error', async () => {
    mockInitiateEvaluation.mockRejectedValue(new Error('Database connection failed'));

    const app = buildApp();
    const res = await request(app).post(`/evaluate/${VALID_JOURNEY_ID}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  // Verify workflow service is called with the journey_id
  it('calls WorkflowService.initiateEvaluation with the journey_id from URL', async () => {
    mockInitiateEvaluation.mockResolvedValue({
      workflow_id: 'wf-abc',
      journey_id: VALID_JOURNEY_ID,
      correlation_id: CORRELATION_ID,
      status: 'INITIATED'
    });

    const app = buildApp();
    await request(app).post(`/evaluate/${VALID_JOURNEY_ID}`);

    expect(mockInitiateEvaluation).toHaveBeenCalledWith(VALID_JOURNEY_ID);
  });
});
