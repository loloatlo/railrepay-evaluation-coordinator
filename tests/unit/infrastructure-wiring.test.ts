/**
 * Infrastructure Wiring Tests - Shared Package Verification
 *
 * Phase: 3.1 Test Specification (Jessie)
 * Author: Jessie (QA Engineer)
 * Date: 2026-01-18
 *
 * Purpose:
 * These tests verify that the service ACTUALLY USES the @railrepay/* shared packages,
 * not just installs them. This prevents the metrics-pusher 1.0.0 production crash scenario.
 *
 * Critical Lesson Learned (2025-12-06):
 * metrics-pusher@1.0.0 had 95% test coverage but crashed in production because:
 * - ALL tests mocked the prometheus-remote-write dependency
 * - No integration test exercised the REAL dependency chain
 * - Missing peerDependency (node-fetch) was never detected until Railway deployment
 *
 * Required Package Usage (MANDATORY):
 * - @railrepay/winston-logger (not console.log)
 * - @railrepay/metrics-pusher (not custom Prometheus client)
 * - @railrepay/postgres-client (for DB connections)
 *
 * Test Strategy:
 * - Assert actual package imports exist in source code
 * - At least ONE integration test exercises REAL dependencies (not mocks)
 * - Verify no forbidden patterns (console.log, custom metrics, raw pg.Pool)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

describe('Infrastructure Wiring - Shared Package Usage', () => {
  /**
   * These tests will FAIL until Blake creates the src/ directory and imports packages.
   * They verify that the implementation ACTUALLY USES shared packages.
   */

  describe('@railrepay/winston-logger usage (MANDATORY)', () => {
    it('should import @railrepay/winston-logger in implementation code (WILL FAIL - no src/ exists)', () => {
      // This test will FAIL because Blake hasn't created src/ yet

      // Act - this will FAIL (no src directory exists)
      const srcFiles = getSrcFiles();
      const sourceCode = srcFiles.map(file => readFileSync(file, 'utf-8'));
      const combinedSource = sourceCode.join('');

      // Assert - check if ANY file contains the import
      expect(combinedSource).toContain('@railrepay/winston-logger');
    });

    it('should NOT use console.log in implementation code (WILL FAIL - no src/ exists)', () => {
      // Act - this will FAIL (no src directory exists)
      const srcFiles = getSrcFiles();
      const hasConsoleLogs = srcFiles.some(file => {
        const content = readFileSync(file, 'utf-8');
        // Ignore comments and test files
        const codeLines = content.split('\n').filter(line =>
          !line.trim().startsWith('//') && !line.trim().startsWith('*')
        );
        return codeLines.some(line => line.includes('console.log'));
      });

      // Assert
      expect(hasConsoleLogs).toBe(false);
    });

    it('should use logger instance that includes correlation_id in all calls (WILL FAIL - no implementation)', async () => {
      // This verifies ADR-002 compliance

      // Act - this will FAIL (no logger wrapper exists)
      const { createLogger } = await import('../../src/index.js');
      const logger = createLogger();
      const logSpy = vi.spyOn(logger, 'info');

      logger.info('Test message', { correlation_id: '123' });

      // Assert
      expect(logSpy).toHaveBeenCalledWith(
        'Test message',
        expect.objectContaining({ correlation_id: '123' })
      );
    });
  });

  describe('@railrepay/metrics-pusher usage (MANDATORY)', () => {
    it('should import @railrepay/metrics-pusher in implementation code (WILL FAIL - no src/ exists)', () => {
      // Act - this will FAIL (no src directory exists)
      const srcFiles = getSrcFiles();
      const hasMetricsImport = srcFiles.some(file => {
        const content = readFileSync(file, 'utf-8');
        return content.includes('@railrepay/metrics-pusher');
      });

      // Assert
      expect(hasMetricsImport).toBe(true);
    });

    it('should NOT use prom-client directly (must use metrics-pusher wrapper) (WILL FAIL - no src/ exists)', () => {
      // Act - this will FAIL (no src directory exists)
      const srcFiles = getSrcFiles();
      const hasPromClientImport = srcFiles.some(file => {
        const content = readFileSync(file, 'utf-8');
        return content.includes('from \'prom-client\'') || content.includes('require(\'prom-client\')');
      });

      // Assert
      expect(hasPromClientImport).toBe(false);
    });

    it('should exercise REAL metrics-pusher in at least one integration test (CRITICAL - prevents production crashes)', () => {
      // CRITICAL: This prevents the metrics-pusher@1.0.0 crash scenario
      // At least ONE integration test must use the REAL metrics-pusher, not mocks
      // Integration tests MUST NOT mock metrics-pusher to catch missing dependencies

      // Act - this will FAIL (no integration test with real metrics exists)
      const integrationTestsWithRealMetrics = checkIntegrationTestsForRealMetrics();

      // Assert
      expect(integrationTestsWithRealMetrics.length).toBeGreaterThan(0);

      // Verify integration tests DON'T mock metrics-pusher
      const integrationTestsWithMockedMetrics = checkIntegrationTestsForMockedMetrics();
      expect(integrationTestsWithMockedMetrics.length).toBe(0);
    });
  });

  describe('@railrepay/postgres-client usage (MANDATORY)', () => {
    it('should import @railrepay/postgres-client in implementation code (WILL FAIL - no src/ exists)', () => {
      // Act - this will FAIL (no src directory exists)
      const srcFiles = getSrcFiles();
      const hasPostgresClientImport = srcFiles.some(file => {
        const content = readFileSync(file, 'utf-8');
        return content.includes('@railrepay/postgres-client');
      });

      // Assert
      expect(hasPostgresClientImport).toBe(true);
    });

    it('should NOT create raw pg.Pool instances (must use postgres-client) (WILL FAIL - no src/ exists)', () => {
      // Act - this will FAIL (no src directory exists)
      const srcFiles = getSrcFiles();
      const hasRawPoolCreation = srcFiles.some(file => {
        const content = readFileSync(file, 'utf-8');
        // Check for "new Pool(" but allow "new PostgreSqlContainer" (Testcontainers)
        return content.includes('new Pool(') && !file.includes('test');
      });

      // Assert
      expect(hasRawPoolCreation).toBe(false);
    });
  });

  describe('Dependency Verification (npm ls check)', () => {
    it('should have all @railrepay/* packages installed with no missing peerDependencies (WILL FAIL - Blake must verify)', () => {
      // This verifies the lesson learned from metrics-pusher@1.0.0

      // Act - this will FAIL (Blake must run npm ls and fix any issues)
      const { execSync } = require('child_process');
      const npmLsOutput = execSync('npm ls --all', { encoding: 'utf-8' });

      // Assert - check for UNMET PEER DEPENDENCY or extraneous warnings
      expect(npmLsOutput).not.toContain('UNMET PEER DEPENDENCY');
      expect(npmLsOutput).not.toContain('extraneous:');
      expect(npmLsOutput).not.toContain('missing:');
    });
  });
});

/**
 * Helper: Get all TypeScript source files from src/ directory
 * (Will fail until Blake creates src/)
 */
function getSrcFiles(): string[] {
  try {
    const srcDir = join(process.cwd(), 'src');
    const files: string[] = [];

    function traverse(dir: string) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          traverse(fullPath);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          files.push(fullPath);
        }
      }
    }

    traverse(srcDir);
    return files;
  } catch (error) {
    return []; // src/ doesn't exist yet - expected to fail
  }
}

/**
 * Helper: Check if integration tests exercise REAL metrics-pusher
 * (Will fail until Blake creates integration tests with real dependencies)
 */
function checkIntegrationTestsForRealMetrics(): string[] {
  try {
    const integrationTestsDir = join(process.cwd(), 'tests', 'integration');
    const files = readdirSync(integrationTestsDir)
      .filter(f => f.endsWith('.test.ts'))
      .map(f => join(integrationTestsDir, f));

    const filesWithRealMetrics: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      // Check if file imports metrics-pusher AND doesn't mock it
      const hasMetricsImport = content.includes('@railrepay/metrics-pusher');
      const hasMock = content.includes('vi.mock(\'@railrepay/metrics-pusher\')');

      if (hasMetricsImport && !hasMock) {
        filesWithRealMetrics.push(file);
      }
    }

    return filesWithRealMetrics;
  } catch (error) {
    return []; // Integration tests don't exist yet - expected to fail
  }
}

/**
 * Helper: Check if integration tests MOCK metrics-pusher (anti-pattern)
 * (Should return empty array - integration tests should use REAL dependencies)
 */
function checkIntegrationTestsForMockedMetrics(): string[] {
  try {
    const integrationTestsDir = join(process.cwd(), 'tests', 'integration');
    const files = readdirSync(integrationTestsDir)
      .filter(f => f.endsWith('.test.ts'))
      .map(f => join(integrationTestsDir, f));

    const filesWithMockedMetrics: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      // Check if file mocks metrics-pusher (anti-pattern in integration tests)
      const hasMock = content.includes('vi.mock(\'@railrepay/metrics-pusher\')');

      if (hasMock) {
        filesWithMockedMetrics.push(file);
      }
    }

    return filesWithMockedMetrics;
  } catch (error) {
    return []; // Integration tests don't exist yet - expected to fail
  }
}
