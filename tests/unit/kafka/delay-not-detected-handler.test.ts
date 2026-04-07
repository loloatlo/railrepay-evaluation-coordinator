/**
 * Delay Not Detected Handler Tests
 *
 * Phase: TD-1 Test Specification (Jessie)
 * BL-145 (TD-EVAL-COORDINATOR-001): Add Kafka consumer infrastructure
 * BL-178 (TD-1): evaluation-coordinator must publish evaluation.completed for no-delay events
 * Author: Jessie (QA Engineer)
 * Date: 2026-02-15 | Updated: 2026-04-07
 *
 * TDD Workflow (ADR-014):
 * 1. These tests MUST FAIL initially (RED phase - no implementation exists)
 * 2. Blake implements to make tests pass (GREEN phase)
 * 3. Jessie verifies all tests GREEN in Phase TD-3 QA
 *
 * Tests Map to Acceptance Criteria:
 * - AC-5: On delay.not-detected, create workflow with status=COMPLETED and eligibility_result={eligible: false, reason}
 * - AC-4: Extract correlation_id from event, propagate through all calls and logs
 * - AC-8: Idempotent processing -- duplicate events for same journey_id are ignored
 * - AC-9: Consumer handler uses @railrepay/winston-logger (no console.log)
 *
 * BL-178 Acceptance Criteria (new tests below):
 * - BL-178/AC-1: After workflow completion, write evaluation.completed outbox event with is_eligible: false, reason: 'no_delay_detected'
 * - BL-178/AC-2: Outbox event payload includes journey_id, user_id, is_eligible, reason, correlation_id
 * - BL-178/AC-4: delay.detected → evaluation.completed flow must not be affected (regression)
 * - BL-178/AC-5: Duplicate delay.not-detected events must not produce duplicate outbox events (idempotency)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// AC-5: These imports will fail until Blake creates the files
import { DelayNotDetectedHandler } from '../../../src/kafka/delay-not-detected-handler.js';

// Shared logger mock instance (OUTSIDE factory per guideline #11)
const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

describe('DelayNotDetectedHandler', () => {
  let mockWorkflowRepository: any;
  let mockLogger: any;
  let handler: DelayNotDetectedHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock WorkflowRepository (interface-based mocking)
    mockWorkflowRepository = {
      createWorkflow: vi.fn().mockResolvedValue({
        id: 'workflow-123',
        journey_id: 'journey-456',
        correlation_id: 'corr-789',
        status: 'COMPLETED',
        eligibility_result: { eligible: false, reason: 'below_threshold' },
        created_at: new Date(),
        updated_at: new Date(),
      }),
      updateWorkflowStatus: vi.fn().mockResolvedValue(undefined),
      updateWorkflowEligibilityResult: vi.fn().mockResolvedValue(undefined),
      getWorkflowByJourneyId: vi.fn().mockResolvedValue(null),
      // BL-178: createOutboxEvent must be callable on this handler
      createOutboxEvent: vi.fn().mockResolvedValue({
        id: 'outbox-event-001',
        aggregate_id: 'workflow-123',
        aggregate_type: 'EVALUATION_WORKFLOW',
        event_type: 'evaluation.completed',
        payload: {},
        correlation_id: 'corr-abc',
        published: false,
        created_at: new Date(),
      }),
    };

    mockLogger = sharedLogger;

    handler = new DelayNotDetectedHandler({
      workflowRepository: mockWorkflowRepository,
      logger: mockLogger,
    });
  });

  describe('AC-5: On delay.not-detected, create workflow with status=COMPLETED and eligibility_result', () => {
    // AC-5: Create workflow with COMPLETED status
    it('should create workflow with status=COMPLETED when delay not detected', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.createWorkflow).toHaveBeenCalledWith(
        'journey-456',
        'corr-abc'
      );
      expect(mockWorkflowRepository.updateWorkflowStatus).toHaveBeenCalledWith(
        'workflow-123',
        'COMPLETED',
        'corr-abc'
      );
    });

    // AC-5: Set eligibility_result with eligible=false and reason
    it('should set eligibility_result with eligible=false and reason from payload', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.updateWorkflowEligibilityResult).toHaveBeenCalledWith(
        'workflow-123',
        { eligible: false, reason: 'below_threshold' },
        'corr-abc'
      );
    });

    // AC-5: Handle reason=below_threshold
    it('should handle reason=below_threshold', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.updateWorkflowEligibilityResult).toHaveBeenCalledWith(
        'workflow-123',
        { eligible: false, reason: 'below_threshold' },
        'corr-abc'
      );
    });

    // AC-5: Handle reason=darwin_unavailable
    it('should handle reason=darwin_unavailable', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'darwin_unavailable',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.updateWorkflowEligibilityResult).toHaveBeenCalledWith(
        'workflow-123',
        { eligible: false, reason: 'darwin_unavailable' },
        'corr-abc'
      );
    });

    // AC-5: Workflow marked COMPLETED (not INITIATED or IN_PROGRESS)
    it('should mark workflow as COMPLETED immediately', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.updateWorkflowStatus).toHaveBeenCalledWith(
        expect.any(String),
        'COMPLETED',
        'corr-abc'
      );
    });
  });

  describe('AC-4: Extract correlation_id from event, propagate through all calls and logs', () => {
    // AC-4: Extract correlation_id from payload
    it('should extract correlation_id from event payload', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-xyz-456',
      };

      await handler.handle(payload);

      // Verify correlation_id passed to all repository calls
      expect(mockWorkflowRepository.createWorkflow).toHaveBeenCalledWith(
        'journey-456',
        'corr-xyz-456'
      );
      expect(mockWorkflowRepository.updateWorkflowStatus).toHaveBeenCalledWith(
        expect.any(String),
        'COMPLETED',
        'corr-xyz-456'
      );
    });

    // AC-4: Propagate correlation_id to logs
    it('should propagate correlation_id to all log entries', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-xyz-456',
      };

      await handler.handle(payload);

      // Verify all logs include correlation_id
      const infoCalls = mockLogger.info.mock.calls;
      for (const call of infoCalls) {
        expect(call[1]).toHaveProperty('correlation_id', 'corr-xyz-456');
      }
    });

    // AC-4: Generate correlation_id if missing from payload
    it('should generate correlation_id if missing from payload', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        // correlation_id missing
      };

      await handler.handle(payload);

      // Verify createWorkflow called with a UUID
      expect(mockWorkflowRepository.createWorkflow).toHaveBeenCalledWith(
        'journey-456',
        expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      );
    });

    // AC-4: Log warning when correlation_id missing
    it('should log warning when correlation_id missing from payload', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        // correlation_id missing
      };

      await handler.handle(payload);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('correlation_id'),
        expect.any(Object)
      );
    });
  });

  describe('AC-8: Idempotent processing -- duplicate events for same journey_id are ignored', () => {
    // AC-8: Skip processing if workflow already exists for journey_id
    it('should skip processing if workflow exists with INITIATED status', async () => {
      mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue({
        id: 'workflow-123',
        journey_id: 'journey-456',
        status: 'INITIATED',
      });

      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      // Should NOT create new workflow
      expect(mockWorkflowRepository.createWorkflow).not.toHaveBeenCalled();
    });

    // AC-8: Skip processing if workflow exists with IN_PROGRESS status
    it('should skip processing if workflow exists with IN_PROGRESS status', async () => {
      mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue({
        id: 'workflow-123',
        journey_id: 'journey-456',
        status: 'IN_PROGRESS',
      });

      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.createWorkflow).not.toHaveBeenCalled();
    });

    // AC-8: Skip processing if workflow exists with COMPLETED status
    it('should skip processing if workflow exists with COMPLETED status', async () => {
      mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue({
        id: 'workflow-123',
        journey_id: 'journey-456',
        status: 'COMPLETED',
      });

      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.createWorkflow).not.toHaveBeenCalled();
    });

    // AC-8: Skip processing if workflow exists with PARTIAL_SUCCESS status
    it('should skip processing if workflow exists with PARTIAL_SUCCESS status', async () => {
      mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue({
        id: 'workflow-123',
        journey_id: 'journey-456',
        status: 'PARTIAL_SUCCESS',
      });

      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.createWorkflow).not.toHaveBeenCalled();
    });

    // AC-8: Log at info level when duplicate detected
    it('should log at info level when duplicate event detected', async () => {
      mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue({
        id: 'workflow-123',
        journey_id: 'journey-456',
        status: 'COMPLETED',
      });

      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('duplicate'),
        expect.objectContaining({
          correlation_id: 'corr-abc',
          journey_id: 'journey-456',
        })
      );
    });
  });

  describe('AC-9: Consumer handler uses @railrepay/winston-logger (no console.log)', () => {
    // AC-9: Logger used for workflow creation
    it('should log workflow creation with winston-logger', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('workflow'),
        expect.any(Object)
      );
    });

    // AC-9: Logger used for error scenarios
    it('should log errors with winston-logger', async () => {
      mockWorkflowRepository.createWorkflow.mockRejectedValue(new Error('Database error'));

      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await expect(handler.handle(payload)).rejects.toThrow('Database error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          correlation_id: 'corr-abc',
        })
      );
    });
  });

  describe('Payload validation', () => {
    // Payload validation: journey_id required
    it('should throw validation error when journey_id missing', async () => {
      const payload = {
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      } as any;

      await expect(handler.handle(payload)).rejects.toThrow(/journey_id/);
    });

    // Payload validation: user_id required
    it('should throw validation error when user_id missing', async () => {
      const payload = {
        journey_id: 'journey-456',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      } as any;

      await expect(handler.handle(payload)).rejects.toThrow(/user_id/);
    });

    // Payload validation: reason required
    it('should throw validation error when reason missing', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        correlation_id: 'corr-abc',
      } as any;

      await expect(handler.handle(payload)).rejects.toThrow(/reason/);
    });

    // Payload validation: reason must be valid value
    it('should throw validation error when reason is not valid', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'invalid_reason',
        correlation_id: 'corr-abc',
      } as any;

      await expect(handler.handle(payload)).rejects.toThrow(/reason/);
    });

    // Payload validation: reason=below_threshold is valid
    it('should accept reason=below_threshold', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'below_threshold',
        correlation_id: 'corr-abc',
      };

      await expect(handler.handle(payload)).resolves.not.toThrow();
    });

    // Payload validation: reason=darwin_unavailable is valid
    it('should accept reason=darwin_unavailable', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        reason: 'darwin_unavailable',
        correlation_id: 'corr-abc',
      };

      await expect(handler.handle(payload)).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // BL-178: evaluation-coordinator must publish evaluation.completed for no-delay events
  // =========================================================================
  describe('BL-178: outbox event publication for no-delay events', () => {
    // BL-178/AC-1: Handler MUST call createOutboxEvent after completing the workflow
    it('BL-178/AC-1: should call createOutboxEvent after workflow completion', async () => {
      const payload = {
        journey_id: 'journey-bl178-001',
        user_id: 'user-bl178-001',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-001',
      };

      await handler.handle(payload);

      // createOutboxEvent must be called — this will FAIL until Blake adds the call
      expect(mockWorkflowRepository.createOutboxEvent).toHaveBeenCalledTimes(1);
    });

    // BL-178/AC-1: event_type must be 'evaluation.completed'
    it('BL-178/AC-1: should publish outbox event with event_type evaluation.completed', async () => {
      const payload = {
        journey_id: 'journey-bl178-002',
        user_id: 'user-bl178-002',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-002',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.createOutboxEvent).toHaveBeenCalledWith(
        expect.any(String),          // aggregate_id (workflow.id)
        'EVALUATION_WORKFLOW',        // aggregate_type
        'evaluation.completed',       // event_type
        expect.any(Object),           // payload
        'corr-bl178-002'              // correlation_id
      );
    });

    // BL-178/AC-1: aggregate_type must be 'EVALUATION_WORKFLOW' (mirrors delay-detected-handler pattern)
    it('BL-178/AC-1: should use aggregate_type EVALUATION_WORKFLOW matching delay-detected pattern', async () => {
      const payload = {
        journey_id: 'journey-bl178-003',
        user_id: 'user-bl178-003',
        reason: 'darwin_unavailable' as const,
        correlation_id: 'corr-bl178-003',
      };

      await handler.handle(payload);

      const callArgs = mockWorkflowRepository.createOutboxEvent.mock.calls[0];
      expect(callArgs[1]).toBe('EVALUATION_WORKFLOW');
    });

    // BL-178/AC-2: Outbox payload must include journey_id
    it('BL-178/AC-2: outbox event payload must include journey_id', async () => {
      const payload = {
        journey_id: 'journey-bl178-payload-001',
        user_id: 'user-bl178-payload-001',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-payload-001',
      };

      await handler.handle(payload);

      const outboxPayload = mockWorkflowRepository.createOutboxEvent.mock.calls[0][3];
      expect(outboxPayload).toHaveProperty('journey_id', 'journey-bl178-payload-001');
    });

    // BL-178/AC-2: Outbox payload must include user_id
    it('BL-178/AC-2: outbox event payload must include user_id', async () => {
      const payload = {
        journey_id: 'journey-bl178-payload-002',
        user_id: 'user-bl178-payload-002',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-payload-002',
      };

      await handler.handle(payload);

      const outboxPayload = mockWorkflowRepository.createOutboxEvent.mock.calls[0][3];
      expect(outboxPayload).toHaveProperty('user_id', 'user-bl178-payload-002');
    });

    // BL-178/AC-1: Outbox payload must include is_eligible: false
    it('BL-178/AC-1: outbox event payload must include is_eligible: false', async () => {
      const payload = {
        journey_id: 'journey-bl178-payload-003',
        user_id: 'user-bl178-payload-003',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-payload-003',
      };

      await handler.handle(payload);

      const outboxPayload = mockWorkflowRepository.createOutboxEvent.mock.calls[0][3];
      expect(outboxPayload).toHaveProperty('is_eligible', false);
    });

    // BL-178/AC-1: Outbox payload reason must be 'no_delay_detected' (canonical downstream value)
    it('BL-178/AC-1: outbox event payload must include reason: no_delay_detected', async () => {
      // The handler maps all delay.not-detected events to reason 'no_delay_detected'
      // in the outbox payload regardless of the internal reason (below_threshold / darwin_unavailable)
      const payloadBelowThreshold = {
        journey_id: 'journey-bl178-reason-001',
        user_id: 'user-bl178-reason-001',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-reason-001',
      };

      await handler.handle(payloadBelowThreshold);

      const outboxPayload = mockWorkflowRepository.createOutboxEvent.mock.calls[0][3];
      expect(outboxPayload).toHaveProperty('reason', 'no_delay_detected');
    });

    // BL-178/AC-1: reason 'no_delay_detected' applies to darwin_unavailable payloads too
    it('BL-178/AC-1: outbox payload reason is no_delay_detected for darwin_unavailable events', async () => {
      const payloadDarwinUnavailable = {
        journey_id: 'journey-bl178-reason-002',
        user_id: 'user-bl178-reason-002',
        reason: 'darwin_unavailable' as const,
        correlation_id: 'corr-bl178-reason-002',
      };

      await handler.handle(payloadDarwinUnavailable);

      const outboxPayload = mockWorkflowRepository.createOutboxEvent.mock.calls[0][3];
      expect(outboxPayload).toHaveProperty('reason', 'no_delay_detected');
    });

    // BL-178/AC-2: Outbox payload must include correlation_id
    it('BL-178/AC-2: outbox event payload must include correlation_id', async () => {
      const payload = {
        journey_id: 'journey-bl178-corr-001',
        user_id: 'user-bl178-corr-001',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-corr-001',
      };

      await handler.handle(payload);

      const outboxPayload = mockWorkflowRepository.createOutboxEvent.mock.calls[0][3];
      expect(outboxPayload).toHaveProperty('correlation_id', 'corr-bl178-corr-001');
    });

    // BL-178/AC-2: aggregate_id must be the workflow id returned by createWorkflow
    it('BL-178/AC-2: createOutboxEvent aggregate_id must be the workflow id', async () => {
      const payload = {
        journey_id: 'journey-bl178-wfid-001',
        user_id: 'user-bl178-wfid-001',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-wfid-001',
      };

      // createWorkflow mock returns { id: 'workflow-123', ... }
      await handler.handle(payload);

      const callArgs = mockWorkflowRepository.createOutboxEvent.mock.calls[0];
      expect(callArgs[0]).toBe('workflow-123');
    });

    // BL-178/AC-4: Regression — createOutboxEvent must be called AFTER updateWorkflowStatus
    // This ensures the outbox event is only written when the workflow is fully COMPLETED
    it('BL-178/AC-4: createOutboxEvent must be called after updateWorkflowStatus', async () => {
      const callOrder: string[] = [];
      mockWorkflowRepository.updateWorkflowStatus.mockImplementation(async () => {
        callOrder.push('updateWorkflowStatus');
      });
      mockWorkflowRepository.createOutboxEvent.mockImplementation(async () => {
        callOrder.push('createOutboxEvent');
        return {
          id: 'outbox-event-order-001',
          aggregate_id: 'workflow-123',
          aggregate_type: 'EVALUATION_WORKFLOW',
          event_type: 'evaluation.completed',
          payload: {},
          correlation_id: 'corr-bl178-order-001',
          published: false,
          created_at: new Date(),
        };
      });

      const payload = {
        journey_id: 'journey-bl178-order-001',
        user_id: 'user-bl178-order-001',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-order-001',
      };

      await handler.handle(payload);

      const statusIdx = callOrder.indexOf('updateWorkflowStatus');
      const outboxIdx = callOrder.indexOf('createOutboxEvent');
      expect(statusIdx).toBeGreaterThanOrEqual(0);
      expect(outboxIdx).toBeGreaterThan(statusIdx);
    });

    // BL-178/AC-5: Idempotency — duplicate events must not produce duplicate outbox events
    it('BL-178/AC-5: duplicate delay.not-detected events must not produce duplicate outbox events', async () => {
      // Simulate: workflow already exists for this journey (idempotency guard returns early)
      mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue({
        id: 'workflow-existing-001',
        journey_id: 'journey-bl178-idem-001',
        status: 'COMPLETED',
      });

      const payload = {
        journey_id: 'journey-bl178-idem-001',
        user_id: 'user-bl178-idem-001',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-idem-001',
      };

      await handler.handle(payload);

      // Handler must return early — createOutboxEvent must NOT be called for duplicates
      expect(mockWorkflowRepository.createOutboxEvent).not.toHaveBeenCalled();
      // createWorkflow also must not be called
      expect(mockWorkflowRepository.createWorkflow).not.toHaveBeenCalled();
    });

    // BL-178/AC-5: Idempotency preserved for INITIATED duplicate status
    it('BL-178/AC-5: no outbox event on duplicate with INITIATED workflow status', async () => {
      mockWorkflowRepository.getWorkflowByJourneyId.mockResolvedValue({
        id: 'workflow-existing-002',
        journey_id: 'journey-bl178-idem-002',
        status: 'INITIATED',
      });

      const payload = {
        journey_id: 'journey-bl178-idem-002',
        user_id: 'user-bl178-idem-002',
        reason: 'darwin_unavailable' as const,
        correlation_id: 'corr-bl178-idem-002',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.createOutboxEvent).not.toHaveBeenCalled();
    });

    // BL-178/AC-4: Regression — existing tests for delay-not-detected handler still pass
    // (No new tests needed here; the existing describe blocks above serve as the regression suite.
    // This test confirms the handler completes without error when outbox is written successfully.)
    it('BL-178/AC-4: handler completes successfully when outbox event is written (regression baseline)', async () => {
      const payload = {
        journey_id: 'journey-bl178-reg-001',
        user_id: 'user-bl178-reg-001',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-reg-001',
      };

      await expect(handler.handle(payload)).resolves.toBeUndefined();

      // All three repository operations must complete
      expect(mockWorkflowRepository.createWorkflow).toHaveBeenCalledTimes(1);
      expect(mockWorkflowRepository.updateWorkflowStatus).toHaveBeenCalledTimes(1);
      expect(mockWorkflowRepository.updateWorkflowEligibilityResult).toHaveBeenCalledTimes(1);
      expect(mockWorkflowRepository.createOutboxEvent).toHaveBeenCalledTimes(1);
    });

    // BL-178: createOutboxEvent failure must propagate — allows Kafka retry
    it('BL-178: should propagate error when createOutboxEvent throws', async () => {
      mockWorkflowRepository.createOutboxEvent.mockRejectedValue(
        new Error('Outbox insert failed')
      );

      const payload = {
        journey_id: 'journey-bl178-err-001',
        user_id: 'user-bl178-err-001',
        reason: 'below_threshold' as const,
        correlation_id: 'corr-bl178-err-001',
      };

      await expect(handler.handle(payload)).rejects.toThrow('Outbox insert failed');
    });
  });
});
