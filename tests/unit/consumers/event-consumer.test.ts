/**
 * Event Consumer Tests
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
 * - AC-1: Kafka consumer subscribing to delay.detected topic
 * - AC-2: Kafka consumer subscribing to delay.not-detected topic
 * - AC-9: Consumer handler uses @railrepay/winston-logger
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// AC-1, AC-2: These imports will fail until Blake creates the files
import { EventConsumer } from '../../../src/consumers/event-consumer.js';

// Mock @railrepay/kafka-client (interface-based mocking per guidelines)
// Use vi.hoisted() to ensure it's available during mock hoisting
// Matches REAL KafkaConsumer API: connect(), subscribe(), disconnect(), isConsumerRunning(), getStats()
const mockKafkaConsumer = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  isConsumerRunning: vi.fn().mockReturnValue(true),
  getStats: vi.fn().mockReturnValue({
    processedCount: 0,
    errorCount: 0,
    lastProcessedAt: null,
  }),
}));

vi.mock('@railrepay/kafka-client', () => ({
  KafkaConsumer: vi.fn(() => mockKafkaConsumer),
}));

// Shared logger mock instance (OUTSIDE factory per guideline #11)
// Use vi.hoisted() to ensure it's available during mock hoisting
const sharedLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

describe('EventConsumer', () => {
  let mockDb: any;
  let mockLogger: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    mockDb = {
      query: vi.fn(),
      pool: {},
    };

    mockLogger = sharedLogger;
  });

  describe('AC-1, AC-2: Kafka consumer subscribing to both topics', () => {
    // AC-1: Subscribe to delay.detected topic
    it('should subscribe to delay.detected topic on start', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      // Verify subscribe was called with delay.detected
      expect(mockKafkaConsumer.subscribe).toHaveBeenCalled();
      const subscribeCalls = mockKafkaConsumer.subscribe.mock.calls;
      const delayDetectedCall = subscribeCalls.find((call: any) => call[0] === 'delay.detected');
      expect(delayDetectedCall).toBeDefined();
    });

    // AC-2: Subscribe to delay.not-detected topic
    it('should subscribe to delay.not-detected topic on start', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      // Verify subscribe was called with delay.not-detected
      expect(mockKafkaConsumer.subscribe).toHaveBeenCalled();
      const subscribeCalls = mockKafkaConsumer.subscribe.mock.calls;
      const delayNotDetectedCall = subscribeCalls.find((call: any) => call[0] === 'delay.not-detected');
      expect(delayNotDetectedCall).toBeDefined();
    });

    // AC-1, AC-2: Subscribe to BOTH topics
    it('should subscribe to both delay.detected AND delay.not-detected topics', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      expect(mockKafkaConsumer.subscribe).toHaveBeenCalledTimes(2);
      const subscribeCalls = mockKafkaConsumer.subscribe.mock.calls;
      const topics = subscribeCalls.map((call: any) => call[0]);
      expect(topics).toContain('delay.detected');
      expect(topics).toContain('delay.not-detected');
    });
  });

  describe('Lifecycle management', () => {
    // Lifecycle: connect -> subscribe (subscribe auto-starts per @railrepay/kafka-client API)
    it('should follow connect -> subscribe lifecycle', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      // Verify lifecycle order: connect must be called before subscribe
      const connectOrder = vi.mocked(mockKafkaConsumer.connect).mock.invocationCallOrder[0];
      const subscribeOrder = vi.mocked(mockKafkaConsumer.subscribe).mock.invocationCallOrder[0];

      expect(connectOrder).toBeLessThan(subscribeOrder!);
      // No separate start() method - subscribe() auto-starts consumption
    });

    // Lifecycle: disconnect on stop
    it('should disconnect on stop', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();
      await consumer.stop();

      expect(mockKafkaConsumer.disconnect).toHaveBeenCalled();
    });

    // isRunning returns true after start
    it('should return true from isRunning after start', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      expect(consumer.isRunning()).toBe(true);
    });

    // isRunning returns false after stop
    it('should return false from isRunning after stop', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();
      await consumer.stop();

      expect(consumer.isRunning()).toBe(false);
    });
  });

  describe('Stats tracking', () => {
    // Stats tracking: getStats returns stats
    it('should return consumer stats via getStats', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      const stats = consumer.getStats();

      expect(stats).toHaveProperty('processedCount');
      expect(stats).toHaveProperty('errorCount');
      expect(stats).toHaveProperty('isRunning');
      expect(stats).toHaveProperty('handlers');
    });

    // Stats: track delay.detected handler stats
    it('should track delay.detected handler stats', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      const stats = consumer.getStats();

      expect(stats.handlers).toHaveProperty('delay.detected');
    });

    // Stats: track delay.not-detected handler stats
    it('should track delay.not-detected handler stats', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      const stats = consumer.getStats();

      expect(stats.handlers).toHaveProperty('delay.not-detected');
    });
  });

  describe('AC-9: Winston logger usage', () => {
    // AC-9: Logger passed to KafkaConsumer
    it('should pass logger to KafkaConsumer', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      // KafkaConsumer constructor should receive logger
      const { KafkaConsumer } = await import('@railrepay/kafka-client');
      expect(KafkaConsumer).toHaveBeenCalledWith(
        expect.objectContaining({
          logger: mockLogger,
        })
      );
    });

    // AC-9: Logger logs connect event
    it('should log connection events with logger', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Kafka'),
        expect.any(Object)
      );
    });
  });

  describe('Error handling', () => {
    // Error handling: connection failure
    it('should throw error if connection fails', async () => {
      mockKafkaConsumer.connect.mockRejectedValueOnce(new Error('Connection failed'));

      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await expect(consumer.start()).rejects.toThrow('Connection failed');
    });

    // Error handling: log error on connection failure
    it('should log error on connection failure', async () => {
      mockKafkaConsumer.connect.mockRejectedValueOnce(new Error('Connection failed'));

      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      try {
        await consumer.start();
      } catch (error) {
        // Expected
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to connect'),
        expect.any(Object)
      );
    });

    // Error handling: graceful shutdown on stop failure
    it('should not throw on disconnect failure during stop', async () => {
      const consumer = new EventConsumer({
        serviceName: 'evaluation-coordinator',
        brokers: ['broker1:9092'],
        username: 'test-user',
        password: 'test-pass',
        groupId: 'evaluation-coordinator-consumer-group',
        db: mockDb,
        logger: mockLogger,
      });

      await consumer.start();

      mockKafkaConsumer.disconnect.mockRejectedValueOnce(new Error('Disconnect failed'));

      // Should not throw - graceful shutdown
      await expect(consumer.stop()).resolves.not.toThrow();
    });
  });
});
