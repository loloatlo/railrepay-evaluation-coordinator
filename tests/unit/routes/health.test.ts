/**
 * Unit tests for health routes
 *
 * Coverage target: routes/health.ts >= 80%
 * Covers: GET /health, GET /health/ready, GET /health/live, GET /ready
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from '../../../src/routes/health.js';

function buildApp() {
  const app = express();
  app.use(createHealthRouter());
  return app;
}

describe('Health Routes', () => {
  const app = buildApp();

  it('GET /health returns 200 with status healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'healthy' });
  });

  it('GET /health/ready returns 200 with status ready', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('GET /health/live returns 200 with status alive', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'alive' });
  });

  it('GET /ready returns 200 with status ready (legacy endpoint)', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('GET /unknown returns 404 (not a health endpoint)', async () => {
    const res = await request(app).get('/unknown-path');
    expect(res.status).toBe(404);
  });
});
