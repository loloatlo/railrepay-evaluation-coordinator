/**
 * Status routes - GET /status/:journey_id
 */

import { Router, Request, Response } from 'express';
import { WorkflowService } from '../services/workflow-service.js';
import { logger } from '../lib/logger.js';

export const createStatusRouter = (db: any) => {
  const router = Router();
  const workflowService = new WorkflowService(db);

  router.get('/:journey_id', async (req: Request, res: Response) => {
    const { journey_id } = req.params;

    try {
      const status = await workflowService.getWorkflowStatus(journey_id);

      if (!status) {
        logger.info('Workflow not found for journey', { journey_id });
        return res.status(404).json({
          error: 'Workflow not found for this journey_id'
        });
      }

      logger.info('Workflow status retrieved', {
        journey_id,
        workflow_id: status.workflow_id,
        status: status.status
      });

      return res.status(200).json(status);
    } catch (error) {
      logger.error('Failed to retrieve workflow status', {
        journey_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return res.status(500).json({
        error: 'Internal server error'
      });
    }
  });

  return router;
};
