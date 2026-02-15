/**
 * Consumer Configuration Tests
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
 * - AC-6: Kafka env vars configured (tested via config parser)
 * - AC-7: Graceful degradation -- HTTP-only mode if Kafka config missing
 * - AC-10: Consumer group ID: evaluation-coordinator-consumer-group
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// AC-6, AC-7: These imports will fail until Blake creates the files
import { createConsumerConfig, ConsumerConfigError } from '../../../src/consumers/config.js';

describe('Consumer Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('AC-6: Kafka environment variables configured', () => {
    // AC-6: Parse KAFKA_BROKERS as comma-separated list
    it('should parse KAFKA_BROKERS as comma-separated list', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9092,broker3:9092';
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'test-pass';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';

      const config = createConsumerConfig();

      expect(config.brokers).toEqual(['broker1:9092', 'broker2:9092', 'broker3:9092']);
    });

    // AC-6: Parse KAFKA_USERNAME
    it('should parse KAFKA_USERNAME from env', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092';
      process.env.KAFKA_USERNAME = 'confluent-api-key';
      process.env.KAFKA_PASSWORD = 'confluent-secret';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';

      const config = createConsumerConfig();

      expect(config.username).toBe('confluent-api-key');
    });

    // AC-6: Parse KAFKA_PASSWORD
    it('should parse KAFKA_PASSWORD from env', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092';
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'secret-password';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';

      const config = createConsumerConfig();

      expect(config.password).toBe('secret-password');
    });

    // AC-10: Consumer group ID follows naming convention
    it('should use evaluation-coordinator-consumer-group as group ID', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092';
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'test-pass';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';

      const config = createConsumerConfig();

      expect(config.groupId).toBe('evaluation-coordinator-consumer-group');
    });

    // AC-6: Parse KAFKA_SSL_ENABLED (defaults to true)
    it('should default SSL to true when KAFKA_SSL_ENABLED not set', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092';
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'test-pass';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';
      delete process.env.KAFKA_SSL_ENABLED;

      const config = createConsumerConfig();

      expect(config.ssl).toBe(true);
    });

    // AC-6: Parse KAFKA_SSL_ENABLED (explicit false)
    it('should set SSL to false when KAFKA_SSL_ENABLED=false', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092';
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'test-pass';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';
      process.env.KAFKA_SSL_ENABLED = 'false';

      const config = createConsumerConfig();

      expect(config.ssl).toBe(false);
    });

    // AC-6: Service name defaults to evaluation-coordinator
    it('should default serviceName to evaluation-coordinator', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092';
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'test-pass';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';
      delete process.env.SERVICE_NAME;

      const config = createConsumerConfig();

      expect(config.serviceName).toBe('evaluation-coordinator');
    });
  });

  describe('AC-7: Graceful degradation when Kafka config missing', () => {
    // AC-7: Throw ConsumerConfigError when KAFKA_BROKERS missing
    it('should throw ConsumerConfigError when KAFKA_BROKERS missing', () => {
      delete process.env.KAFKA_BROKERS;
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'test-pass';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_BROKERS/);
    });

    // AC-7: Throw ConsumerConfigError when KAFKA_USERNAME missing
    it('should throw ConsumerConfigError when KAFKA_USERNAME missing', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092';
      delete process.env.KAFKA_USERNAME;
      process.env.KAFKA_PASSWORD = 'test-pass';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_USERNAME/);
    });

    // AC-7: Throw ConsumerConfigError when KAFKA_PASSWORD missing
    it('should throw ConsumerConfigError when KAFKA_PASSWORD missing', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092';
      process.env.KAFKA_USERNAME = 'test-user';
      delete process.env.KAFKA_PASSWORD;
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_PASSWORD/);
    });

    // AC-7: Throw ConsumerConfigError when KAFKA_GROUP_ID missing
    it('should throw ConsumerConfigError when KAFKA_GROUP_ID missing', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092';
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'test-pass';
      delete process.env.KAFKA_GROUP_ID;

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_GROUP_ID/);
    });

    // AC-7: List ALL missing variables in error message
    it('should list all missing required variables in error message', () => {
      delete process.env.KAFKA_BROKERS;
      delete process.env.KAFKA_USERNAME;
      delete process.env.KAFKA_PASSWORD;
      delete process.env.KAFKA_GROUP_ID;

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_BROKERS/);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_USERNAME/);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_PASSWORD/);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_GROUP_ID/);
    });

    // AC-7: Throw when env var is empty string
    it('should throw ConsumerConfigError when env var is empty string', () => {
      process.env.KAFKA_BROKERS = '';
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'test-pass';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_BROKERS/);
    });

    // AC-7: Throw when env var is whitespace only
    it('should throw ConsumerConfigError when env var is whitespace only', () => {
      process.env.KAFKA_BROKERS = '   ';
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'test-pass';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';

      expect(() => createConsumerConfig()).toThrow(ConsumerConfigError);
      expect(() => createConsumerConfig()).toThrow(/KAFKA_BROKERS/);
    });
  });

  describe('AC-10: Consumer group ID naming convention', () => {
    // AC-10: Verify exact group ID value from env
    it('should use exact group ID from KAFKA_GROUP_ID env var', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092';
      process.env.KAFKA_USERNAME = 'test-user';
      process.env.KAFKA_PASSWORD = 'test-pass';
      process.env.KAFKA_GROUP_ID = 'evaluation-coordinator-consumer-group';

      const config = createConsumerConfig();

      expect(config.groupId).toBe('evaluation-coordinator-consumer-group');
    });
  });
});
