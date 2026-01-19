/**
 * HTTP Integration tests for Evaluation Coordinator
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
 * REMEDIATION NOTE:
 * These tests were originally in unit tests but use real HTTP requests via supertest.
 * They belong in integration tests per Testing Strategy 2.0.
 * Integration tests use Testcontainers for real database interactions.
 *
 * Integration Testing Strategy:
 * - Use Testcontainers for real PostgreSQL instance
 * - Test actual HTTP endpoints with supertest
 * - Verify database state after HTTP requests
 * - Test with realistic fixtures (ADR-017)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import journeysFixture from '../fixtures/db/journeys-valid.json';
// Import metrics-pusher to exercise REAL dependency (not mocked)
import '@railrepay/metrics-pusher';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Evaluation Coordinator - HTTP Integration Tests', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    // Start PostgreSQL container (Testcontainers)
    console.log('Starting PostgreSQL container for HTTP integration tests...');
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('test')
      .withUsername('test')
      .withPassword('test')
      .start();

    // Create connection pool
    pool = new Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });

    // Run migrations to set up schema
    await runMigrationUp(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    // Clean up data between tests (not schema)
    await pool.query('DELETE FROM evaluation_coordinator.outbox');
    await pool.query('DELETE FROM evaluation_coordinator.workflow_steps');
    await pool.query('DELETE FROM evaluation_coordinator.evaluation_workflows');
  });

  /**
   * AC-1: Evaluation Workflow Initiation (HTTP Tests)
   */
  describe('AC-1: Evaluation Workflow Initiation (HTTP)', () => {
    const validJourneyId = journeysFixture.validJourneys[0].journey_id;

    it('should return 202 Accepted with workflow_id when POST /evaluate/:journey_id', async () => {
      // Act - this will FAIL (no Express app exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;
      const response = await request(app).post(`/evaluate/${validJourneyId}`);

      // Assert
      expect(response.status).toBe(202);
      expect(response.body.workflow_id).toBeDefined();
      expect(response.body.workflow_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should return 400 Bad Request when journey_id is invalid UUID', async () => {
      // Arrange
      const invalidJourneyId = 'not-a-uuid';

      // Act - this will FAIL (no validation exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;
      const response = await request(app).post(`/evaluate/${invalidJourneyId}`);

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid journey_id');
    });

    it('should actually insert workflow into database when POST /evaluate/:journey_id', async () => {
      // Act - this will FAIL (no database integration exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;
      const response = await request(app).post(`/evaluate/${validJourneyId}`);

      // Assert - verify database state
      const workflowResult = await pool.query(`
        SELECT * FROM evaluation_coordinator.evaluation_workflows
        WHERE journey_id = $1
      `, [validJourneyId]);
      expect(workflowResult.rows).toHaveLength(1);
      expect(workflowResult.rows[0].status).toBe('INITIATED');
    });
  });

  /**
   * AC-5: Status Retrieval (HTTP Tests)
   */
  describe('AC-5: Status Retrieval (HTTP)', () => {
    const journeyId = journeysFixture.validJourneys[0].journey_id;

    beforeEach(async () => {
      // Seed test data for status retrieval tests
      await pool.query(`
        INSERT INTO evaluation_coordinator.evaluation_workflows
          (id, journey_id, correlation_id, status)
        VALUES ($1, $2, $3, $4)
      `, ['550e8400-e29b-41d4-a716-446655440000', journeyId, '123e4567-e89b-42d3-a456-426614174000', 'IN_PROGRESS']);

      await pool.query(`
        INSERT INTO evaluation_coordinator.workflow_steps
          (workflow_id, step_type, status, payload, started_at, completed_at)
        VALUES
          ($1, 'ELIGIBILITY_CHECK', 'COMPLETED', $2, NOW() - INTERVAL '5 minutes', NOW()),
          ($1, 'CLAIM_CREATION', 'PENDING', '{}', NOW(), NULL)
      `, ['550e8400-e29b-41d4-a716-446655440000', JSON.stringify({ eligible: true, compensation_amount_gbp: 25.50 })]);
    });

    it('should return workflow status with all step statuses when GET /status/:journey_id', async () => {
      // Act - this will FAIL (no status endpoint exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;
      const response = await request(app).get(`/status/${journeyId}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        workflow_id: '550e8400-e29b-41d4-a716-446655440000',
        journey_id: journeyId,
        status: 'IN_PROGRESS',
        steps: expect.arrayContaining([
          expect.objectContaining({ step_type: 'ELIGIBILITY_CHECK', status: 'COMPLETED' }),
          expect.objectContaining({ step_type: 'CLAIM_CREATION', status: 'PENDING' })
        ])
      });
    });

    it('should include timestamps for each step in status response', async () => {
      // Act - this will FAIL (no timestamp retrieval exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;
      const response = await request(app).get(`/status/${journeyId}`);

      // Assert
      expect(response.body.steps[0]).toMatchObject({
        started_at: expect.any(String),
        completed_at: expect.any(String)
      });
    });

    it('should include eligibility_result in status response when available', async () => {
      // Act - this will FAIL (no eligibility result inclusion exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;
      const response = await request(app).get(`/status/${journeyId}`);

      // Assert
      expect(response.body.eligibility_result).toMatchObject({
        eligible: true,
        compensation_amount_gbp: 25.50
      });
    });

    it('should return 404 when journey_id not found in workflows', async () => {
      // Arrange
      const nonExistentJourneyId = '00000000-0000-0000-0000-000000000000';

      // Act - this will FAIL (no 404 handling exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;
      const response = await request(app).get(`/status/${nonExistentJourneyId}`);

      // Assert
      expect(response.status).toBe(404);
      expect(response.body.error).toContain('Workflow not found');
    });
  });

  /**
   * AC-6: Observability Requirements (HTTP Tests)
   */
  describe('AC-6: Observability Requirements (HTTP)', () => {
    const validJourneyId = journeysFixture.validJourneys[0].journey_id;

    it('should include correlation_id in response headers for tracing', async () => {
      // Act - this will FAIL (no correlation_id header exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;
      const response = await request(app).post(`/evaluate/${validJourneyId}`);

      // Assert
      expect(response.headers['x-correlation-id']).toBeDefined();
      expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should propagate correlation_id from request header to response', async () => {
      // Arrange
      const correlationId = '123e4567-e89b-42d3-a456-426614174000';

      // Act - this will FAIL (no correlation_id propagation exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;
      const response = await request(app)
        .post(`/evaluate/${validJourneyId}`)
        .set('x-correlation-id', correlationId);

      // Assert
      expect(response.headers['x-correlation-id']).toBe(correlationId);
    });

    it('should increment HTTP request counter metric for each request', async () => {
      // This verifies metrics-pusher integration at HTTP layer
      // The actual metric increment will be tested via observability tests

      // Act - this will FAIL (no metrics middleware exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;
      const response = await request(app).post(`/evaluate/${validJourneyId}`);

      // Assert - verify endpoint was called successfully
      expect(response.status).toBe(202);
      // Metrics verification is done in observability tests
    });
  });

  /**
   * AC-7: Error Handling (HTTP Tests)
   */
  describe('AC-7: Error Handling (HTTP)', () => {
    it('should return 500 Internal Server Error when database unavailable', async () => {
      // Arrange - create pool with invalid connection
      const badPool = new Pool({
        host: 'invalid-host',
        port: 1234,
        database: 'invalid',
        user: 'invalid',
        password: 'invalid',
        connectionTimeoutMillis: 1000
      });

      // Act - this will FAIL (no error handling exists)
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool: badPool });
      const request = (await import('supertest')).default;
      const response = await request(app).post(`/evaluate/${journeysFixture.validJourneys[0].journey_id}`);

      // Assert
      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();

      // Cleanup
      await badPool.end();
    });

    it('should return 422 Unprocessable Entity when journey already has active workflow', async () => {
      // Arrange - create workflow first
      const journeyId = journeysFixture.validJourneys[0].journey_id;
      const { createApp } = await import('../../src/index.js');
      const app = createApp({ pool });
      const request = (await import('supertest')).default;

      await request(app).post(`/evaluate/${journeyId}`);

      // Act - this will FAIL (no duplicate prevention exists)
      const response = await request(app).post(`/evaluate/${journeyId}`);

      // Assert
      expect(response.status).toBe(422);
      expect(response.body.error).toMatch(/Active workflow already exists|Duplicate workflow/);
    });
  });
});

/**
 * Helper: Run UP migration manually (reused from migrations.test.ts)
 */
async function runMigrationUp(pool: pg.Pool): Promise<void> {
  const migrationFile = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../migrations/1737187200000_initial-schema.js'
  );

  const migration = await import(migrationFile);
  const pgm = createPgmMock(pool);
  await migration.up(pgm);
  await pgm._execute();
}

/**
 * Helper: Create mock pgm object for node-pg-migrate
 */
function createPgmMock(pool: pg.Pool): any {
  const operations: Array<() => Promise<void>> = [];

  const pgm = {
    createSchema: (schemaName: string, options: any) => {
      operations.push(async () => {
        const ifNotExists = options?.ifNotExists ? 'IF NOT EXISTS' : '';
        await pool.query(`CREATE SCHEMA ${ifNotExists} ${schemaName}`);
      });
    },

    createExtension: (extName: string, options: any) => {
      operations.push(async () => {
        const ifNotExists = options?.ifNotExists ? 'IF NOT EXISTS' : '';
        await pool.query(`CREATE EXTENSION ${ifNotExists} "${extName}"`);
      });
    },

    createTable: (tableName: any, columns: any) => {
      operations.push(async () => {
        const schema = tableName.schema;
        const table = tableName.name;
        const columnDefs = Object.entries(columns).map(([colName, colDef]: [string, any]) => {
          let def = `${colName} ${colDef.type}`;
          if (colDef.primaryKey) def += ' PRIMARY KEY';
          if (colDef.notNull) def += ' NOT NULL';
          if (colDef.default !== undefined) {
            let defaultVal = colDef.default;
            if (typeof defaultVal === 'boolean') {
              defaultVal = defaultVal.toString();
            }
            def += ` DEFAULT ${defaultVal}`;
          }
          if (colDef.check) def += ` CHECK (${colDef.check})`;
          if (colDef.references) {
            const refSchema = colDef.references.schema;
            const refTable = colDef.references.name;
            def += ` REFERENCES ${refSchema}.${refTable}(id)`;
            if (colDef.onDelete) def += ` ON DELETE ${colDef.onDelete}`;
          }
          return def;
        });
        await pool.query(`CREATE TABLE ${schema}.${table} (${columnDefs.join(', ')})`);
      });
    },

    createIndex: (tableName: any, columns: any, options: any = {}) => {
      operations.push(async () => {
        const schema = tableName.schema;
        const table = tableName.name;
        const indexName = options.name || `idx_${table}_${Array.isArray(columns) ? columns.join('_') : columns}`;

        let columnExpr = Array.isArray(columns) ? columns.join(', ') : columns;
        if (typeof columns === 'object' && !Array.isArray(columns)) {
          columnExpr = `${columns.name} ${columns.sort || ''}`;
        }

        const whereClause = options.where ? ` WHERE ${options.where}` : '';
        await pool.query(`CREATE INDEX ${indexName} ON ${schema}.${table} (${columnExpr})${whereClause}`);
      });
    },

    createFunction: (funcName: any, params: any, options: any, body: string) => {
      operations.push(async () => {
        const schema = funcName.schema;
        const name = funcName.name;
        const returns = options.returns;
        const language = options.language;
        await pool.query(`
          CREATE OR REPLACE FUNCTION ${schema}.${name}()
          RETURNS ${returns}
          LANGUAGE ${language}
          AS $$
          ${body}
          $$;
        `);
      });
    },

    createTrigger: (tableName: any, triggerName: string, options: any) => {
      operations.push(async () => {
        const schema = tableName.schema;
        const table = tableName.name;
        const when = options.when;
        const operation = options.operation;
        const funcSchema = options.function.schema;
        const funcName = options.function.name;
        const level = options.level;
        await pool.query(`
          CREATE TRIGGER ${triggerName}
          ${when} ${operation} ON ${schema}.${table}
          FOR EACH ${level}
          EXECUTE FUNCTION ${funcSchema}.${funcName}();
        `);
      });
    },

    dropTable: (tableName: any, options: any) => {
      operations.push(async () => {
        const schema = tableName.schema;
        const table = tableName.name;
        const ifExists = options?.ifExists ? 'IF EXISTS' : '';
        const cascade = options?.cascade ? 'CASCADE' : '';
        await pool.query(`DROP TABLE ${ifExists} ${schema}.${table} ${cascade}`);
      });
    },

    dropFunction: (funcName: any, params: any, options: any) => {
      operations.push(async () => {
        const schema = funcName.schema;
        const name = funcName.name;
        const ifExists = options?.ifExists ? 'IF EXISTS' : '';
        const cascade = options?.cascade ? 'CASCADE' : '';
        await pool.query(`DROP FUNCTION ${ifExists} ${schema}.${name}() ${cascade}`);
      });
    },

    dropSchema: (schemaName: string, options: any) => {
      operations.push(async () => {
        const ifExists = options?.ifExists ? 'IF EXISTS' : '';
        const cascade = options?.cascade ? 'CASCADE' : '';
        await pool.query(`DROP SCHEMA ${ifExists} ${schemaName} ${cascade}`);
      });
    },

    func: (name: string) => name,
  };

  (pgm as any)._execute = async () => {
    for (const operation of operations) {
      await operation();
    }
  };

  return pgm;
}
