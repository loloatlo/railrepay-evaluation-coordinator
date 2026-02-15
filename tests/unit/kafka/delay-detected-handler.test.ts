/**
 * Delay Detected Handler Tests
 *
 * Phase: TD-1 Test Specification (Jessie)
 * BL-145 (TD-EVAL-COORDINATOR-001): Add Kafka consumer infrastructure
 * Author: Jessie (QA Engineer)
 * Date: 2026-02-15
 *
 * TDD Workflow (ADR-014):
 * 1. These tests MUST FAIL initially (RED phase - no implementation exists)
 * 2. Blake implements to make tests pass (GREEN phase)
 * 3. Jessie verifies all tests GREEN in Phase TD-3 QA
 *
 * Tests Map to Acceptance Criteria:
 * - AC-3: On delay.detected, create evaluation_workflow with status=INITIATED
 * - AC-4: Extract correlation_id from event, propagate through all calls and logs
 * - AC-8: Idempotent processing -- duplicate events for same journey_id are ignored
 * - AC-9: Consumer handler uses @railrepay/winston-logger (no console.log)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// AC-3: These imports will fail until Blake creates the files
import { DelayDetectedHandler } from '../../../src/kafka/delay-detected-handler.js';

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

describe('DelayDetectedHandler', () => {
  let mockWorkflowRepository: any;
  let mockLogger: any;
  let handler: DelayDetectedHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock WorkflowRepository (interface-based mocking)
    mockWorkflowRepository = {
      createWorkflow: vi.fn().mockResolvedValue({
        id: 'workflow-123',
        journey_id: 'journey-456',
        correlation_id: 'corr-789',
        status: 'INITIATED',
        created_at: new Date(),
        updated_at: new Date(),
      }),
      getWorkflowByJourneyId: vi.fn().mockResolvedValue(null),
    };

    mockLogger = sharedLogger;

    handler = new DelayDetectedHandler({
      workflowRepository: mockWorkflowRepository,
      logger: mockLogger,
    });
  });

  describe('AC-3: On delay.detected, create evaluation_workflow with status=INITIATED', () => {
    // AC-3: Create workflow with INITIATED status
    it('should create evaluation_workflow with status=INITIATED when delay detected', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        delay_minutes: 45,
        is_cancellation: false,
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.createWorkflow).toHaveBeenCalledWith(
        'journey-456',
        'corr-abc'
      );
    });

    // AC-3: Workflow created for cancellation event
    it('should create workflow when is_cancellation is true', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        delay_minutes: 0,
        is_cancellation: true,
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.createWorkflow).toHaveBeenCalledWith(
        'journey-456',
        'corr-abc'
      );
    });

    // AC-3: Workflow created for high delay
    it('should create workflow when delay_minutes exceeds threshold', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        delay_minutes: 120,
        is_cancellation: false,
        correlation_id: 'corr-abc',
      };

      await handler.handle(payload);

      expect(mockWorkflowRepository.createWorkflow).toHaveBeenCalledWith(
        'journey-456',
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
        delay_minutes: 45,
        is_cancellation: false,
        correlation_id: 'corr-xyz-123',
      };

      await handler.handle(payload);

      // Verify correlation_id passed to createWorkflow
      expect(mockWorkflowRepository.createWorkflow).toHaveBeenCalledWith(
        'journey-456',
        'corr-xyz-123'
      );
    });

    // AC-4: Propagate correlation_id to logs
    it('should propagate correlation_id to all log entries', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        delay_minutes: 45,
        is_cancellation: false,
        correlation_id: 'corr-xyz-123',
      };

      await handler.handle(payload);

      // Verify all logs include correlation_id
      const infoCalls = mockLogger.info.mock.calls;
      for (const call of infoCalls) {
        expect(call[1]).toHaveProperty('correlation_id', 'corr-xyz-123');
      }
    });

    // AC-4: Generate correlation_id if missing from payload
    it('should generate correlation_id if missing from payload', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        delay_minutes: 45,
        is_cancellation: false,
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
        delay_minutes: 45,
        is_cancellation: false,
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
        delay_minutes: 45,
        is_cancellation: false,
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
        delay_minutes: 45,
        is_cancellation: false,
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
        delay_minutes: 45,
        is_cancellation: false,
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
        delay_minutes: 45,
        is_cancellation: false,
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
        status: 'INITIATED',
      });

      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        delay_minutes: 45,
        is_cancellation: false,
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
        delay_minutes: 45,
        is_cancellation: false,
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
        delay_minutes: 45,
        is_cancellation: false,
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
        delay_minutes: 45,
        is_cancellation: false,
        correlation_id: 'corr-abc',
      } as any;

      await expect(handler.handle(payload)).rejects.toThrow(/journey_id/);
    });

    // Payload validation: user_id required
    it('should throw validation error when user_id missing', async () => {
      const payload = {
        journey_id: 'journey-456',
        delay_minutes: 45,
        is_cancellation: false,
        correlation_id: 'corr-abc',
      } as any;

      await expect(handler.handle(payload)).rejects.toThrow(/user_id/);
    });

    // Payload validation: delay_minutes required
    it('should throw validation error when delay_minutes missing', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        is_cancellation: false,
        correlation_id: 'corr-abc',
      } as any;

      await expect(handler.handle(payload)).rejects.toThrow(/delay_minutes/);
    });

    // Payload validation: is_cancellation required
    it('should throw validation error when is_cancellation missing', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        delay_minutes: 45,
        correlation_id: 'corr-abc',
      } as any;

      await expect(handler.handle(payload)).rejects.toThrow(/is_cancellation/);
    });

    // Payload validation: delay_minutes must be number
    it('should throw validation error when delay_minutes is not a number', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        delay_minutes: 'not-a-number',
        is_cancellation: false,
        correlation_id: 'corr-abc',
      } as any;

      await expect(handler.handle(payload)).rejects.toThrow(/delay_minutes/);
    });

    // Payload validation: is_cancellation must be boolean
    it('should throw validation error when is_cancellation is not a boolean', async () => {
      const payload = {
        journey_id: 'journey-456',
        user_id: 'user-789',
        delay_minutes: 45,
        is_cancellation: 'not-a-boolean',
        correlation_id: 'corr-abc',
      } as any;

      await expect(handler.handle(payload)).rejects.toThrow(/is_cancellation/);
    });
  });
});
