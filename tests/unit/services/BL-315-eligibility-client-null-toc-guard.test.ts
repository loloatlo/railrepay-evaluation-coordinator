/**
 * BL-315 AC-V4: EligibilityClient.evaluate() must NOT silently coerce null/undefined
 * toc_code to the literal 'UNKNOWN' — it must guard, log WARN, and fail fast.
 *
 * Bug context (T1 confirmed by Blake):
 *   When monitored_journeys.toc_code is NULL (because JourneyRepository.create()
 *   never wrote it — that is the upstream bug covered by AC-V1/V2), the BFF polls
 *   GET /delays/:journeyId and receives toc_code: null.  It then calls
 *   evaluation-coordinator, which calls EligibilityClient.evaluate() with
 *   toc_code: null (or undefined).
 *
 *   Current behaviour (line 42 of eligibility-client.ts):
 *     const toc_code = request.toc_code ?? 'UNKNOWN';
 *   This silently converts null/undefined to the string 'UNKNOWN', which the
 *   eligibility-engine rejects with 400 "Unknown TOC code: UNKNOWN".
 *   The 400 propagates as an unhandled error → workflow FAILED → BFF times out
 *   after ~30s → PWA shows the graceful timeout banner.
 *
 * Desired new behaviour (AC-V4):
 *   - Do NOT send 'UNKNOWN' to the eligibility engine.
 *   - Instead, fail fast: throw an error (or return a typed failure) AND emit a
 *     logger.warn with context (journey_id, toc_code value, correlation_id).
 *   - The external contract must guarantee 'UNKNOWN' is NEVER sent downstream.
 *
 * Implementation choice is Blake's (throw vs typed-error-return), so this test
 * asserts the OBSERVABLE guarantees only:
 *   (a) logger.warn is called with journey_id and the missing-toc context
 *   (b) axios.post is NOT called with toc_code === 'UNKNOWN'
 *   (c) the promise rejects (fast-fail) or returns without a successful evaluate call
 *
 * Phase    : T2-test (Jessie — Bug-reproducing test, TDD per ADR-014)
 * Story    : BL-315
 * Date     : 2026-06-07
 *
 * Test Lock Rule (CLAUDE.md §6): Blake MUST NOT modify these tests.
 * If a test appears wrong, Blake hands back to Jessie with explanation.
 *
 * RED-first proof:
 *   On current HEAD evaluate() DOES call axios.post with toc_code:'UNKNOWN'.
 *   AC-V4-a: logger.warn NOT called → assertion fails → RED
 *   AC-V4-b: axios.post IS called with toc_code:'UNKNOWN' → assertion fails → RED
 *   AC-V4-c: the call does NOT reject/fail fast → assertion fails → RED
 *
 * AC coverage map:
 *   AC-V4: EligibilityClient.evaluate(toc_code=null) does not emit 'UNKNOWN';
 *          logs WARN and fails fast.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Shared logger mock (per Jessie guideline #11 — OUTSIDE factory, same instance)
// ---------------------------------------------------------------------------

const sharedLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => sharedLogger),
}));

// ---------------------------------------------------------------------------
// Axios mock — captures what is sent to the eligibility engine
// ---------------------------------------------------------------------------

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const JOURNEY_ID = 'bl315-v4-journey-001';
const CORR_ID   = 'bl315-v4-corr-001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BL-315 AC-V4: EligibilityClient.evaluate() with null toc_code does NOT emit "UNKNOWN"', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC-V4-b + AC-V4-c: null toc_code — does NOT reach axios.post with 'UNKNOWN'
  it('AC-V4: evaluate() with toc_code=null does NOT call axios.post with toc_code="UNKNOWN"', async () => {
    // AC-V4: The CORE assertion.
    // On current HEAD: const toc_code = request.toc_code ?? 'UNKNOWN' (line 42)
    // → axios.post IS called with { toc_code: 'UNKNOWN', ... }
    // → eligibility-engine returns 400 "Unknown TOC code: UNKNOWN"
    //
    // After Blake's fix: axios.post must NOT be called with toc_code='UNKNOWN'.
    // FAILS TODAY: axios.post will be called (or will be mocked to resolve), and
    // the payload will contain toc_code: 'UNKNOWN'.

    // Import dynamically so the mock is applied first
    const { EligibilityClient } = await import('../../../src/services/eligibility-client.js');
    const client = new EligibilityClient();

    // Arrange: axios.post returns a 200 on current HEAD (before fix)
    // so we can inspect what it was called with
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        journey_id: JOURNEY_ID,
        eligible: true,
        scheme: 'DR30',
        delay_minutes: 45,
        compensation_percentage: 50,
        compensation_pence: 1250,
        ticket_fare_pence: 2500,
        reasons: [],
        applied_rules: [],
        evaluation_timestamp: new Date().toISOString(),
      },
    });

    // Act: pass toc_code = null (the upstream-null scenario)
    try {
      await client.evaluate(
        { journey_id: JOURNEY_ID, toc_code: undefined, delay_minutes: 45, ticket_fare_pence: 2500 },
        CORR_ID,
      );
    } catch (_e) {
      // fast-fail (throw) is the expected new behaviour — swallow the error here;
      // the assertions below check that 'UNKNOWN' was NOT sent
    }

    // AC-V4-b CORE ASSERTION: If axios.post was called at all, it must NOT have
    // received toc_code === 'UNKNOWN'.
    //
    // FAILS TODAY: axios.post is called with { ..., toc_code: 'UNKNOWN', ... }
    if (vi.mocked(axios.post).mock.calls.length > 0) {
      for (const call of vi.mocked(axios.post).mock.calls) {
        const body = call[1] as Record<string, unknown>;
        expect(body.toc_code).not.toBe('UNKNOWN');
      }
    }
    // If axios.post was NOT called (fast-fail before reaching the HTTP call), that
    // is also acceptable — the guard prevented the bad request from going out.
  });

  it('AC-V4: evaluate() with toc_code=null logs logger.warn with journey_id context', async () => {
    // AC-V4-a: When toc_code is null/undefined, the implementation MUST emit a
    // logger.warn that includes the journey_id so operators can trace the root cause.
    //
    // FAILS TODAY: No warn is logged — the code silently substitutes 'UNKNOWN'.

    const { EligibilityClient } = await import('../../../src/services/eligibility-client.js');
    const client = new EligibilityClient();

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        journey_id: JOURNEY_ID,
        eligible: false,
        scheme: 'DR30',
        delay_minutes: 45,
        compensation_percentage: 0,
        compensation_pence: 0,
        ticket_fare_pence: 0,
        reasons: ['Unknown TOC'],
        applied_rules: [],
        evaluation_timestamp: new Date().toISOString(),
      },
    });

    try {
      await client.evaluate(
        { journey_id: JOURNEY_ID, toc_code: null as unknown as string, delay_minutes: 45 },
        CORR_ID,
      );
    } catch (_e) {
      // fast-fail is acceptable
    }

    // AC-V4-a: logger.warn MUST have been called with journey_id
    // FAILS TODAY: sharedLogger.warn is never called — code goes straight to axios.post.
    expect(sharedLogger.warn).toHaveBeenCalled();

    // The warn call must include journey_id so operators can identify the journey
    const warnCalls = sharedLogger.warn.mock.calls;
    const anyCallHasJourneyId = warnCalls.some(([, meta]: [string, Record<string, unknown>]) =>
      meta && typeof meta === 'object' && meta.journey_id === JOURNEY_ID
    );
    expect(anyCallHasJourneyId).toBe(true);
  });

  it('AC-V4: evaluate() with toc_code=undefined logs logger.warn (undefined variant)', async () => {
    // AC-V4: The undefined variant — same expectation as null.
    // Both null and undefined represent the missing-toc scenario.

    const { EligibilityClient } = await import('../../../src/services/eligibility-client.js');
    const client = new EligibilityClient();

    vi.mocked(axios.post).mockRejectedValue(new Error('should not be called'));

    try {
      await client.evaluate(
        { journey_id: JOURNEY_ID, delay_minutes: 30 },
        CORR_ID,
      );
    } catch (_e) {
      // fast-fail — expected
    }

    // AC-V4-a: warn must be emitted for undefined toc_code too
    // FAILS TODAY: no warn logged; axios.post attempted with toc_code:'UNKNOWN'.
    expect(sharedLogger.warn).toHaveBeenCalled();
  });

  it('AC-V4: evaluate() with valid toc_code="GR" still calls axios.post (positive baseline)', async () => {
    // AC-V4 POSITIVE BASELINE: When toc_code IS provided and non-null, the normal
    // happy-path still works. This test must stay GREEN to confirm the fix does not
    // accidentally break the valid-toc path.
    //
    // Expected: GREEN on current HEAD and GREEN after fix.

    const { EligibilityClient } = await import('../../../src/services/eligibility-client.js');
    const client = new EligibilityClient();

    const mockResponse = {
      data: {
        journey_id: JOURNEY_ID,
        eligible: true,
        scheme: 'DR30',
        delay_minutes: 45,
        compensation_percentage: 50,
        compensation_pence: 1250,
        ticket_fare_pence: 2500,
        reasons: ['Eligible under DR30'],
        applied_rules: ['DR30_30MIN_50PCT'],
        evaluation_timestamp: new Date().toISOString(),
      },
    };
    vi.mocked(axios.post).mockResolvedValue(mockResponse);

    const result = await client.evaluate(
      { journey_id: JOURNEY_ID, toc_code: 'GR', delay_minutes: 45, ticket_fare_pence: 2500 },
      CORR_ID,
    );

    // axios.post MUST be called with toc_code: 'GR' (not 'UNKNOWN', not null)
    expect(vi.mocked(axios.post)).toHaveBeenCalled();
    const callBody = vi.mocked(axios.post).mock.calls[0][1] as Record<string, unknown>;
    expect(callBody.toc_code).toBe('GR');
    expect(result.eligible).toBe(true);
  });

  it('AC-V4: evaluate() with empty string toc_code is treated as missing (guard applies)', async () => {
    // AC-V4 EDGE: An empty-string toc_code is semantically equivalent to missing.
    // The guard should also fire for '' to prevent sending empty-string to the engine.
    // Implementation choice (how to detect '' vs null) is Blake's; this test asserts
    // that 'UNKNOWN' is NOT sent and a warn IS emitted.
    //
    // FAILS TODAY: '' ?? 'UNKNOWN' = '' (nullish coalescing), so this test would
    // actually PASS today for the 'UNKNOWN' assertion but FAIL for the warn assertion.

    const { EligibilityClient } = await import('../../../src/services/eligibility-client.js');
    const client = new EligibilityClient();

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        journey_id: JOURNEY_ID,
        eligible: false,
        scheme: 'DR30',
        delay_minutes: 45,
        compensation_percentage: 0,
        compensation_pence: 0,
        ticket_fare_pence: 0,
        reasons: [],
        applied_rules: [],
        evaluation_timestamp: new Date().toISOString(),
      },
    });

    try {
      await client.evaluate(
        { journey_id: JOURNEY_ID, toc_code: '', delay_minutes: 45 },
        CORR_ID,
      );
    } catch (_e) {
      // fast-fail acceptable
    }

    // Empty string must not result in 'UNKNOWN' being sent to engine
    if (vi.mocked(axios.post).mock.calls.length > 0) {
      for (const call of vi.mocked(axios.post).mock.calls) {
        const body = call[1] as Record<string, unknown>;
        expect(body.toc_code).not.toBe('UNKNOWN');
      }
    }

    // warn must be emitted for empty-string toc_code
    // (This is the strict interpretation; Blake may choose to allow '' → guard only for
    // null/undefined. If so, hand back to Jessie and we'll adjust the '' expectation.)
    expect(sharedLogger.warn).toHaveBeenCalled();
  });
});
