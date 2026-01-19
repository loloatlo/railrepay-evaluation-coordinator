/**
 * Health check routes
 */

import { Router, Request, Response } from 'express';

export const createHealthRouter = () => {
  const router = Router();

  router.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'healthy' });
  });

  router.get('/health/ready', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ready' });
  });

  router.get('/health/live', (req: Request, res: Response) => {
    res.status(200).json({ status: 'alive' });
  });

  // Legacy /ready endpoint
  router.get('/ready', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ready' });
  });

  return router;
};
