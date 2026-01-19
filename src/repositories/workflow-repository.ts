/**
 * Workflow Repository - Database operations for evaluation workflows
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../lib/logger.js';

export interface EvaluationWorkflow {
  id: string;
  journey_id: string;
  correlation_id: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowStep {
  id: string;
  workflow_id: string;
  step_type: string;
  status: string;
  payload?: any;
  error_details?: any;
  started_at: Date;
  completed_at?: Date;
}

export interface OutboxEvent {
  id: string;
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  payload: any;
  correlation_id: string;
  published: boolean;
  created_at: Date;
}

export class WorkflowRepository {
  constructor(private db: any) {}

  async createWorkflow(journeyId: string, correlationId: string): Promise<EvaluationWorkflow> {
    const id = uuidv4();

    // Check for active workflow ATOMICALLY within transaction
    // Include PARTIAL_SUCCESS to prevent duplicate workflows when eligibility check fails
    const checkQuery = `
      SELECT id, status FROM evaluation_coordinator.evaluation_workflows
      WHERE journey_id = $1 AND status IN ('INITIATED', 'IN_PROGRESS', 'PARTIAL_SUCCESS')
      LIMIT 1
    `;

    const existingWorkflow = await this.db.query(checkQuery, [journeyId]);

    // Verify query result exists before accessing .rows
    if (existingWorkflow && existingWorkflow.rows && existingWorkflow.rows.length > 0) {
      const error: any = new Error(`Active workflow already exists for journey ${journeyId}`);
      error.status = 422;
      throw error;
    }

    const insertQuery = `
      INSERT INTO evaluation_coordinator.evaluation_workflows
        (id, journey_id, correlation_id, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING *
    `;

    logger.info('Creating evaluation workflow', {
      correlation_id: correlationId,
      journey_id: journeyId
    });

    const result = await this.db.query(insertQuery, [id, journeyId, correlationId, 'INITIATED']);

    // Verify query result exists before accessing .rows
    if (!result || !result.rows) {
      throw new Error('Failed to create workflow: invalid result from database');
    }

    if (result.rows.length === 0) {
      throw new Error('Failed to create workflow: no row returned from INSERT');
    }

    return result.rows[0];
  }

  async updateWorkflowStatus(workflowId: string, status: string, correlationId: string): Promise<void> {
    const query = `
      UPDATE evaluation_coordinator.evaluation_workflows
      SET status = $1, updated_at = NOW()
      WHERE id = $2
    `;
    
    logger.info('Updating workflow status', { 
      correlation_id: correlationId, 
      workflow_id: workflowId, 
      status 
    });

    await this.db.query(query, [status, workflowId]);
  }

  async createWorkflowStep(
    workflowId: string,
    stepType: string,
    correlationId: string,
    status: string = 'PENDING'
  ): Promise<WorkflowStep> {
    const id = uuidv4();
    const query = `
      INSERT INTO evaluation_coordinator.workflow_steps
        (id, workflow_id, step_type, status, payload, started_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `;

    logger.info('Creating workflow step', {
      correlation_id: correlationId,
      workflow_id: workflowId,
      step_type: stepType
    });

    // Payload is NOT NULL in schema, so provide empty object for PENDING steps
    const result = await this.db.query(query, [id, workflowId, stepType, status, {}]);

    // Verify query result exists before accessing .rows
    if (!result || !result.rows || result.rows.length === 0) {
      throw new Error('Failed to create workflow step: no result returned from database');
    }

    return result.rows[0];
  }

  async updateWorkflowStep(
    stepId: string,
    status: string,
    correlationId: string,
    payload?: any,
    errorDetails?: any
  ): Promise<void> {
    const query = `
      UPDATE evaluation_coordinator.workflow_steps
      SET status = $1,
          payload = $2,
          error_details = $3,
          completed_at = NOW()
      WHERE id = $4
    `;

    logger.info('Updating workflow step', {
      correlation_id: correlationId,
      step_id: stepId,
      status
    });

    // Payload is NOT NULL in schema, so provide empty object if not provided
    await this.db.query(query, [status, payload || {}, errorDetails, stepId]);
  }

  async createOutboxEvent(
    aggregateId: string,
    aggregateType: string,
    eventType: string,
    payload: any,
    correlationId: string
  ): Promise<OutboxEvent> {
    const id = uuidv4();
    const query = `
      INSERT INTO evaluation_coordinator.outbox
        (id, aggregate_id, aggregate_type, event_type, payload, correlation_id, published, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `;

    logger.info('Creating outbox event', {
      correlation_id: correlationId,
      event_type: eventType
    });

    const result = await this.db.query(query, [
      id,
      aggregateId,
      aggregateType,
      eventType,
      payload,
      correlationId,
      false // published = false (transactional outbox pattern)
    ]);

    // Verify query result exists before accessing .rows
    if (!result || !result.rows || result.rows.length === 0) {
      throw new Error('Failed to create outbox event: no result returned from database');
    }

    return result.rows[0];
  }

  async getWorkflowByJourneyId(journeyId: string): Promise<EvaluationWorkflow | null> {
    const query = `
      SELECT * FROM evaluation_coordinator.evaluation_workflows
      WHERE journey_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.db.query(query, [journeyId]);

    // Verify query result exists before accessing .rows
    if (!result || !result.rows) {
      return null;
    }

    return result.rows[0] || null;
  }

  async getWorkflowSteps(workflowId: string): Promise<WorkflowStep[]> {
    const query = `
      SELECT * FROM evaluation_coordinator.workflow_steps
      WHERE workflow_id = $1
      ORDER BY started_at ASC
    `;

    const result = await this.db.query(query, [workflowId]);

    // Verify query result exists before accessing .rows
    if (!result || !result.rows) {
      return [];
    }

    return result.rows;
  }
}
