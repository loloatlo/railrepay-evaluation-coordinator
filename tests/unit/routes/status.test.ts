/**
 * Unit tests for status routes
 *
 * Coverage target: routes/status.ts >= 80%
 * Covers: GET /status/:journey_id — found, not found, 500
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createStatusRouter } from '../../../src/routes/status.js';

vi.mock('../../../src/services/workflow-service.js', () => ({
  WorkflowService: vi.fn().mockImplementation(() => ({
    getWorkflowStatus: vi.fn()
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

const VALID_JOURNEY_ID = '550e8400-e29b-41d4-a716-446655440000';

function buildApp() {
  const mockDb = {};
  const app = express();
  app.use(express.json());
  app.use('/status', createStatusRouter(mockDb));
  return app;
}

describe('Status Routes - GET /status/:journey_id', () => {
  let mockGetWorkflowStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkflowStatus = vi.fn();
    (WorkflowService as any).mockImplementation(() => ({
      getWorkflowStatus: mockGetWorkflowStatus
    }));
  });

  // Happy path - workflow found
  it('returns 200 with workflow status when journey exists', async () => {
    const mockStatus = {
      workflow_id: 'wf-789',
      journey_id: VALID_JOURNEY_ID,
      status: 'COMPLETED',
      eligibility_result: { eligible: true },
      steps: [
        { step_type: 'ELIGIBILITY_CHECK', status: 'COMPLETED', started_at: new Date(), completed_at: new Date() }
      ]
    };
    mockGetWorkflowStatus.mockResolvedValue(mockStatus);

    const app = buildApp();
    const res = await request(app).get(`/status/${VALID_JOURNEY_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.workflow_id).toBe('wf-789');
    expect(res.body.status).toBe('COMPLETED');
  });

  // Not found
  it('returns 404 when no workflow found for journey_id', async () => {
    mockGetWorkflowStatus.mockResolvedValue(null);

    const app = buildApp();
    const res = await request(app).get(`/status/${VALID_JOURNEY_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Workflow not found/);
  });

  // Internal server error
  it('returns 500 when service throws unexpected error', async () => {
    mockGetWorkflowStatus.mockRejectedValue(new Error('Database query failed'));

    const app = buildApp();
    const res = await request(app).get(`/status/${VALID_JOURNEY_ID}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  // Verify the journey_id is passed through
  it('calls WorkflowService.getWorkflowStatus with journey_id from URL', async () => {
    mockGetWorkflowStatus.mockResolvedValue({
      workflow_id: 'wf-000',
      journey_id: VALID_JOURNEY_ID,
      status: 'INITIATED',
      eligibility_result: null,
      steps: []
    });

    const app = buildApp();
    await request(app).get(`/status/${VALID_JOURNEY_ID}`);

    expect(mockGetWorkflowStatus).toHaveBeenCalledWith(VALID_JOURNEY_ID);
  });

  // IN_PROGRESS status
  it('returns 200 with IN_PROGRESS status when workflow is running', async () => {
    mockGetWorkflowStatus.mockResolvedValue({
      workflow_id: 'wf-111',
      journey_id: VALID_JOURNEY_ID,
      status: 'IN_PROGRESS',
      eligibility_result: null,
      steps: []
    });

    const app = buildApp();
    const res = await request(app).get(`/status/${VALID_JOURNEY_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
  });
});
