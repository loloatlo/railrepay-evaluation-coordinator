/**
 * Evaluation routes - POST /evaluate/:journey_id
 */

import { Router, Request, Response } from 'express';
import { validate as uuidValidate } from 'uuid';
import { WorkflowService } from '../services/workflow-service.js';
import { logger } from '../lib/logger.js';

export const createEvaluateRouter = (db: any) => {
  const router = Router();
  const workflowService = new WorkflowService(db);

  router.post('/:journey_id', async (req: Request, res: Response) => {
    const { journey_id } = req.params;

    // Validate journey_id is valid UUID
    if (!uuidValidate(journey_id)) {
      logger.warn('Invalid journey_id format', { journey_id });
      return res.status(400).json({
        error: 'Invalid journey_id format. Must be a valid UUID.'
      });
    }

    try {
      const result = await workflowService.initiateEvaluation(journey_id);

      logger.info('Evaluation workflow initiated successfully', {
        correlation_id: result.correlation_id,
        workflow_id: result.workflow_id,
        journey_id: result.journey_id
      });

      return res.status(202).json(result);
    } catch (error: any) {
      logger.error('Failed to initiate evaluation workflow', {
        journey_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Handle business-level duplicate workflow error
      if (error.status === 422) {
        return res.status(422).json({
          error: error.message
        });
      }

      return res.status(500).json({
        error: 'Internal server error'
      });
    }
  });

  return router;
};
