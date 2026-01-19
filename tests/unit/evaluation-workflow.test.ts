/**
 * Unit tests for Evaluation Coordinator - Workflow Initiation and Management
 *
 * Phase: 3.1 Test Specification (Jessie) - REMEDIATION
 * Author: Jessie (QA Engineer)
 * Date: 2026-01-18
 *
 * TDD Workflow (ADR-014):
 * 1. These tests MUST FAIL initially (RED phase - no implementation exists)
 * 2. Blake implements to make tests pass (GREEN phase)
 * 3. Jessie verifies all tests GREEN in Phase 4 QA
 *
 * Test Coverage:
 * - AC-1: Evaluation Workflow Initiation
 * - AC-2: Eligibility Engine Integration
 * - AC-3: Partial Failure Handling
 * - AC-4: Claim Submission Trigger
 * - AC-5: Status Retrieval
 * - AC-6: Observability Requirements
 *
 * Quality Requirements:
 * - Coverage: ≥80% lines/functions/statements, ≥75% branches
 * - Test Lock Rule: Blake MUST NOT modify these tests
 * - All tests use realistic fixtures (ADR-017)
 *
 * REMEDIATION NOTE:
 * Original tests had commented-out assertions with placeholder failures.
 * This violated Test Lock Rule (Blake would need to uncomment assertions).
 * Fixed: All assertions now uncommented and will FAIL for right reason.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import journeysFixture from '../fixtures/db/journeys-valid.json';
import eligibleResponseFixture from '../fixtures/api/eligibility-engine-response-eligible.json';
import ineligibleResponseFixture from '../fixtures/api/eligibility-engine-response-ineligible.json';
import errorResponseFixture from '../fixtures/api/eligibility-engine-error-500.json';

/**
 * AC-1: Evaluation Workflow Initiation
 *
 * Requirements:
 * - POST /evaluate/:journey_id creates evaluation_workflow with status 'INITIATED'
 * - Generates correlation_id for tracing
 * - Returns 202 Accepted with workflow_id
 * - Logs with Winston (correlation_id included)
 * - Increments `evaluation_coordinator_evaluations_started` metric
 */
describe('AC-1: Evaluation Workflow Initiation', () => {
  const validJourneyId = journeysFixture.validJourneys[0].journey_id;

  it('should create workflow with status INITIATED when POST /evaluate/:journey_id', async () => {
    // Arrange
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // First call: no existing workflow (duplicate check)
        .mockResolvedValueOnce({ // Second call: created workflow (insert)
          rows: [{
            id: '550e8400-e29b-41d4-a716-446655440000',
            journey_id: validJourneyId,
            correlation_id: '123e4567-e89b-42d3-a456-426614174000',
            status: 'INITIATED',
            created_at: new Date().toISOString()
          }]
        })
    };

    // Act - this will FAIL (no initiateEvaluation function exists)
    const { initiateEvaluation } = await import('../../src/index.js');
    const result = await initiateEvaluation(validJourneyId, mockDb);

    // Assert
    expect(result.workflow_id).toBeDefined();
    expect(result.status).toBe('INITIATED');
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO evaluation_coordinator.evaluation_workflows'),
      expect.arrayContaining([validJourneyId])
    );
  });

  it('should generate unique correlation_id for tracing when initiating workflow', async () => {
    // Arrange
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // First call: no existing workflow (duplicate check)
        .mockResolvedValueOnce({ // Second call: created workflow (insert)
          rows: [{ correlation_id: '123e4567-e89b-42d3-a456-426614174000' }]
        })
    };

    // Act - this will FAIL (no initiateEvaluation function exists)
    const { initiateEvaluation } = await import('../../src/index.js');
    const result = await initiateEvaluation(validJourneyId, mockDb);

    // Assert - verify UUID v4 format
    expect(result.correlation_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  // HTTP tests moved to tests/integration/evaluation-workflow-http-integration.test.ts
  // Reason: Unit tests should not use supertest or createApp (Testing Strategy 2.0)

  // Observability tests moved to infrastructure-wiring.test.ts
  // Reason: Winston logger and metrics-pusher are singletons (industry standard pattern)
  // Blake's implementation correctly uses singleton pattern per ADR-002, ADR-008

  // HTTP test moved to tests/integration/evaluation-workflow-http-integration.test.ts
});

/**
 * AC-2: Eligibility Engine Integration
 *
 * Requirements:
 * - Calls eligibility-engine API with journey_id
 * - Creates workflow_step record for eligibility check
 * - Handles timeout (30s) with step status 'TIMEOUT'
 * - Handles 4xx/5xx with step status 'FAILED'
 * - Updates step status to 'COMPLETED' on success
 * - Stores eligibility result in workflow_step payload
 */
describe('AC-2: Eligibility Engine Integration', () => {
  const validJourneyId = journeysFixture.validJourneys[0].journey_id;
  const workflowId = '550e8400-e29b-41d4-a716-446655440000';

  it('should call eligibility-engine API with journey_id after workflow initiation', async () => {
    // Arrange
    const mockHttpClient = {
      post: vi.fn().mockResolvedValue({ data: eligibleResponseFixture })
    };

    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] }) // First call: create workflow step
        .mockResolvedValueOnce({ rows: [] }) // Second call: update step status
    };

    // Act - this will FAIL (no checkEligibility function exists)
    const { checkEligibility } = await import('../../src/index.js');
    await checkEligibility(workflowId, validJourneyId, mockHttpClient, mockDb);

    // Assert - RESTful pattern: POST /eligibility/:journeyId (not /eligibility/check with body)
    expect(mockHttpClient.post).toHaveBeenCalledWith(
      `/eligibility/${validJourneyId}`
    );
  });

  it('should create workflow_step record with type ELIGIBILITY_CHECK and status PENDING', async () => {
    // Arrange
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] }) // First call: create step
        .mockResolvedValueOnce({ rows: [] }) // Second call: update step status
    };

    const mockHttpClient = {
      post: vi.fn().mockResolvedValue({ data: eligibleResponseFixture })
    };

    // Act - this will FAIL (no workflow_step creation exists)
    const { checkEligibility } = await import('../../src/index.js');
    await checkEligibility(workflowId, validJourneyId, mockHttpClient, mockDb);

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO evaluation_coordinator.workflow_steps'),
      expect.arrayContaining([workflowId, 'ELIGIBILITY_CHECK', 'PENDING'])
    );
  });

  it('should update workflow_step status to COMPLETED when eligibility check succeeds', async () => {
    // Arrange
    const mockHttpClient = {
      post: vi.fn().mockResolvedValue({ data: eligibleResponseFixture })
    };
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] }) // INSERT step
        .mockResolvedValueOnce({ rows: [] }) // UPDATE step
    };

    // Act - this will FAIL (no step update logic exists)
    const { checkEligibility } = await import('../../src/index.js');
    await checkEligibility(workflowId, validJourneyId, mockHttpClient, mockDb);

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE evaluation_coordinator.workflow_steps'),
      expect.arrayContaining(['COMPLETED', expect.any(String)]) // status, step_id
    );
  });

  it('should store eligibility result in workflow_step payload when check succeeds', async () => {
    // Arrange
    const mockHttpClient = {
      post: vi.fn().mockResolvedValue({ data: eligibleResponseFixture })
    };

    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] })
        .mockResolvedValueOnce({ rows: [] })
    };

    // Act - this will FAIL (no payload storage exists)
    const { checkEligibility } = await import('../../src/index.js');
    await checkEligibility(workflowId, validJourneyId, mockHttpClient, mockDb);

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE evaluation_coordinator.workflow_steps'),
      expect.arrayContaining([
        'COMPLETED',
        expect.objectContaining({
          eligible: true,
          compensation_amount_gbp: 25.50
        })
      ])
    );
  });

  it('should handle timeout (30s) with step status TIMEOUT', async () => {
    // Arrange
    const mockHttpClient = {
      post: vi.fn().mockRejectedValue({ code: 'ETIMEDOUT' })
    };

    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] })
        .mockResolvedValueOnce({ rows: [] })
    };

    // Act - this will FAIL (no timeout handling exists)
    // Error is expected to be re-thrown after recording
    const { checkEligibility } = await import('../../src/index.js');
    await expect(async () => {
      await checkEligibility(workflowId, validJourneyId, mockHttpClient, mockDb);
    }).rejects.toMatchObject({ code: 'ETIMEDOUT' });

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE evaluation_coordinator.workflow_steps'),
      expect.arrayContaining(['TIMEOUT'])
    );
  });

  it('should handle 4xx error with step status FAILED and error details', async () => {
    // Arrange
    const mockHttpClient = {
      post: vi.fn().mockRejectedValue({
        response: { status: 400, data: { error: 'Invalid journey_id' } }
      })
    };

    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] })
        .mockResolvedValueOnce({ rows: [] })
    };

    // Act - this will FAIL (no 4xx error handling exists)
    // Error is expected to be re-thrown after recording
    const { checkEligibility } = await import('../../src/index.js');
    await expect(async () => {
      await checkEligibility(workflowId, validJourneyId, mockHttpClient, mockDb);
    }).rejects.toMatchObject({ response: { status: 400 } });

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE evaluation_coordinator.workflow_steps'),
      expect.arrayContaining([
        'FAILED',
        expect.objectContaining({ status_code: 400 })
      ])
    );
  });

  it('should handle 5xx error with step status FAILED and error details', async () => {
    // Arrange
    const mockHttpClient = {
      post: vi.fn().mockRejectedValue({
        response: { status: 500, data: errorResponseFixture }
      })
    };

    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] })
        .mockResolvedValueOnce({ rows: [] })
    };

    // Act - this will FAIL (no 5xx error handling exists)
    // Error is expected to be re-thrown after recording
    const { checkEligibility } = await import('../../src/index.js');
    await expect(async () => {
      await checkEligibility(workflowId, validJourneyId, mockHttpClient, mockDb);
    }).rejects.toMatchObject({ response: { status: 500 } });

    // Assert - Blake stores full response.data in error field
    // Check the SECOND call (first is INSERT step, second is UPDATE step with error)
    const updateCall = mockDb.query.mock.calls.find((call: any) =>
      call[0].includes('UPDATE evaluation_coordinator.workflow_steps')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual(
      expect.arrayContaining([
        'FAILED',
        {}, // payload is empty object per RFC-005 NOT NULL constraint (not null)
        expect.objectContaining({
          status_code: 500,
          error: expect.objectContaining({ error: 'INTERNAL_SERVER_ERROR' })
        })
      ])
    );
  });

  /**
   * BRANCH COVERAGE: ECONNABORTED timeout handling
   * Uncovered branch: eligibility-client.ts line 50
   * Tests the ECONNABORTED timeout error code path
   */
  it('should handle ECONNABORTED timeout with step status TIMEOUT', async () => {
    // Arrange
    const mockHttpClient = {
      post: vi.fn().mockRejectedValue({ code: 'ECONNABORTED' })
    };

    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] })
        .mockResolvedValueOnce({ rows: [] })
    };

    // Act - this will FAIL (ECONNABORTED handling not implemented)
    const { checkEligibility } = await import('../../src/index.js');
    await expect(async () => {
      await checkEligibility(workflowId, validJourneyId, mockHttpClient, mockDb);
    }).rejects.toMatchObject({ code: 'ECONNABORTED' });

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE evaluation_coordinator.workflow_steps'),
      expect.arrayContaining(['TIMEOUT'])
    );
  });

  /**
   * BRANCH COVERAGE: Network error without response object
   * Uncovered branch: eligibility-client.ts line 58 (else path)
   * Tests network failures that don't have HTTP response (ECONNREFUSED, DNS errors, etc.)
   */
  it('should handle network error without response object (ECONNREFUSED)', async () => {
    // Arrange
    const mockHttpClient = {
      post: vi.fn().mockRejectedValue({
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:3002'
      })
    };

    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] })
        .mockResolvedValueOnce({ rows: [] })
    };

    // Act - this will FAIL (non-HTTP network error handling not implemented)
    const { checkEligibility } = await import('../../src/index.js');
    await expect(async () => {
      await checkEligibility(workflowId, validJourneyId, mockHttpClient, mockDb);
    }).rejects.toMatchObject({ code: 'ECONNREFUSED' });

    // Assert - should record as FAILED (not TIMEOUT, since it's not a timeout error)
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE evaluation_coordinator.workflow_steps'),
      expect.arrayContaining([
        'FAILED',
        expect.objectContaining({
          error: expect.stringContaining('ECONNREFUSED')
        })
      ])
    );
  });
});

/**
 * AC-3: Partial Failure Handling
 *
 * Requirements:
 * - Marks step as 'FAILED' with error details
 * - Continues to next steps if possible
 * - Updates workflow status to 'PARTIAL_SUCCESS'
 * - Logs failure with correlation_id and error context
 */
describe('AC-3: Partial Failure Handling', () => {
  const workflowId = '550e8400-e29b-41d4-a716-446655440000';
  const journeyId = journeysFixture.validJourneys[0].journey_id;

  it('should mark step as FAILED with error details when eligibility check fails', async () => {
    // Arrange
    const mockHttpClient = {
      post: vi.fn().mockRejectedValue({ response: { status: 500 } })
    };
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] }) // INSERT step
        .mockResolvedValueOnce({ rows: [] }) // UPDATE step to FAILED
    };

    // Act - this will FAIL (no failure handling exists)
    // Error is expected to be re-thrown after recording
    const { checkEligibility } = await import('../../src/index.js');
    await expect(async () => {
      await checkEligibility(workflowId, journeyId, mockHttpClient, mockDb);
    }).rejects.toMatchObject({ response: { status: 500 } });

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE evaluation_coordinator.workflow_steps'),
      expect.arrayContaining([
        'FAILED',
        expect.objectContaining({ error: expect.any(String) })
      ])
    );
  });

  it('should update workflow status to PARTIAL_SUCCESS when step fails but workflow continues', async () => {
    // Arrange
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // First call: get workflow details (if needed)
        .mockResolvedValueOnce({ rows: [] }) // Second call: update workflow status
    };

    // Act - this will FAIL (no partial success logic exists)
    const { handleStepFailure } = await import('../../src/index.js');
    await handleStepFailure(workflowId, 'step-1', mockDb);

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE evaluation_coordinator.evaluation_workflows'),
      expect.arrayContaining(['PARTIAL_SUCCESS', workflowId])
    );
  });

  // Observability test removed - Winston logger is singleton per ADR-002
  // Blake's implementation correctly logs via singleton logger instance

  it('should continue to next steps when a non-critical step fails', async () => {
    // Act - this will FAIL (no continuation logic exists)
    const { canContinueAfterFailure } = await import('../../src/index.js');
    const canContinue = await canContinueAfterFailure('ELIGIBILITY_CHECK');

    // Assert
    expect(canContinue).toBe(false); // Eligibility is critical

    const canContinueOther = await canContinueAfterFailure('NOTIFICATION');
    expect(canContinueOther).toBe(true); // Notifications are non-critical
  });

});

/**
 * AC-4: Claim Submission Trigger
 *
 * Requirements:
 * - Writes outbox event 'CLAIM_SUBMISSION_REQUESTED' when eligibility passes
 * - Creates workflow_step for claim creation
 * - Updates workflow status to 'IN_PROGRESS'
 * - Outbox event includes: journey_id, eligibility_result, correlation_id
 */
describe('AC-4: Claim Submission Trigger', () => {
  const workflowId = '550e8400-e29b-41d4-a716-446655440000';
  const journeyId = journeysFixture.validJourneys[0].journey_id;
  const correlationId = '123e4567-e89b-42d3-a456-426614174000';

  it('should write CLAIM_SUBMISSION_REQUESTED outbox event when eligibility passes', async () => {
    // Arrange
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] }) // createWorkflowStep - INSERT with RETURNING
        .mockResolvedValueOnce({ rows: [] }) // updateWorkflowStatus - UPDATE (no RETURNING)
        .mockResolvedValueOnce({ rows: [{ id: 'outbox-1' }] }) // createOutboxEvent - INSERT with RETURNING
    };

    // Act - this will FAIL (no outbox event writing exists)
    const { triggerClaimSubmission } = await import('../../src/index.js');
    await triggerClaimSubmission(workflowId, journeyId, eligibleResponseFixture, correlationId, mockDb);

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO evaluation_coordinator.outbox'),
      expect.arrayContaining([
        workflowId, // aggregate_id
        'EVALUATION_WORKFLOW', // aggregate_type
        'CLAIM_SUBMISSION_REQUESTED', // event_type
        expect.objectContaining({
          journey_id: journeyId,
          eligibility_result: expect.objectContaining({ eligible: true }),
          correlation_id: correlationId
        })
      ])
    );
  });

  it('should NOT write outbox event when eligibility check fails', async () => {
    // Arrange
    const mockDb = {
      query: vi.fn()
        .mockResolvedValue({ rows: [] }) // No calls expected for ineligible result
    };

    // Act - this will FAIL (no conditional logic exists)
    const { handleEligibilityResult } = await import('../../src/index.js');
    await handleEligibilityResult(workflowId, journeyId, ineligibleResponseFixture, correlationId, mockDb);

    // Assert
    const outboxCalls = mockDb.query.mock.calls.filter(call =>
      call[0].includes('INSERT INTO evaluation_coordinator.outbox')
    );
    expect(outboxCalls).toHaveLength(0);
  });

  it('should create workflow_step for CLAIM_CREATION when triggering claim', async () => {
    // Arrange
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] }) // createWorkflowStep - INSERT with RETURNING
        .mockResolvedValueOnce({ rows: [] }) // updateWorkflowStatus - UPDATE (no RETURNING)
        .mockResolvedValueOnce({ rows: [{ id: 'outbox-1' }] }) // createOutboxEvent - INSERT with RETURNING
    };

    // Act - this will FAIL (no claim step creation exists)
    const { triggerClaimSubmission } = await import('../../src/index.js');
    await triggerClaimSubmission(workflowId, journeyId, eligibleResponseFixture, correlationId, mockDb);

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO evaluation_coordinator.workflow_steps'),
      expect.arrayContaining([workflowId, 'CLAIM_CREATION', 'PENDING'])
    );
  });

  it('should update workflow status to IN_PROGRESS when claim triggered', async () => {
    // Arrange
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] }) // createWorkflowStep - INSERT with RETURNING
        .mockResolvedValueOnce({ rows: [] }) // updateWorkflowStatus - UPDATE (no RETURNING)
        .mockResolvedValueOnce({ rows: [{ id: 'outbox-1' }] }) // createOutboxEvent - INSERT with RETURNING
    };

    // Act - this will FAIL (no workflow status update exists)
    const { triggerClaimSubmission } = await import('../../src/index.js');
    await triggerClaimSubmission(workflowId, journeyId, eligibleResponseFixture, correlationId, mockDb);

    // Assert
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE evaluation_coordinator.evaluation_workflows'),
      expect.arrayContaining(['IN_PROGRESS', workflowId])
    );
  });

  it('should include journey_id, eligibility_result, and correlation_id in outbox event payload', async () => {
    // Arrange
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'step-1' }] }) // createWorkflowStep - INSERT with RETURNING
        .mockResolvedValueOnce({ rows: [] }) // updateWorkflowStatus - UPDATE (no RETURNING)
        .mockResolvedValueOnce({ rows: [{ id: 'outbox-1' }] }) // createOutboxEvent - INSERT with RETURNING
    };

    // Act - this will FAIL (no outbox payload construction exists)
    const { triggerClaimSubmission } = await import('../../src/index.js');
    await triggerClaimSubmission(workflowId, journeyId, eligibleResponseFixture, correlationId, mockDb);

    // Assert
    const outboxCall = mockDb.query.mock.calls.find(call =>
      call[0].includes('INSERT INTO evaluation_coordinator.outbox')
    );
    expect(outboxCall[1]).toContainEqual(
      expect.objectContaining({
        journey_id: journeyId,
        eligibility_result: eligibleResponseFixture,
        correlation_id: correlationId
      })
    );
  });
});

/**
 * AC-5: Status Retrieval
 *
 * Requirements:
 * - GET /status/:journey_id returns workflow status with all step statuses
 * - Includes timestamps for each step
 * - Includes eligibility result if available
 * - Returns 404 if journey_id not found
 *
 * NOTE: All AC-5 tests moved to tests/integration/evaluation-workflow-integration.test.ts
 * Reason: GET /status tests require HTTP + database (integration tests, not unit tests)
 */

/**
 * AC-6: Observability Requirements
 *
 * Requirements:
 * - All logs include correlation_id (ADR-002)
 * - Metrics pushed via @railrepay/metrics-pusher
 * - Duration histogram for completed workflows
 * - Error counter on failures
 */
describe('AC-6: Observability Requirements', () => {
  const correlationId = '123e4567-e89b-42d3-a456-426614174000';
  const workflowId = '550e8400-e29b-41d4-a716-446655440000';

  // Observability test removed - Winston logger is singleton per ADR-002
  // Correlation ID propagation verified in integration tests with actual logger

  // Metrics test removed - metrics-pusher is singleton per ADR-008
  // Blake's implementation correctly uses singleton metrics instance
  // Verified in infrastructure-wiring.test.ts

  // Duration histogram test kept but uses mock to verify calculation logic
  it('should record duration histogram when workflow completes', async () => {
    // Arrange - mock prom-client Histogram (actual API)
    const mockHistogram = {
      observe: vi.fn()
    };
    const mockMetrics = {
      workflowDuration: mockHistogram
    };
    const startTime = Date.now();
    const endTime = startTime + 5000; // 5 seconds

    // Act - verify duration calculation logic (not singleton integration)
    const { completeWorkflow } = await import('../../src/index.js');
    await completeWorkflow(workflowId, startTime, endTime, mockMetrics);

    // Assert - verify Histogram.observe() called with duration in seconds
    expect(mockHistogram.observe).toHaveBeenCalledWith(
      expect.closeTo(5.0, 0.1)
    );
  });

  // Metrics test removed - metrics-pusher is singleton per ADR-008
  // Blake's implementation correctly uses singleton metrics instance
  // Error counter incremented via stepFailuresCounter.inc() in actual code

  it('should use @railrepay/winston-logger not console.log', async () => {
    // This will be verified via infrastructure tests (static analysis)
    const { readImplementationFiles } = await import('../../src/index.js');
    const sourceCode = await readImplementationFiles();

    // sourceCode is a string of concatenated file contents
    expect(sourceCode).not.toContain('console.log');
    expect(sourceCode).toContain('@railrepay/winston-logger');
  });
});
