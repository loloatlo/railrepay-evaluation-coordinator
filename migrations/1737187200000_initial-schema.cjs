/**
 * Initial schema migration for evaluation-coordinator service
 * Creates evaluation_coordinator schema with evaluation_workflows, workflow_steps, and outbox tables
 *
 * RFC: RFC-005-evaluation-coordinator-schema.md
 * Author: Hoops (Data Architect)
 * Date: 2026-01-18
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // Step 1: Create schema (REQUIRED per ADR-001)
  pgm.createSchema('evaluation_coordinator', { ifNotExists: true });

  // Step 2: Enable UUID extension (for gen_random_uuid())
  pgm.createExtension('uuid-ossp', { ifNotExists: true });

  // Table 1: evaluation_workflows
  // Purpose: Track high-level evaluation workflow state for each journey evaluation attempt
  pgm.createTable(
    { schema: 'evaluation_coordinator', name: 'evaluation_workflows' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      journey_id: {
        type: 'uuid',
        notNull: true,
        comment: 'Reference to journey in journey-matcher schema (validated via API, not FK)',
      },
      correlation_id: {
        type: 'uuid',
        notNull: true,
        comment: 'Request tracing ID for distributed tracing',
      },
      status: {
        type: 'varchar(50)',
        notNull: true,
        check: "status IN ('INITIATED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED')",
        comment: 'Workflow state: INITIATED, IN_PROGRESS, COMPLETED, PARTIAL_SUCCESS, FAILED',
      },
      eligibility_result: {
        type: 'jsonb',
        comment: 'Cached eligibility response from eligibility-engine',
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      completed_at: {
        type: 'timestamptz',
        comment: 'Workflow completion time (null if still in progress or failed)',
      },
    }
  );

  // Create indexes for evaluation_workflows
  // Index 1: Query workflows by journey_id (e.g., "Has this journey been evaluated?")
  pgm.createIndex(
    { schema: 'evaluation_coordinator', name: 'evaluation_workflows' },
    'journey_id',
    { name: 'idx_workflows_journey_id' }
  );

  // Index 2: Query workflows by correlation_id (distributed tracing)
  pgm.createIndex(
    { schema: 'evaluation_coordinator', name: 'evaluation_workflows' },
    'correlation_id',
    { name: 'idx_workflows_correlation_id' }
  );

  // Index 3: Query workflows by status (e.g., "Show all in-progress workflows")
  pgm.createIndex(
    { schema: 'evaluation_coordinator', name: 'evaluation_workflows' },
    'status',
    { name: 'idx_workflows_status' }
  );

  // Index 4: Query recent workflows (monitoring dashboard, DESC for LIMIT queries)
  pgm.createIndex(
    { schema: 'evaluation_coordinator', name: 'evaluation_workflows' },
    { name: 'created_at', sort: 'DESC' },
    { name: 'idx_workflows_created_at' }
  );

  // Table 2: workflow_steps
  // Purpose: Track individual step execution within a workflow
  pgm.createTable(
    { schema: 'evaluation_coordinator', name: 'workflow_steps' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      workflow_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'evaluation_coordinator', name: 'evaluation_workflows' },
        onDelete: 'CASCADE',
        comment: 'Foreign key to evaluation_workflows (within same schema)',
      },
      step_type: {
        type: 'varchar(50)',
        notNull: true,
        comment: 'Type of step: ELIGIBILITY_CHECK, CLAIM_CREATION, etc.',
      },
      status: {
        type: 'varchar(50)',
        notNull: true,
        check: "status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'TIMEOUT')",
        comment: 'Step execution state: PENDING, IN_PROGRESS, COMPLETED, FAILED, TIMEOUT',
      },
      payload: {
        type: 'jsonb',
        notNull: true,
        comment: 'Step-specific data and results (flexible schema)',
      },
      error_details: {
        type: 'jsonb',
        comment: 'Error information if status = FAILED or TIMEOUT',
      },
      started_at: {
        type: 'timestamptz',
        comment: 'When step execution began (null if status = PENDING)',
      },
      completed_at: {
        type: 'timestamptz',
        comment: 'When step finished (null if PENDING or IN_PROGRESS)',
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    }
  );

  // Create indexes for workflow_steps
  // Index 1: Query all steps for a workflow (e.g., "Show workflow execution history")
  pgm.createIndex(
    { schema: 'evaluation_coordinator', name: 'workflow_steps' },
    'workflow_id',
    { name: 'idx_steps_workflow_id' }
  );

  // Index 2: Query steps by type and status (e.g., "Retry all failed eligibility checks")
  pgm.createIndex(
    { schema: 'evaluation_coordinator', name: 'workflow_steps' },
    ['step_type', 'status'],
    { name: 'idx_steps_type_status' }
  );

  // Index 3: Query steps started in time range (monitoring SLA compliance)
  // Partial index: only rows where started_at IS NOT NULL
  pgm.createIndex(
    { schema: 'evaluation_coordinator', name: 'workflow_steps' },
    { name: 'started_at', sort: 'DESC' },
    {
      name: 'idx_steps_started_at',
      where: 'started_at IS NOT NULL',
    }
  );

  // Table 3: outbox (transactional outbox pattern per ADR-007)
  // Purpose: Reliable event publishing
  pgm.createTable(
    { schema: 'evaluation_coordinator', name: 'outbox' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      aggregate_id: {
        type: 'uuid',
        notNull: true,
        comment: 'Workflow ID (references evaluation_workflows.id)',
      },
      aggregate_type: {
        type: 'varchar(100)',
        notNull: true,
        comment: "Always 'evaluation_workflow' for this service",
      },
      event_type: {
        type: 'varchar(100)',
        notNull: true,
        comment: 'Type of event: CLAIM_SUBMISSION_REQUESTED, WORKFLOW_FAILED, etc.',
      },
      payload: {
        type: 'jsonb',
        notNull: true,
        comment: 'Event data (workflow details, eligibility result, journey_id, etc.)',
      },
      correlation_id: {
        type: 'uuid',
        notNull: true,
        comment: 'Request tracing ID (same as workflow correlation_id)',
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      published_at: {
        type: 'timestamptz',
        comment: 'When outbox-relay published event to Kafka',
      },
      published: {
        type: 'boolean',
        notNull: true,
        default: false,
        comment: 'Publication flag (false = pending, true = published)',
      },
    }
  );

  // Create indexes for outbox
  // Index 1: Partial index for unpublished events (outbox-relay polls this)
  pgm.createIndex(
    { schema: 'evaluation_coordinator', name: 'outbox' },
    'created_at',
    {
      name: 'idx_outbox_unpublished',
      where: 'published = false',
    }
  );

  // Index 2: Query all events for a workflow (audit trail)
  pgm.createIndex(
    { schema: 'evaluation_coordinator', name: 'outbox' },
    'aggregate_id',
    { name: 'idx_outbox_aggregate_id' }
  );

  // Create trigger function to auto-update updated_at column
  pgm.createFunction(
    { schema: 'evaluation_coordinator', name: 'update_updated_at_column' },
    [],
    {
      returns: 'TRIGGER',
      language: 'plpgsql',
      replace: true,
    },
    `
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    `
  );

  // Add trigger to evaluation_workflows table
  pgm.createTrigger(
    { schema: 'evaluation_coordinator', name: 'evaluation_workflows' },
    'update_evaluation_workflows_updated_at',
    {
      when: 'BEFORE',
      operation: 'UPDATE',
      function: { schema: 'evaluation_coordinator', name: 'update_updated_at_column' },
      level: 'ROW',
    }
  );
};

exports.down = async (pgm) => {
  // Drop tables in reverse order (workflow_steps has FK to evaluation_workflows)
  pgm.dropTable(
    { schema: 'evaluation_coordinator', name: 'outbox' },
    { ifExists: true, cascade: true }
  );

  pgm.dropTable(
    { schema: 'evaluation_coordinator', name: 'workflow_steps' },
    { ifExists: true, cascade: true }
  );

  pgm.dropTable(
    { schema: 'evaluation_coordinator', name: 'evaluation_workflows' },
    { ifExists: true, cascade: true }
  );

  // Drop trigger function
  pgm.dropFunction(
    { schema: 'evaluation_coordinator', name: 'update_updated_at_column' },
    [],
    { ifExists: true, cascade: true }
  );

  // Drop schema
  pgm.dropSchema('evaluation_coordinator', { ifExists: true, cascade: true });
};
