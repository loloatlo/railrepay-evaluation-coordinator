/**
 * migrate-safe.cjs
 *
 * Backfill migration tracking rows for any migration whose schema objects already
 * exist on the database but whose tracking row is absent from
 * public.evaluation_coordinator_pgmigrations.
 *
 * This handles the scenario where the schema was applied manually or via a prior
 * deployment that crashed after DDL but before the tracking INSERT committed.
 *
 * After backfilling, delegates to `npm run migrate:up` (node-pg-migrate) which
 * will find all tracking rows present and no-op cleanly.
 *
 * Safe to run on every deploy: INSERT ... ON CONFLICT DO NOTHING.
 */

'use strict';

const { Client } = require('pg');
const { execSync } = require('child_process');

const MIGRATIONS_TABLE = 'public.evaluation_coordinator_pgmigrations';

/**
 * Each entry: { name, existsQuery }
 * existsQuery should return at least one row if the migration has been applied.
 */
const MIGRATIONS = [
  {
    name: '1737187200000_initial-schema',
    existsQuery: `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'evaluation_coordinator'
        AND table_name   = 'evaluation_workflows'
      LIMIT 1
    `,
  },
];

async function run() {
  const client = new Client();
  await client.connect();

  try {
    for (const migration of MIGRATIONS) {
      const checkResult = await client.query(migration.existsQuery);
      const alreadyApplied = checkResult.rows.length > 0;

      if (alreadyApplied) {
        // Check whether the tracking row already exists (name column has no unique
        // constraint, so we cannot use ON CONFLICT; guard with a SELECT first).
        const trackingCheck = await client.query(
          `SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE name = $1 LIMIT 1`,
          [migration.name]
        );
        if (trackingCheck.rows.length === 0) {
          await client.query(
            `INSERT INTO ${MIGRATIONS_TABLE} (name, run_on) VALUES ($1, NOW())`,
            [migration.name]
          );
          console.log(`[migrate-safe] Backfilled tracking row for: ${migration.name}`);
        } else {
          console.log(`[migrate-safe] Tracking row already present for: ${migration.name}`);
        }
      } else {
        console.log(`[migrate-safe] Schema not yet applied for: ${migration.name} — will be applied by migrate:up`);
      }
    }
  } finally {
    await client.end();
  }

  console.log('[migrate-safe] Running node-pg-migrate up ...');
  execSync('npm run migrate:up', { stdio: 'inherit' });
  console.log('[migrate-safe] Migrations complete.');
}

run().catch((err) => {
  console.error('[migrate-safe] Fatal error:', err.message);
  process.exit(1);
});
