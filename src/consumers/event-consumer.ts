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
 */
export class EventConsumer {
  private kafkaConsumer: KafkaConsumer;
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

    // Create KafkaConsumer with config
    // AC-9: Pass logger to KafkaConsumer
    this.kafkaConsumer = new KafkaConsumer({
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
   */
  async start(): Promise<void> {
    this.logger.info('Connecting to Kafka', {
      serviceName: 'evaluation-coordinator',
    });

    try {
      // Connect to Kafka
      await this.kafkaConsumer.connect();

      this.logger.info('Successfully connected to Kafka', {
        serviceName: 'evaluation-coordinator',
      });

      // AC-1: Subscribe to delay.detected topic with handler
      this.logger.info('Subscribing to topic', { topic: 'delay.detected' });
      await this.kafkaConsumer.subscribe('delay.detected', async (message) => {
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

      // AC-2: Subscribe to delay.not-detected topic with handler
      this.logger.info('Subscribing to topic', { topic: 'delay.not-detected' });
      await this.kafkaConsumer.subscribe('delay.not-detected', async (message) => {
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

      // Start consuming from all subscribed topics
      this.logger.info('Starting Kafka consumer for all subscribed topics', {
        topics: this.kafkaConsumer.getSubscribedTopics(),
      });
      await this.kafkaConsumer.start();

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
    if (!this.started && !this.kafkaConsumer.isConsumerRunning()) {
      this.logger.warn('Consumer not running, nothing to stop', {
        serviceName: 'evaluation-coordinator',
      });
      return;
    }

    this.logger.info('Shutting down Kafka consumer', {
      serviceName: 'evaluation-coordinator',
    });

    try {
      await this.kafkaConsumer.disconnect();
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
    // Update isRunning from kafka consumer
    this.stats.isRunning = this.kafkaConsumer.isConsumerRunning();

    // Get stats from kafka consumer and merge
    const kafkaStats = this.kafkaConsumer.getStats();
    return {
      ...this.stats,
      processedCount: this.stats.processedCount || kafkaStats.processedCount,
      errorCount: this.stats.errorCount || kafkaStats.errorCount,
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
    return this.kafkaConsumer.isConsumerRunning();
  }
}
