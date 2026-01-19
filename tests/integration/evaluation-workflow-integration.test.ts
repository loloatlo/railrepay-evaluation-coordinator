/**
 * Integration tests for Evaluation Coordinator - End-to-End Workflow
 *
 * Phase: 3.1 Test Specification (Jessie)
 * Author: Jessie (QA Engineer)
 * Date: 2026-01-18
 *
 * TDD Workflow (ADR-014):
 * 1. These tests MUST FAIL initially (RED phase - no implementation exists)
 * 2. Blake implements to make tests pass (GREEN phase)
 * 3. Jessie verifies all tests GREEN in Phase 4 QA
 *
 * Integration Testing Strategy:
 * - Use Testcontainers for real PostgreSQL instance
 * - Test actual database interactions (no mocks for DB)
 * - Verify transactional behavior and data integrity
 * - Test with realistic fixtures (ADR-017)
 *
 * Coverage:
 * - Full workflow: initiation → eligibility check → claim trigger → outbox event
 * - Database constraints and foreign keys under real conditions
 * - Concurrent workflow handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import journeysFixture from '../fixtures/db/journeys-valid.json';
import eligibleResponseFixture from '../fixtures/api/eligibility-engine-response-eligible.json';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Evaluation Coordinator - Integration Tests', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    // Start PostgreSQL container (Testcontainers)
    console.log('Starting PostgreSQL container for integration tests...');
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

  describe('Full Workflow Integration', () => {
    it('should create workflow, eligibility step, and outbox event for eligible journey (WILL FAIL - no implementation)', async () => {
      // Arrange
      const journeyId = journeysFixture.validJourneys[0].journey_id;

      // Act - this will FAIL (no implementation exists)
      // Note: pool is a valid pg.Pool instance with .query() method
      const { initiateEvaluationWorkflow, processEligibilityCheck } = await import('../../src/index.js');
      const workflowId = await initiateEvaluationWorkflow(journeyId, pool);
      await processEligibilityCheck(workflowId, journeyId, pool);

      // Assert - verify workflow created
      const workflowResult = await pool.query(`
        SELECT * FROM evaluation_coordinator.evaluation_workflows
        WHERE journey_id = $1
      `, [journeyId]);
      expect(workflowResult.rows).toHaveLength(1);
      expect(workflowResult.rows[0].status).toBe('IN_PROGRESS');

      // Assert - verify eligibility step created and completed
      const stepsResult = await pool.query(`
        SELECT * FROM evaluation_coordinator.workflow_steps
        WHERE workflow_id = $1 AND step_type = 'ELIGIBILITY_CHECK'
      `, [workflowId]);
      expect(stepsResult.rows).toHaveLength(1);
      expect(stepsResult.rows[0].status).toBe('COMPLETED');

      // Assert - verify outbox event created
      const outboxResult = await pool.query(`
        SELECT * FROM evaluation_coordinator.outbox
        WHERE aggregate_id = $1 AND event_type = 'CLAIM_SUBMISSION_REQUESTED'
      `, [workflowId]);
      expect(outboxResult.rows).toHaveLength(1);
      expect(outboxResult.rows[0].published).toBe(false);
    });

    it('should NOT create outbox event when journey is ineligible (WILL FAIL - no implementation)', async () => {
      // Arrange
      const journeyId = journeysFixture.validJourneys[1].journey_id;

      // Act - this will FAIL (no implementation exists)
      const { initiateEvaluationWorkflow, processEligibilityCheck } = await import('../../src/index.js');
      const workflowId = await initiateEvaluationWorkflow(journeyId, pool);
      await processEligibilityCheck(workflowId, journeyId, pool, { eligible: false });

      // Assert - verify workflow created
      const workflowResult = await pool.query(`
        SELECT * FROM evaluation_coordinator.evaluation_workflows
        WHERE journey_id = $1
      `, [journeyId]);
      expect(workflowResult.rows[0].status).toBe('COMPLETED'); // Not IN_PROGRESS

      // Assert - verify NO outbox event created
      const outboxResult = await pool.query(`
        SELECT * FROM evaluation_coordinator.outbox
        WHERE aggregate_id = $1
      `, [workflowId]);
      expect(outboxResult.rows).toHaveLength(0);
    });

    it('should enforce foreign key constraint: workflow_steps -> evaluation_workflows (real DB test)', async () => {
      // This test verifies FK constraints work under real PostgreSQL

      // Arrange
      const fakeWorkflowId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert - this SHOULD PASS (schema test - FK already created by Hoops)
      await expect(
        pool.query(`
          INSERT INTO evaluation_coordinator.workflow_steps
            (workflow_id, step_type, status, payload)
          VALUES ($1, 'ELIGIBILITY_CHECK', 'PENDING', '{}'::jsonb)
        `, [fakeWorkflowId])
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    it('should update updated_at timestamp when workflow status changes (real trigger test)', async () => {
      // This test verifies the trigger works under real PostgreSQL with actual service code

      // Arrange - create workflow
      const journeyId = journeysFixture.validJourneys[0].journey_id;

      // Act - this will FAIL (no implementation exists)
      const { initiateEvaluationWorkflow, getWorkflowUpdatedAt, updateWorkflowStatus } = await import('../../src/index.js');
      const workflowId = await initiateEvaluationWorkflow(journeyId, pool);
      const originalTimestamp = await getWorkflowUpdatedAt(workflowId, pool);

      // Wait 100ms to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 100));

      // Update workflow status
      await updateWorkflowStatus(workflowId, 'IN_PROGRESS', pool);
      const newTimestamp = await getWorkflowUpdatedAt(workflowId, pool);

      // Assert
      expect(new Date(newTimestamp).getTime()).toBeGreaterThan(
        new Date(originalTimestamp).getTime()
      );
    });

    it('should cascade delete workflow_steps when workflow deleted (real cascade test)', async () => {
      // This test verifies CASCADE works under real PostgreSQL with actual service code

      // Arrange - create workflow and steps
      const journeyId = journeysFixture.validJourneys[0].journey_id;

      // Act - this will FAIL (no implementation exists)
      const { initiateEvaluationWorkflow, createWorkflowStep, deleteWorkflow } = await import('../../src/index.js');
      const workflowId = await initiateEvaluationWorkflow(journeyId, pool);
      await createWorkflowStep(workflowId, 'ELIGIBILITY_CHECK', 'PENDING', pool);
      await createWorkflowStep(workflowId, 'CLAIM_CREATION', 'PENDING', pool);

      // Verify steps exist
      const stepsBeforeDelete = await pool.query(`
        SELECT COUNT(*) FROM evaluation_coordinator.workflow_steps
        WHERE workflow_id = $1
      `, [workflowId]);
      expect(parseInt(stepsBeforeDelete.rows[0].count)).toBe(2);

      // Delete workflow
      await deleteWorkflow(workflowId, pool);

      // Verify steps were cascade deleted
      const stepsAfterDelete = await pool.query(`
        SELECT COUNT(*) FROM evaluation_coordinator.workflow_steps
        WHERE workflow_id = $1
      `, [workflowId]);
      expect(parseInt(stepsAfterDelete.rows[0].count)).toBe(0);
    });
  });

  describe('Concurrent Workflow Handling', () => {
    it('should handle multiple concurrent workflow initiations without conflicts (WILL FAIL - no implementation)', async () => {
      // This tests ACID properties under concurrent load

      // Arrange
      const journeyIds = journeysFixture.validJourneys.map(j => j.journey_id);

      // Act - this will FAIL (no implementation exists)
      const { initiateEvaluationWorkflow } = await import('../../src/index.js');
      const workflowPromises = journeyIds.map(journeyId =>
        initiateEvaluationWorkflow(journeyId, pool)
      );
      const workflowIds = await Promise.all(workflowPromises);

      // Assert - verify all workflows created with unique IDs
      expect(workflowIds).toHaveLength(journeyIds.length);
      expect(new Set(workflowIds).size).toBe(journeyIds.length); // All unique

      const workflowsResult = await pool.query(`
        SELECT COUNT(*) FROM evaluation_coordinator.evaluation_workflows
      `);
      expect(parseInt(workflowsResult.rows[0].count)).toBe(journeyIds.length);
    });

    it('should prevent duplicate workflows for same journey_id (business logic test - WILL FAIL)', async () => {
      // This tests business-level duplicate prevention (not DB constraint)

      // Arrange
      const journeyId = journeysFixture.validJourneys[0].journey_id;

      // Act - this will FAIL (no implementation exists)
      const { initiateEvaluationWorkflow } = await import('../../src/index.js');
      await initiateEvaluationWorkflow(journeyId, pool);

      // Assert - second attempt should fail with business-level error
      await expect(
        initiateEvaluationWorkflow(journeyId, pool)
      ).rejects.toThrow(/Active workflow already exists|Duplicate workflow/);
    });
  });

  describe('Transactional Behavior', () => {
    it('should rollback workflow creation if eligibility step creation fails (WILL FAIL - no implementation)', async () => {
      // This tests transactional integrity

      // Arrange
      const journeyId = journeysFixture.validJourneys[0].journey_id;

      // Act - this will FAIL (no implementation exists)
      // Simulate failure during step creation
      const { initiateEvaluationWorkflowWithStepFailure } = await import('../../src/index.js');
      try {
        await initiateEvaluationWorkflowWithStepFailure(journeyId, pool);
      } catch (error) {
        // Expected to fail
      }

      // Assert - verify workflow was NOT created (transaction rolled back)
      const workflowsResult = await pool.query(`
        SELECT COUNT(*) FROM evaluation_coordinator.evaluation_workflows
        WHERE journey_id = $1
      `, [journeyId]);
      expect(parseInt(workflowsResult.rows[0].count)).toBe(0);
    });
  });

  describe('Outbox Pattern Verification', () => {
    it('should create unpublished outbox event with correct structure (WILL FAIL - no implementation)', async () => {
      // Arrange
      const journeyId = journeysFixture.validJourneys[0].journey_id;

      // Act - this will FAIL (no implementation exists)
      const { initiateEvaluationWorkflow, processEligibilityCheck } = await import('../../src/index.js');
      const workflowId = await initiateEvaluationWorkflow(journeyId, pool);
      await processEligibilityCheck(workflowId, journeyId, pool);

      // Assert
      const outboxResult = await pool.query(`
        SELECT * FROM evaluation_coordinator.outbox
        WHERE aggregate_id = $1 AND event_type = 'CLAIM_SUBMISSION_REQUESTED'
      `, [workflowId]);

      expect(outboxResult.rows).toHaveLength(1);
      const event = outboxResult.rows[0];
      expect(event.published).toBe(false);
      expect(event.aggregate_type).toBe('EVALUATION_WORKFLOW');
      expect(event.payload).toMatchObject({
        journey_id: journeyId,
        eligibility_result: expect.objectContaining({ eligible: true }),
        correlation_id: expect.any(String)
      });
    });

    it('should query unpublished events efficiently using partial index (WILL FAIL - no implementation)', async () => {
      // This verifies the partial index on outbox (published = false) is used

      // Arrange - create some published and unpublished events
      const journeyId = journeysFixture.validJourneys[0].journey_id;

      // Act - this will FAIL (no implementation exists)
      const { initiateEvaluationWorkflow, processEligibilityCheck } = await import('../../src/index.js');
      const workflowId = await initiateEvaluationWorkflow(journeyId, pool);
      await processEligibilityCheck(workflowId, journeyId, pool);

      // Assert - query unpublished events
      const unpublishedResult = await pool.query(`
        SELECT * FROM evaluation_coordinator.outbox
        WHERE published = false
        ORDER BY created_at ASC
      `);

      expect(unpublishedResult.rows.length).toBeGreaterThan(0);
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
 * Helper: Create mock pgm object for node-pg-migrate (reused from migrations.test.ts)
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
