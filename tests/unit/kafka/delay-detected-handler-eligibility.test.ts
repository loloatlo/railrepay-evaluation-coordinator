/**
 * Unit tests for DelayDetectedHandler - Eligibility Evaluation Wiring (BL-146)
 *
 * Phase: TD-1 Test Specification (Jessie)
 * Author: Jessie (QA Engineer)
 * Date: 2026-02-15
 *
 * PURPOSE:
 * Tests for the ENHANCED DelayDetectedHandler that triggers eligibility evaluation
 * after creating an INITIATED workflow. This is the core wiring fix for BL-146.
 *
 * ACCEPTANCE CRITERIA COVERAGE:
 * - AC-3: On delay.detected → trigger eligibility evaluation (connect handler to workflow service)
 * - AC-4: Store eligibility result in workflow (update status to COMPLETED with result, or FAILED)
 * - AC-6: Write outbox event with evaluation result (ADR-007 transactional outbox)
 * - AC-8: Handle eligibility-engine unavailability gracefully (workflow set to FAILED)
 *
 * BL-151 (TD-WHATSAPP-061) ADDITIONS:
 * - AC-1: evaluation.completed outbox event payload includes delay_minutes (number)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DelayDetectedHandler } from '../../../src/kafka/delay-detected-handler.js';
import type { WorkflowRepository } from '../../../src/repositories/workflow-repository.js';
import type { EligibilityClient } from '../../../src/services/eligibility-client.js';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn()
};

describe('BL-146: DelayDetectedHandler - Eligibility Evaluation Wiring', () => {
  let handler: DelayDetectedHandler;
  let mockWorkflowRepository: jest.Mocked<WorkflowRepository>;
  let mockEligibilityClient: jest.Mocked<EligibilityClient>;

  const journeyId = '550e8400-e29b-41d4-a716-446655440000';
  const userId = '660e8400-e29b-41d4-a716-446655440001';
  const correlationId = '123e4567-e89b-42d3-a456-426614174000';
  const workflowId = '770e8400-e29b-41d4-a716-446655440002';

  beforeEach(() => {
    // Create mock workflow repository
    mockWorkflowRepository = {
      getWorkflowByJourneyId: vi.fn(),
      createWorkflow: vi.fn(),
      updateWorkflowStatus: vi.fn(),
      updateWorkflowEligibilityResult: vi.fn(),
      createWorkflowStep: vi.fn().mockResolvedValue({
        id: 'mock-step-id',
        workflow_id: workflowId,
        step_type: 'ELIGIBILITY_CHECK',
        status: 'PENDING',
        started_at: new Date()
      }),
      updateWorkflowStep: vi.fn(),
      createOutboxEvent: vi.fn(),
      getWorkflowSteps: vi.fn()
    } as any;

    // Create mock eligibility client
    mockEligibilityClient = {
      evaluate: vi.fn()
    } as any;

    // Create handler with mocked dependencies
    handler = new DelayDetectedHandler({
      workflowRepository: mockWorkflowRepository,
      eligibilityClient: mockEligibilityClient,
      logger: mockLogger
    });

    vi.clearAllMocks();
  });

  /**
   * AC-3: Handler calls eligibility evaluation after creating workflow
   * AC-4: Eligibility result stored in workflow, status updated to COMPLETED
   * AC-6: Outbox event written with evaluation result
   */
  it('should trigger eligibility evaluation and store result when delay.detected received', async () => {
    // Arrange
    const payload = {
      journey_id: journeyId,
      user_id: userId,
      delay_minutes: 45,
      is_cancellation: false,
      toc_code: 'GW',
      correlation_id: correlationId
    };

    // Mock workflow creation
    mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue(null); // No existing workflow
    mockWorkflowRepository.createWorkflow.mockResolvedValue({
      id: workflowId,
      journey_id: journeyId,
      correlation_id: correlationId,
      status: 'INITIATED',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Mock eligibility evaluation response
    const eligibilityResult = {
      journey_id: journeyId,
      eligible: true,
      scheme: 'DR30',
      delay_minutes: 45,
      compensation_percentage: 50,
      compensation_pence: 0, // 0 because ticket_fare_pence is 0
      ticket_fare_pence: 0,
      reasons: ['Delay of 45 minutes qualifies for 50% refund under DR30 scheme'],
      applied_rules: ['DR30_30MIN_50PCT'],
      evaluation_timestamp: '2026-02-15T10:00:00.000Z'
    };
    mockEligibilityClient.evaluate.mockResolvedValue(eligibilityResult);

    // Act
    await handler.handle(payload);

    // Assert - AC-3: EligibilityClient.evaluate() was called with correct payload
    expect(mockEligibilityClient.evaluate).toHaveBeenCalledWith(
      {
        journey_id: journeyId,
        toc_code: 'GW',
        delay_minutes: 45,
        ticket_fare_pence: 0 // AC-12: Default to 0
      },
      correlationId
    );

    // Assert - AC-4: Eligibility result stored in workflow
    expect(mockWorkflowRepository.updateWorkflowEligibilityResult).toHaveBeenCalledWith(
      workflowId,
      eligibilityResult,
      correlationId
    );

    // Assert - AC-4: Workflow status updated to COMPLETED
    expect(mockWorkflowRepository.updateWorkflowStatus).toHaveBeenCalledWith(
      workflowId,
      'COMPLETED',
      correlationId
    );

    // Assert - AC-6: Outbox event written with evaluation result
    // BL-151 AC-1: outbox payload MUST include delay_minutes
    expect(mockWorkflowRepository.createOutboxEvent).toHaveBeenCalledWith(
      workflowId,
      'EVALUATION_WORKFLOW',
      'evaluation.completed',
      expect.objectContaining({
        journey_id: journeyId,
        user_id: userId,
        eligible: true,
        scheme: 'DR30',
        compensation_pence: 0,
        delay_minutes: 45,
        correlation_id: correlationId
      }),
      correlationId
    );
  });

  /**
   * AC-9: Handle missing toc_code — workflow set to FAILED
   */
  it('should set workflow to FAILED when toc_code is missing from payload', async () => {
    // Arrange
    const payload = {
      journey_id: journeyId,
      user_id: userId,
      delay_minutes: 45,
      is_cancellation: false,
      // toc_code intentionally missing (old event format)
      correlation_id: correlationId
    };

    // Mock workflow creation
    mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue(null);
    mockWorkflowRepository.createWorkflow.mockResolvedValue({
      id: workflowId,
      journey_id: journeyId,
      correlation_id: correlationId,
      status: 'INITIATED',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Act
    await handler.handle(payload);

    // Assert - AC-9: EligibilityClient.evaluate() should NOT be called
    expect(mockEligibilityClient.evaluate).not.toHaveBeenCalled();

    // Assert - AC-9: Workflow status set to FAILED with reason
    expect(mockWorkflowRepository.updateWorkflowStatus).toHaveBeenCalledWith(
      workflowId,
      'FAILED',
      correlationId
    );

    // Assert - AC-9: Workflow step created with error details
    expect(mockWorkflowRepository.createWorkflowStep).toHaveBeenCalledWith(
      workflowId,
      'ELIGIBILITY_CHECK',
      correlationId,
      'FAILED'
    );

    expect(mockWorkflowRepository.updateWorkflowStep).toHaveBeenCalledWith(
      expect.any(String), // step_id
      'FAILED',
      correlationId,
      null,
      expect.objectContaining({
        message: 'missing_toc_code',
        reason: 'toc_code is required for eligibility evaluation but was not present in delay.detected payload'
      })
    );
  });

  /**
   * AC-8: Handle eligibility-engine timeout — workflow set to FAILED
   */
  it('should set workflow to FAILED when eligibility-engine times out', async () => {
    // Arrange
    const payload = {
      journey_id: journeyId,
      user_id: userId,
      delay_minutes: 45,
      is_cancellation: false,
      toc_code: 'GW',
      correlation_id: correlationId
    };

    mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue(null);
    mockWorkflowRepository.createWorkflow.mockResolvedValue({
      id: workflowId,
      journey_id: journeyId,
      correlation_id: correlationId,
      status: 'INITIATED',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Mock timeout error
    const timeoutError = new Error('TIMEOUT');
    mockEligibilityClient.evaluate.mockRejectedValue(timeoutError);

    // Act
    await handler.handle(payload);

    // Assert - AC-8: Workflow status set to FAILED
    expect(mockWorkflowRepository.updateWorkflowStatus).toHaveBeenCalledWith(
      workflowId,
      'FAILED',
      correlationId
    );

    // Assert - AC-8: Workflow step created with timeout error
    expect(mockWorkflowRepository.createWorkflowStep).toHaveBeenCalledWith(
      workflowId,
      'ELIGIBILITY_CHECK',
      correlationId,
      'FAILED'
    );

    expect(mockWorkflowRepository.updateWorkflowStep).toHaveBeenCalledWith(
      expect.any(String), // step_id
      'FAILED',
      correlationId,
      null,
      expect.objectContaining({
        message: 'TIMEOUT',
        timeout_ms: 30000
      })
    );
  });

  /**
   * AC-8: Handle eligibility-engine HTTP 500 error — workflow set to FAILED
   */
  it('should set workflow to FAILED when eligibility-engine returns 500', async () => {
    // Arrange
    const payload = {
      journey_id: journeyId,
      user_id: userId,
      delay_minutes: 45,
      is_cancellation: false,
      toc_code: 'GW',
      correlation_id: correlationId
    };

    mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue(null);
    mockWorkflowRepository.createWorkflow.mockResolvedValue({
      id: workflowId,
      journey_id: journeyId,
      correlation_id: correlationId,
      status: 'INITIATED',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Mock HTTP 500 error
    const httpError: any = new Error('HTTP_ERROR_500');
    httpError.status = 500;
    httpError.data = { error: 'INTERNAL_SERVER_ERROR' };
    mockEligibilityClient.evaluate.mockRejectedValue(httpError);

    // Act
    await handler.handle(payload);

    // Assert - AC-8: Workflow status set to FAILED
    expect(mockWorkflowRepository.updateWorkflowStatus).toHaveBeenCalledWith(
      workflowId,
      'FAILED',
      correlationId
    );

    // Assert - AC-8: Workflow step includes HTTP error details
    expect(mockWorkflowRepository.updateWorkflowStep).toHaveBeenCalledWith(
      expect.any(String), // step_id
      'FAILED',
      correlationId,
      null,
      expect.objectContaining({
        message: 'HTTP_ERROR_500',
        http_status: 500,
        response: { error: 'INTERNAL_SERVER_ERROR' }
      })
    );
  });

  /**
   * AC-8: Handle eligibility-engine connection refused — workflow set to FAILED
   */
  it('should set workflow to FAILED when eligibility-engine is unavailable (ECONNREFUSED)', async () => {
    // Arrange
    const payload = {
      journey_id: journeyId,
      user_id: userId,
      delay_minutes: 45,
      is_cancellation: false,
      toc_code: 'GW',
      correlation_id: correlationId
    };

    mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue(null);
    mockWorkflowRepository.createWorkflow.mockResolvedValue({
      id: workflowId,
      journey_id: journeyId,
      correlation_id: correlationId,
      status: 'INITIATED',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Mock connection refused error
    const networkError: any = new Error('connect ECONNREFUSED 127.0.0.1:3002');
    networkError.code = 'ECONNREFUSED';
    mockEligibilityClient.evaluate.mockRejectedValue(networkError);

    // Act
    await handler.handle(payload);

    // Assert - AC-8: Workflow status set to FAILED
    expect(mockWorkflowRepository.updateWorkflowStatus).toHaveBeenCalledWith(
      workflowId,
      'FAILED',
      correlationId
    );

    // Assert - AC-8: Workflow step includes connection error
    expect(mockWorkflowRepository.updateWorkflowStep).toHaveBeenCalledWith(
      expect.any(String), // step_id
      'FAILED',
      correlationId,
      null,
      expect.objectContaining({
        message: 'connect ECONNREFUSED 127.0.0.1:3002'
      })
    );
  });

  /**
   * Idempotency: Handler should skip duplicate events (existing test behavior from BL-145)
   */
  it('should skip duplicate delay.detected events (idempotency preserved)', async () => {
    // Arrange
    const payload = {
      journey_id: journeyId,
      user_id: userId,
      delay_minutes: 45,
      is_cancellation: false,
      toc_code: 'GW',
      correlation_id: correlationId
    };

    // Mock existing workflow
    mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue({
      id: workflowId,
      journey_id: journeyId,
      correlation_id: 'original-correlation-id',
      status: 'COMPLETED',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Act
    await handler.handle(payload);

    // Assert - No new workflow created
    expect(mockWorkflowRepository.createWorkflow).not.toHaveBeenCalled();

    // Assert - No eligibility evaluation triggered
    expect(mockEligibilityClient.evaluate).not.toHaveBeenCalled();

    // Assert - No outbox event written
    expect(mockWorkflowRepository.createOutboxEvent).not.toHaveBeenCalled();
  });

  /**
   * Edge Case: eligible: false still completes workflow successfully
   */
  it('should set workflow to COMPLETED even when eligible: false', async () => {
    // Arrange
    const payload = {
      journey_id: journeyId,
      user_id: userId,
      delay_minutes: 10, // Below threshold
      is_cancellation: false,
      toc_code: 'GW',
      correlation_id: correlationId
    };

    mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue(null);
    mockWorkflowRepository.createWorkflow.mockResolvedValue({
      id: workflowId,
      journey_id: journeyId,
      correlation_id: correlationId,
      status: 'INITIATED',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Mock eligibility evaluation response: eligible = false
    const eligibilityResult = {
      journey_id: journeyId,
      eligible: false,
      scheme: 'DR30',
      delay_minutes: 10,
      compensation_percentage: 0,
      compensation_pence: 0,
      ticket_fare_pence: 0,
      reasons: ['Delay of 10 minutes does not meet minimum threshold'],
      applied_rules: [],
      evaluation_timestamp: '2026-02-15T10:00:00.000Z'
    };
    mockEligibilityClient.evaluate.mockResolvedValue(eligibilityResult);

    // Act
    await handler.handle(payload);

    // Assert - Workflow status still COMPLETED (not FAILED)
    expect(mockWorkflowRepository.updateWorkflowStatus).toHaveBeenCalledWith(
      workflowId,
      'COMPLETED',
      correlationId
    );

    // Assert - Outbox event still written (for downstream tracking)
    // BL-151 AC-1: outbox payload MUST include delay_minutes
    expect(mockWorkflowRepository.createOutboxEvent).toHaveBeenCalledWith(
      workflowId,
      'EVALUATION_WORKFLOW',
      'evaluation.completed',
      expect.objectContaining({
        journey_id: journeyId,
        user_id: userId,
        eligible: false,
        scheme: 'DR30',
        compensation_pence: 0,
        delay_minutes: 10,
        correlation_id: correlationId
      }),
      correlationId
    );
  });
});
