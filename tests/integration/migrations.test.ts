/**
 * Integration tests for evaluation_coordinator schema migrations
 *
 * RFC: RFC-005-evaluation-coordinator-schema.md
 * Author: Hoops (Data Architect)
 * Date: 2026-01-18
 *
 * TDD Workflow (ADR-014):
 * 1. These tests MUST FAIL initially (RED phase)
 * 2. Implement migration to make tests pass (GREEN phase)
 * 3. Verify all tests GREEN before handoff to Jessie
 *
 * Testing Strategy:
 * - Use Testcontainers for real PostgreSQL instance
 * - Test schema creation, table structures, indexes, constraints
 * - Test rollback capability (DOWN migration)
 * - Verify data integrity constraints (CHECK, NOT NULL, FK)
 *
 * Phase 2 Quality Gate:
 * - All tests must pass (GREEN) before Jessie can begin Phase 3.1
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('evaluation_coordinator schema migrations', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let migrationPath: string;

  beforeAll(async () => {
    // Start PostgreSQL container (Testcontainers)
    console.log('Starting PostgreSQL container...');
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

    // Resolve migration file path
    migrationPath = resolve(__dirname, '../../migrations');
    console.log(`Migration path: ${migrationPath}`);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  describe('UP migration: create schema and tables', () => {
    beforeAll(async () => {
      // Run migration once before all tests in this block
      await runMigrationUp(pool);
    });

    it('should create evaluation_coordinator schema', async () => {
      // Verify schema exists
      const result = await pool.query(`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name = 'evaluation_coordinator';
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].schema_name).toBe('evaluation_coordinator');
    });

    it('should create evaluation_workflows table with correct columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'evaluation_coordinator'
        AND table_name = 'evaluation_workflows'
        ORDER BY ordinal_position;
      `);

      const columns = result.rows.map((r) => r.column_name);

      // Verify all required columns exist
      expect(columns).toEqual([
        'id',
        'journey_id',
        'correlation_id',
        'status',
        'eligibility_result',
        'created_at',
        'updated_at',
        'completed_at',
      ]);

      // Verify NOT NULL constraints
      const journeyIdColumn = result.rows.find((r) => r.column_name === 'journey_id');
      expect(journeyIdColumn?.is_nullable).toBe('NO');

      const statusColumn = result.rows.find((r) => r.column_name === 'status');
      expect(statusColumn?.is_nullable).toBe('NO');

      // Verify nullable columns
      const completedAtColumn = result.rows.find((r) => r.column_name === 'completed_at');
      expect(completedAtColumn?.is_nullable).toBe('YES');

      const eligibilityResultColumn = result.rows.find(
        (r) => r.column_name === 'eligibility_result'
      );
      expect(eligibilityResultColumn?.is_nullable).toBe('YES');
      expect(eligibilityResultColumn?.data_type).toBe('jsonb');

      // Verify default values
      const idColumn = result.rows.find((r) => r.column_name === 'id');
      expect(idColumn?.column_default).toContain('gen_random_uuid');

      const createdAtColumn = result.rows.find((r) => r.column_name === 'created_at');
      expect(createdAtColumn?.column_default).toContain('now()');
    });

    it('should enforce CHECK constraint on evaluation_workflows.status', async () => {
      // Valid status values
      await expect(
        pool.query(`
          INSERT INTO evaluation_coordinator.evaluation_workflows
            (journey_id, correlation_id, status)
          VALUES
            (gen_random_uuid(), gen_random_uuid(), 'INITIATED');
        `)
      ).resolves.toBeDefined();

      // Invalid status value should fail
      await expect(
        pool.query(`
          INSERT INTO evaluation_coordinator.evaluation_workflows
            (journey_id, correlation_id, status)
          VALUES
            (gen_random_uuid(), gen_random_uuid(), 'INVALID_STATUS');
        `)
      ).rejects.toThrow(/violates check constraint/);
    });

    it('should create workflow_steps table with correct columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'evaluation_coordinator'
        AND table_name = 'workflow_steps'
        ORDER BY ordinal_position;
      `);

      const columns = result.rows.map((r) => r.column_name);

      expect(columns).toEqual([
        'id',
        'workflow_id',
        'step_type',
        'status',
        'payload',
        'error_details',
        'started_at',
        'completed_at',
        'created_at',
      ]);

      // Verify NOT NULL constraints
      const workflowIdColumn = result.rows.find((r) => r.column_name === 'workflow_id');
      expect(workflowIdColumn?.is_nullable).toBe('NO');

      const payloadColumn = result.rows.find((r) => r.column_name === 'payload');
      expect(payloadColumn?.is_nullable).toBe('NO');
      expect(payloadColumn?.data_type).toBe('jsonb');

      // Verify nullable columns
      const errorDetailsColumn = result.rows.find((r) => r.column_name === 'error_details');
      expect(errorDetailsColumn?.is_nullable).toBe('YES');
      expect(errorDetailsColumn?.data_type).toBe('jsonb');

      const startedAtColumn = result.rows.find((r) => r.column_name === 'started_at');
      expect(startedAtColumn?.is_nullable).toBe('YES');
    });

    it('should enforce CHECK constraint on workflow_steps.status', async () => {
      // First create a workflow to reference
      const workflowResult = await pool.query(`
        INSERT INTO evaluation_coordinator.evaluation_workflows
          (journey_id, correlation_id, status)
        VALUES
          (gen_random_uuid(), gen_random_uuid(), 'INITIATED')
        RETURNING id;
      `);
      const workflowId = workflowResult.rows[0].id;

      // Valid status value
      await expect(
        pool.query(`
          INSERT INTO evaluation_coordinator.workflow_steps
            (workflow_id, step_type, status, payload)
          VALUES
            ($1, 'ELIGIBILITY_CHECK', 'PENDING', '{"test": "data"}'::jsonb);
        `, [workflowId])
      ).resolves.toBeDefined();

      // Invalid status value should fail
      await expect(
        pool.query(`
          INSERT INTO evaluation_coordinator.workflow_steps
            (workflow_id, step_type, status, payload)
          VALUES
            ($1, 'ELIGIBILITY_CHECK', 'INVALID_STATUS', '{"test": "data"}'::jsonb);
        `, [workflowId])
      ).rejects.toThrow(/violates check constraint/);
    });

    it('should enforce foreign key constraint workflow_steps -> evaluation_workflows', async () => {
      // Valid FK: workflow exists
      const workflowResult = await pool.query(`
        INSERT INTO evaluation_coordinator.evaluation_workflows
          (journey_id, correlation_id, status)
        VALUES
          (gen_random_uuid(), gen_random_uuid(), 'INITIATED')
        RETURNING id;
      `);
      const workflowId = workflowResult.rows[0].id;

      await expect(
        pool.query(`
          INSERT INTO evaluation_coordinator.workflow_steps
            (workflow_id, step_type, status, payload)
          VALUES
            ($1, 'ELIGIBILITY_CHECK', 'PENDING', '{}'::jsonb);
        `, [workflowId])
      ).resolves.toBeDefined();

      // Invalid FK: workflow doesn't exist
      const fakeWorkflowId = '00000000-0000-0000-0000-000000000000';
      await expect(
        pool.query(`
          INSERT INTO evaluation_coordinator.workflow_steps
            (workflow_id, step_type, status, payload)
          VALUES
            ($1, 'ELIGIBILITY_CHECK', 'PENDING', '{}'::jsonb);
        `, [fakeWorkflowId])
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    it('should cascade delete workflow_steps when workflow is deleted', async () => {
      // Create workflow and steps
      const workflowResult = await pool.query(`
        INSERT INTO evaluation_coordinator.evaluation_workflows
          (journey_id, correlation_id, status)
        VALUES
          (gen_random_uuid(), gen_random_uuid(), 'INITIATED')
        RETURNING id;
      `);
      const workflowId = workflowResult.rows[0].id;

      await pool.query(`
        INSERT INTO evaluation_coordinator.workflow_steps
          (workflow_id, step_type, status, payload)
        VALUES
          ($1, 'ELIGIBILITY_CHECK', 'PENDING', '{}'::jsonb),
          ($1, 'CLAIM_CREATION', 'PENDING', '{}'::jsonb);
      `, [workflowId]);

      // Verify steps exist
      const stepsBeforeDelete = await pool.query(`
        SELECT COUNT(*) FROM evaluation_coordinator.workflow_steps
        WHERE workflow_id = $1;
      `, [workflowId]);
      expect(parseInt(stepsBeforeDelete.rows[0].count)).toBe(2);

      // Delete workflow
      await pool.query(`
        DELETE FROM evaluation_coordinator.evaluation_workflows
        WHERE id = $1;
      `, [workflowId]);

      // Verify steps were cascade deleted
      const stepsAfterDelete = await pool.query(`
        SELECT COUNT(*) FROM evaluation_coordinator.workflow_steps
        WHERE workflow_id = $1;
      `, [workflowId]);
      expect(parseInt(stepsAfterDelete.rows[0].count)).toBe(0);
    });

    it('should create outbox table with correct columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'evaluation_coordinator'
        AND table_name = 'outbox'
        ORDER BY ordinal_position;
      `);

      const columns = result.rows.map((r) => r.column_name);

      expect(columns).toEqual([
        'id',
        'aggregate_id',
        'aggregate_type',
        'event_type',
        'payload',
        'correlation_id',
        'created_at',
        'published_at',
        'published',
      ]);

      // Verify NOT NULL constraints
      const aggregateIdColumn = result.rows.find((r) => r.column_name === 'aggregate_id');
      expect(aggregateIdColumn?.is_nullable).toBe('NO');

      const payloadColumn = result.rows.find((r) => r.column_name === 'payload');
      expect(payloadColumn?.is_nullable).toBe('NO');
      expect(payloadColumn?.data_type).toBe('jsonb');

      const publishedColumn = result.rows.find((r) => r.column_name === 'published');
      expect(publishedColumn?.is_nullable).toBe('NO');
      // PostgreSQL represents boolean default as 'false' or 'false::boolean'
      expect(publishedColumn?.column_default).toBeDefined();
      expect(publishedColumn?.column_default?.toLowerCase()).toContain('false');
    });

    it('should create all required indexes', async () => {
      const result = await pool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'evaluation_coordinator'
        ORDER BY indexname;
      `);

      const indexNames = result.rows.map((r) => r.indexname);

      // evaluation_workflows indexes
      expect(indexNames).toContain('idx_workflows_journey_id');
      expect(indexNames).toContain('idx_workflows_correlation_id');
      expect(indexNames).toContain('idx_workflows_status');
      expect(indexNames).toContain('idx_workflows_created_at');

      // workflow_steps indexes
      expect(indexNames).toContain('idx_steps_workflow_id');
      expect(indexNames).toContain('idx_steps_type_status');
      expect(indexNames).toContain('idx_steps_started_at');

      // outbox indexes
      expect(indexNames).toContain('idx_outbox_unpublished');
      expect(indexNames).toContain('idx_outbox_aggregate_id');

      // Verify partial index on outbox (unpublished only)
      const unpublishedIndex = result.rows.find(
        (r) => r.indexname === 'idx_outbox_unpublished'
      );
      expect(unpublishedIndex?.indexdef).toContain('WHERE');
      expect(unpublishedIndex?.indexdef).toContain('published = false');

      // Verify partial index on workflow_steps (started_at IS NOT NULL)
      const startedAtIndex = result.rows.find(
        (r) => r.indexname === 'idx_steps_started_at'
      );
      expect(startedAtIndex?.indexdef).toContain('WHERE');
      expect(startedAtIndex?.indexdef).toContain('started_at IS NOT NULL');
    });

    it('should create updated_at trigger function and apply to evaluation_workflows', async () => {
      // Verify function exists
      const functionResult = await pool.query(`
        SELECT routine_name
        FROM information_schema.routines
        WHERE routine_schema = 'evaluation_coordinator'
        AND routine_name = 'update_updated_at_column';
      `);
      expect(functionResult.rows).toHaveLength(1);

      // Verify trigger exists
      const triggerResult = await pool.query(`
        SELECT trigger_name
        FROM information_schema.triggers
        WHERE event_object_schema = 'evaluation_coordinator'
        AND event_object_table = 'evaluation_workflows'
        AND trigger_name = 'update_evaluation_workflows_updated_at';
      `);
      expect(triggerResult.rows).toHaveLength(1);

      // Test trigger behavior
      const workflowResult = await pool.query(`
        INSERT INTO evaluation_coordinator.evaluation_workflows
          (journey_id, correlation_id, status)
        VALUES
          (gen_random_uuid(), gen_random_uuid(), 'INITIATED')
        RETURNING id, created_at, updated_at;
      `);
      const workflowId = workflowResult.rows[0].id;
      const originalUpdatedAt = workflowResult.rows[0].updated_at;

      // Wait 100ms to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update workflow status
      const updateResult = await pool.query(`
        UPDATE evaluation_coordinator.evaluation_workflows
        SET status = 'IN_PROGRESS'
        WHERE id = $1
        RETURNING updated_at;
      `, [workflowId]);
      const newUpdatedAt = updateResult.rows[0].updated_at;

      // Verify updated_at was automatically updated
      expect(new Date(newUpdatedAt).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime()
      );
    });
  });

  describe('DOWN migration: rollback schema and tables', () => {
    it('should drop all tables and schema on rollback', async () => {
      // Run DOWN migration
      await runMigrationDown(pool);

      // Verify schema no longer exists
      const schemaResult = await pool.query(`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name = 'evaluation_coordinator';
      `);
      expect(schemaResult.rows).toHaveLength(0);

      // Verify tables no longer exist
      const tablesResult = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'evaluation_coordinator';
      `);
      expect(tablesResult.rows).toHaveLength(0);

      // Verify function no longer exists
      const functionResult = await pool.query(`
        SELECT routine_name
        FROM information_schema.routines
        WHERE routine_schema = 'evaluation_coordinator';
      `);
      expect(functionResult.rows).toHaveLength(0);
    });
  });
});

/**
 * Helper: Run UP migration manually
 */
async function runMigrationUp(pool: pg.Pool): Promise<void> {
  // Import and execute migration file
  const migrationFile = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../migrations/1737187200000_initial-schema.js'
  );

  // Dynamic import (ES modules)
  const migration = await import(migrationFile);

  // Create pgm object with required methods
  const pgm = createPgmMock(pool);

  // Execute UP migration (queues operations)
  await migration.up(pgm);

  // Execute all queued operations
  await pgm._execute();
}

/**
 * Helper: Run DOWN migration manually
 */
async function runMigrationDown(pool: pg.Pool): Promise<void> {
  const migrationFile = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../migrations/1737187200000_initial-schema.js'
  );

  const migration = await import(migrationFile);
  const pgm = createPgmMock(pool);

  // Execute DOWN migration (queues operations)
  await migration.down(pgm);

  // Execute all queued operations
  await pgm._execute();
}

/**
 * Helper: Create mock pgm object for node-pg-migrate
 * Implements subset of node-pg-migrate API needed for this migration
 *
 * IMPORTANT: node-pg-migrate uses a synchronous queuing API, but executes operations
 * asynchronously. This mock collects all operations and executes them in sequence.
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
          // Handle default values - convert JS boolean to SQL
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

    func: (name: string) => name, // Return function name as-is
  };

  // Add method to execute all queued operations
  (pgm as any)._execute = async () => {
    for (const operation of operations) {
      await operation();
    }
  };

  return pgm;
}
