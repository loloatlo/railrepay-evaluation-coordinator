/**
 * BL-145: Event Consumer Wrapper
 *
 * Main EventConsumer wrapper that manages KafkaConsumer lifecycle
 * and wires up handlers for delay.detected and delay.not-detected topics.
 *
 * Pattern reference: delay-tracker/src/consumers/event-consumer.ts
 */

import { Pool } from 'pg';
import { KafkaConsumer } from '@railrepay/kafka-client';
import { DelayDetectedHandler } from '../kafka/delay-detected-handler.js';
import { DelayNotDetectedHandler } from '../kafka/delay-not-detected-handler.js';
import { WorkflowRepository } from '../repositories/workflow-repository.js';

/**
 * Logger interface for dependency injection
 */
interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * EventConsumer configuration
 */
export interface EventConsumerConfig {
  serviceName: string;
  brokers: string[];
  username: string;
  password: string;
  groupId: string;
  db: Pool | any; // Support both Pool and PostgresClient { pool }
  logger: Logger;
  ssl?: boolean;
}

/**
 * Handler statistics
 */
interface HandlerStats {
  processedCount: number;
  errorCount: number;
  lastProcessedAt: Date | null;
}

/**
 * Consumer statistics
 */
interface ConsumerStats {
  processedCount: number;
  errorCount: number;
  lastProcessedAt: Date | null;
  isRunning: boolean;
  handlers: {
    'delay.detected': HandlerStats;
    'delay.not-detected': HandlerStats;
  };
}

/**
 * EventConsumer class
 *
 * AC-1: Subscribes to delay.detected topic
 * AC-2: Subscribes to delay.not-detected topic
 * AC-9: Uses @railrepay/winston-logger
 *
 * Implementation note: Uses two separate KafkaConsumer instances
 * because KafkaConsumer.subscribe() auto-starts the consumer,
 * preventing multiple subscriptions on a single instance.
 * Both consumers use the same groupId for coordination.
 */
export class EventConsumer {
  private delayDetectedConsumer: KafkaConsumer;
  private delayNotDetectedConsumer: KafkaConsumer;
  private db: any;
  private logger: Logger;
  private started: boolean = false;

  // Handlers
  private delayDetectedHandler: DelayDetectedHandler;
  private delayNotDetectedHandler: DelayNotDetectedHandler;

  // Stats tracking
  private stats: ConsumerStats = {
    processedCount: 0,
    errorCount: 0,
    lastProcessedAt: null,
    isRunning: false,
    handlers: {
      'delay.detected': { processedCount: 0, errorCount: 0, lastProcessedAt: null },
      'delay.not-detected': { processedCount: 0, errorCount: 0, lastProcessedAt: null },
    },
  };

  constructor(config: EventConsumerConfig) {
    this.db = config.db;
    this.logger = config.logger;

    // Create two KafkaConsumer instances (one per topic)
    // They share the same groupId for partition coordination
    // AC-9: Pass logger to both KafkaConsumers
    this.delayDetectedConsumer = new KafkaConsumer({
      serviceName: config.serviceName,
      brokers: config.brokers,
      username: config.username,
      password: config.password,
      groupId: config.groupId,
      logger: config.logger,
      ssl: config.ssl,
    });

    this.delayNotDetectedConsumer = new KafkaConsumer({
      serviceName: config.serviceName,
      brokers: config.brokers,
      username: config.username,
      password: config.password,
      groupId: config.groupId,
      logger: config.logger,
      ssl: config.ssl,
    });

    // Create handler dependencies
    const workflowRepository = new WorkflowRepository(this.db);

    // Create handlers
    this.delayDetectedHandler = new DelayDetectedHandler({
      workflowRepository,
      logger: this.logger,
    });

    this.delayNotDetectedHandler = new DelayNotDetectedHandler({
      workflowRepository,
      logger: this.logger,
    });
  }

  /**
   * Start the event consumer
   * AC-1, AC-2: Subscribe to both topics
   *
   * Uses two separate KafkaConsumer instances to work around
   * the auto-start behavior of subscribe().
   */
  async start(): Promise<void> {
    this.logger.info('Connecting to Kafka', {
      serviceName: 'evaluation-coordinator',
    });

    try {
      // Connect both consumers to Kafka
      await this.delayDetectedConsumer.connect();
      await this.delayNotDetectedConsumer.connect();

      this.logger.info('Successfully connected to Kafka', {
        serviceName: 'evaluation-coordinator',
      });

      // AC-1: Subscribe to delay.detected topic
      this.logger.info('Subscribing to topic', { topic: 'delay.detected' });
      await this.delayDetectedConsumer.subscribe('delay.detected', async (message) => {
        try {
          // Parse the Kafka message value to get the actual payload
          if (!message.message.value) {
            this.logger.error('Empty message value received', {
              topic: message.topic,
              offset: message.message.offset,
            });
            return;
          }

          let payload: unknown;
          try {
            payload = JSON.parse(message.message.value.toString());
          } catch (parseError) {
            this.logger.error('Failed to parse message payload', {
              error: parseError instanceof Error ? parseError.message : String(parseError),
              topic: message.topic,
              offset: message.message.offset,
            });
            return;
          }

          // Call handler with parsed payload
          await this.delayDetectedHandler.handle(payload as any);
          this.stats.handlers['delay.detected'].processedCount++;
          this.stats.handlers['delay.detected'].lastProcessedAt = new Date();
          this.stats.processedCount++;
          this.stats.lastProcessedAt = new Date();
        } catch (error) {
          this.stats.handlers['delay.detected'].errorCount++;
          this.stats.errorCount++;
          throw error;
        }
      });

      // AC-2: Subscribe to delay.not-detected topic
      this.logger.info('Subscribing to topic', { topic: 'delay.not-detected' });
      await this.delayNotDetectedConsumer.subscribe('delay.not-detected', async (message) => {
        try {
          // Parse the Kafka message value to get the actual payload
          if (!message.message.value) {
            this.logger.error('Empty message value received', {
              topic: message.topic,
              offset: message.message.offset,
            });
            return;
          }

          let payload: unknown;
          try {
            payload = JSON.parse(message.message.value.toString());
          } catch (parseError) {
            this.logger.error('Failed to parse message payload', {
              error: parseError instanceof Error ? parseError.message : String(parseError),
              topic: message.topic,
              offset: message.message.offset,
            });
            return;
          }

          // Call handler with parsed payload
          await this.delayNotDetectedHandler.handle(payload as any);
          this.stats.handlers['delay.not-detected'].processedCount++;
          this.stats.handlers['delay.not-detected'].lastProcessedAt = new Date();
          this.stats.processedCount++;
          this.stats.lastProcessedAt = new Date();
        } catch (error) {
          this.stats.handlers['delay.not-detected'].errorCount++;
          this.stats.errorCount++;
          throw error;
        }
      });

      this.started = true;
      this.stats.isRunning = true;
    } catch (error) {
      this.logger.error('Failed to connect to Kafka', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the event consumer
   */
  async stop(): Promise<void> {
    const isDetectedRunning = this.delayDetectedConsumer.isConsumerRunning();
    const isNotDetectedRunning = this.delayNotDetectedConsumer.isConsumerRunning();

    if (!this.started && !isDetectedRunning && !isNotDetectedRunning) {
      this.logger.warn('Consumer not running, nothing to stop', {
        serviceName: 'evaluation-coordinator',
      });
      return;
    }

    this.logger.info('Shutting down Kafka consumers', {
      serviceName: 'evaluation-coordinator',
    });

    try {
      // Disconnect both consumers
      await Promise.all([
        this.delayDetectedConsumer.disconnect(),
        this.delayNotDetectedConsumer.disconnect(),
      ]);

      this.started = false;
      this.stats.isRunning = false;

      this.logger.info('Successfully disconnected from Kafka', {
        serviceName: 'evaluation-coordinator',
      });
    } catch (error) {
      this.logger.error('Error during shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.started = false;
      this.stats.isRunning = false;
      // Don't throw - graceful shutdown should not fail
    }
  }

  /**
   * Get consumer statistics
   */
  getStats(): ConsumerStats {
    // Update isRunning from both kafka consumers
    const isDetectedRunning = this.delayDetectedConsumer.isConsumerRunning();
    const isNotDetectedRunning = this.delayNotDetectedConsumer.isConsumerRunning();
    this.stats.isRunning = isDetectedRunning || isNotDetectedRunning;

    // Get stats from both kafka consumers and merge
    const detectedStats = this.delayDetectedConsumer.getStats();
    const notDetectedStats = this.delayNotDetectedConsumer.getStats();

    return {
      ...this.stats,
      processedCount: this.stats.processedCount || (detectedStats.processedCount + notDetectedStats.processedCount),
      errorCount: this.stats.errorCount || (detectedStats.errorCount + notDetectedStats.errorCount),
      isRunning: this.stats.isRunning,
    };
  }

  /**
   * Check if consumer is running
   */
  isRunning(): boolean {
    // Use internal state combined with kafka consumer state
    // When started is false, return false regardless of kafka consumer state
    if (!this.started) {
      return false;
    }
    const isDetectedRunning = this.delayDetectedConsumer.isConsumerRunning();
    const isNotDetectedRunning = this.delayNotDetectedConsumer.isConsumerRunning();
    return isDetectedRunning || isNotDetectedRunning;
  }
}
