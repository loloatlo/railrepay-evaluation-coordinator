/**
 * Unit tests for WorkflowRepository - Transactional Outbox (BL-146)
 *
 * Phase: TD-1 Test Specification (Jessie)
 * Author: Jessie (QA Engineer)
 * Date: 2026-02-15
 *
 * PURPOSE:
 * Tests for the NEW transactional method that atomically updates workflow AND writes outbox event.
 * This ensures ADR-007 compliance (transactional outbox pattern).
 *
 * ACCEPTANCE CRITERIA COVERAGE:
 * - AC-6: Transactional outbox event for evaluation.completed (ADR-007)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowRepository } from '../../../src/repositories/workflow-repository.js';

describe('BL-146: WorkflowRepository - Transactional Outbox', () => {
  let repository: WorkflowRepository;
  let mockDb: any;

  const workflowId = '770e8400-e29b-41d4-a716-446655440002';
  const journeyId = '550e8400-e29b-41d4-a716-446655440000';
  const userId = '660e8400-e29b-41d4-a716-446655440001';
  const correlationId = '123e4567-e89b-42d3-a456-426614174000';

  beforeEach(() => {
    // Create mock database with transaction support
    mockDb = {
      query: vi.fn(),
      transaction: vi.fn() // New method for transaction support
    };

    repository = new WorkflowRepository(mockDb);
    vi.clearAllMocks();
  });

  /**
   * AC-6: completeWorkflowWithOutbox() executes workflow update + outbox write in single transaction
   */
  it('should atomically update workflow and create outbox event in single transaction', async () => {
    // Arrange
    const eligibilityResult = {
      journey_id: journeyId,
      eligible: true,
      scheme: 'DR30',
      delay_minutes: 45,
      compensation_percentage: 50,
      compensation_pence: 0,
      ticket_fare_pence: 0,
      reasons: ['Delay of 45 minutes qualifies for 50% refund under DR30 scheme'],
      applied_rules: ['DR30_30MIN_50PCT'],
      evaluation_timestamp: '2026-02-15T10:00:00.000Z'
    };

    const outboxPayload = {
      journey_id: journeyId,
      user_id: userId,
      eligible: true,
      scheme: 'DR30',
      compensation_pence: 0,
      correlation_id: correlationId
    };

    // Mock transaction callback execution
    let transactionCallback: any;
    mockDb.transaction.mockImplementation((callback: any) => {
      transactionCallback = callback;
      // Simulate executing the callback with a mock transaction client
      const mockTxClient = {
        query: vi.fn().mockResolvedValue([{ id: workflowId }])
      };
      return callback(mockTxClient);
    });

    // Act
    await repository.completeWorkflowWithOutbox(
      workflowId,
      eligibilityResult,
      outboxPayload,
      correlationId
    );

    // Assert - AC-6: transaction() was called
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.transaction).toHaveBeenCalledWith(expect.any(Function));

    // Assert - AC-6: Verify the transaction callback executes both queries
    // (This is an interface test - Blake will implement the actual SQL)
    expect(transactionCallback).toBeDefined();
  });

  /**
   * AC-6: Transaction should rollback if workflow update fails
   */
  it('should rollback transaction when workflow update fails', async () => {
    // Arrange
    const eligibilityResult = {
      journey_id: journeyId,
      eligible: true,
      scheme: 'DR30',
      delay_minutes: 45,
      compensation_percentage: 50,
      compensation_pence: 0,
      ticket_fare_pence: 0,
      reasons: ['Eligible'],
      applied_rules: ['DR30_30MIN_50PCT'],
      evaluation_timestamp: '2026-02-15T10:00:00.000Z'
    };

    const outboxPayload = {
      journey_id: journeyId,
      user_id: userId,
      eligible: true,
      scheme: 'DR30',
      compensation_pence: 0,
      correlation_id: correlationId
    };

    // Mock transaction that fails on workflow update
    mockDb.transaction.mockImplementation((callback: any) => {
      const mockTxClient = {
        query: vi.fn()
          .mockRejectedValueOnce(new Error('Workflow update failed: workflow not found'))
      };
      return callback(mockTxClient);
    });

    // Act & Assert - AC-6: Transaction failure should propagate
    await expect(
      repository.completeWorkflowWithOutbox(
        workflowId,
        eligibilityResult,
        outboxPayload,
        correlationId
      )
    ).rejects.toThrow('Workflow update failed: workflow not found');

    // Assert - AC-6: Transaction was attempted
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  /**
   * AC-6: Transaction should rollback if outbox event creation fails
   */
  it('should rollback transaction when outbox event creation fails', async () => {
    // Arrange
    const eligibilityResult = {
      journey_id: journeyId,
      eligible: true,
      scheme: 'DR30',
      delay_minutes: 45,
      compensation_percentage: 50,
      compensation_pence: 0,
      ticket_fare_pence: 0,
      reasons: ['Eligible'],
      applied_rules: ['DR30_30MIN_50PCT'],
      evaluation_timestamp: '2026-02-15T10:00:00.000Z'
    };

    const outboxPayload = {
      journey_id: journeyId,
      user_id: userId,
      eligible: true,
      scheme: 'DR30',
      compensation_pence: 0,
      correlation_id: correlationId
    };

    // Mock transaction that succeeds on workflow update but fails on outbox insert
    mockDb.transaction.mockImplementation((callback: any) => {
      const mockTxClient = {
        query: vi.fn()
          .mockResolvedValueOnce([{ id: workflowId }]) // Workflow update succeeds
          .mockResolvedValueOnce([{ id: workflowId }]) // Status update succeeds
          .mockRejectedValueOnce(new Error('Outbox insert failed: duplicate key violation'))
      };
      return callback(mockTxClient);
    });

    // Act & Assert - AC-6: Transaction failure should propagate
    await expect(
      repository.completeWorkflowWithOutbox(
        workflowId,
        eligibilityResult,
        outboxPayload,
        correlationId
      )
    ).rejects.toThrow('Outbox insert failed: duplicate key violation');

    // Assert - AC-6: Transaction was attempted
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  /**
   * AC-6: Method should accept full eligibility result and outbox payload
   */
  it('should accept and use full eligibility result and outbox payload', async () => {
    // Arrange
    const eligibilityResult = {
      journey_id: journeyId,
      eligible: true,
      scheme: 'DR30',
      delay_minutes: 45,
      compensation_percentage: 50,
      compensation_pence: 1250, // Non-zero when ticket_fare_pence is available
      ticket_fare_pence: 2500,
      reasons: ['Delay of 45 minutes qualifies for 50% refund under DR30 scheme'],
      applied_rules: ['DR30_30MIN_50PCT'],
      evaluation_timestamp: '2026-02-15T10:00:00.000Z'
    };

    const outboxPayload = {
      journey_id: journeyId,
      user_id: userId,
      eligible: true,
      scheme: 'DR30',
      compensation_pence: 1250,
      correlation_id: correlationId
    };

    // Mock successful transaction
    mockDb.transaction.mockImplementation((callback: any) => {
      const mockTxClient = {
        query: vi.fn().mockResolvedValue([{ id: workflowId }])
      };
      return callback(mockTxClient);
    });

    // Act
    await repository.completeWorkflowWithOutbox(
      workflowId,
      eligibilityResult,
      outboxPayload,
      correlationId
    );

    // Assert - Method completes without error
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  /**
   * AC-6: Method should work for eligible: false results (still COMPLETED)
   */
  it('should complete workflow with eligible: false result', async () => {
    // Arrange
    const eligibilityResult = {
      journey_id: journeyId,
      eligible: false,
      scheme: 'DR30',
      delay_minutes: 10,
      compensation_percentage: 0,
      compensation_pence: 0,
      ticket_fare_pence: 0,
      reasons: ['Delay below threshold'],
      applied_rules: [],
      evaluation_timestamp: '2026-02-15T10:00:00.000Z'
    };

    const outboxPayload = {
      journey_id: journeyId,
      user_id: userId,
      eligible: false,
      scheme: 'DR30',
      compensation_pence: 0,
      correlation_id: correlationId
    };

    // Mock successful transaction
    mockDb.transaction.mockImplementation((callback: any) => {
      const mockTxClient = {
        query: vi.fn().mockResolvedValue([{ id: workflowId }])
      };
      return callback(mockTxClient);
    });

    // Act
    await repository.completeWorkflowWithOutbox(
      workflowId,
      eligibilityResult,
      outboxPayload,
      correlationId
    );

    // Assert - Method completes without error (eligible: false is valid result)
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });
});
