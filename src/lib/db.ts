/**
 * Database client setup for evaluation-coordinator service
 * Uses @railrepay/postgres-client (ADR-005)
 */

import { PostgresClient } from '@railrepay/postgres-client';

export const createDbClient = () => {
  return new PostgresClient({
    serviceName: 'evaluation-coordinator',
    schemaName: 'evaluation_coordinator',
    // PostgresClient reads from PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD env vars by default
    // Or can be overridden here if needed
  });
};
