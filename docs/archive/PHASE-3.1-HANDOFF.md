# Phase 3.1 Complete - Test Specification Handoff to Blake

**Phase Owner**: Jessie (QA Engineer)
**Date**: 2026-01-18
**Next Phase Owner**: Blake (Backend Engineer)
**Next Phase**: 3.2 - Implementation

---

## Executive Summary

✅ **Phase 3.1 COMPLETE** - All tests written and verified RED (failing as expected).

**Test Summary**:
- **Total Tests**: 61
- **FAILING (RED)**: 50 ✅ (proves no implementation exists)
- **PASSING (GREEN)**: 11 ✅ (Hoops' migration tests from Phase 2)

**Test Files Created**:
1. `/services/evaluation-coordinator/tests/unit/evaluation-workflow.test.ts` (31 unit tests)
2. `/services/evaluation-coordinator/tests/integration/evaluation-workflow-integration.test.ts` (10 integration tests)
3. `/services/evaluation-coordinator/tests/unit/infrastructure-wiring.test.ts` (9 infrastructure tests)

**Fixtures Created** (ADR-017 compliant with real data):
1. `/services/evaluation-coordinator/tests/fixtures/db/journeys-valid.json`
2. `/services/evaluation-coordinator/tests/fixtures/api/eligibility-engine-response-eligible.json`
3. `/services/evaluation-coordinator/tests/fixtures/api/eligibility-engine-response-ineligible.json`
4. `/services/evaluation-coordinator/tests/fixtures/api/eligibility-engine-error-500.json`

---

## Blake's Phase 3.2 Responsibilities

Your job is to make these 50 failing tests GREEN by implementing the evaluation-coordinator service.

### 🔴 CRITICAL RULES - TEST LOCK

**YOU MUST NOT MODIFY JESSIE'S TESTS** (Test Lock Rule - applies to ALL workflows)

If you believe a test specification is wrong:
1. STOP implementation
2. Hand back to Jessie with detailed explanation
3. Jessie reviews and updates the test if needed
4. Jessie re-hands off the updated failing test

**Why**: Prevents implementation from being influenced by test modifications. The test is the specification.

---

## Failing Tests Breakdown

### AC-1: Evaluation Workflow Initiation (6 tests)

**Requirements**:
- POST /evaluate/:journey_id creates evaluation_workflow with status 'INITIATED'
- Generates correlation_id for tracing
- Returns 202 Accepted with workflow_id
- Logs with Winston (correlation_id included)
- Increments `evaluation_coordinator_evaluations_started` metric
- Validates journey_id is valid UUID (400 Bad Request if not)

**Tests to make GREEN**:
1. `should create workflow with status INITIATED when POST /evaluate/:journey_id`
2. `should generate unique correlation_id for tracing when initiating workflow`
3. `should return 202 Accepted with workflow_id when workflow initiated`
4. `should log workflow initiation with correlation_id using Winston logger`
5. `should increment evaluation_coordinator_evaluations_started metric using metrics-pusher`
6. `should return 400 Bad Request when journey_id is invalid UUID`

**Implementation Notes**:
- Use `@railrepay/winston-logger` (not console.log)
- Use `@railrepay/metrics-pusher` (not custom prom-client)
- Use `@railrepay/postgres-client` for DB connection
- Correlation ID: Use `uuid.v4()` and propagate throughout request lifecycle

---

### AC-2: Eligibility Engine Integration (7 tests)

**Requirements**:
- Calls eligibility-engine API with journey_id
- Creates workflow_step record for eligibility check
- Handles timeout (30s) with step status 'TIMEOUT'
- Handles 4xx/5xx with step status 'FAILED'
- Updates step status to 'COMPLETED' on success
- Stores eligibility result in workflow_step payload

**Tests to make GREEN**:
1. `should call eligibility-engine API with journey_id after workflow initiation`
2. `should create workflow_step record with type ELIGIBILITY_CHECK and status PENDING`
3. `should update workflow_step status to COMPLETED when eligibility check succeeds`
4. `should store eligibility result in workflow_step payload when check succeeds`
5. `should handle timeout (30s) with step status TIMEOUT`
6. `should handle 4xx error with step status FAILED and error details`
7. `should handle 5xx error with step status FAILED and error details`

**Implementation Notes**:
- Use axios with 30s timeout
- Store HTTP error status code in workflow_step.error_details
- Use JSONB columns for payload and error_details

---

### AC-3: Partial Failure Handling (4 tests)

**Requirements**:
- Marks step as 'FAILED' with error details
- Continues to next steps if possible
- Updates workflow status to 'PARTIAL_SUCCESS'
- Logs failure with correlation_id and error context

**Tests to make GREEN**:
1. `should mark step as FAILED with error details when eligibility check fails`
2. `should update workflow status to PARTIAL_SUCCESS when step fails but workflow continues`
3. `should log failure with correlation_id and error context using Winston`
4. `should continue to next steps when a non-critical step fails`

**Implementation Notes**:
- Define critical vs non-critical steps
- ELIGIBILITY_CHECK is critical (workflow stops if fails)
- NOTIFICATION steps are non-critical (workflow continues)

---

### AC-4: Claim Submission Trigger (5 tests)

**Requirements**:
- Writes outbox event 'CLAIM_SUBMISSION_REQUESTED' when eligibility passes
- Creates workflow_step for claim creation
- Updates workflow status to 'CLAIM_PENDING'
- Outbox event includes: journey_id, eligibility_result, correlation_id

**Tests to make GREEN**:
1. `should write CLAIM_SUBMISSION_REQUESTED outbox event when eligibility passes`
2. `should NOT write outbox event when eligibility check fails`
3. `should create workflow_step for CLAIM_CREATION when triggering claim`
4. `should update workflow status to CLAIM_PENDING when claim triggered`
5. `should include journey_id, eligibility_result, and correlation_id in outbox event payload`

**Implementation Notes**:
- Only create outbox event if eligibility_result.eligible === true
- Use transactional outbox pattern (published = false initially)
- Outbox event structure:
  ```json
  {
    "aggregate_id": "workflow_id",
    "aggregate_type": "EVALUATION_WORKFLOW",
    "event_type": "CLAIM_SUBMISSION_REQUESTED",
    "payload": {
      "journey_id": "uuid",
      "eligibility_result": { ... },
      "correlation_id": "uuid"
    },
    "correlation_id": "uuid"
  }
  ```

---

### AC-5: Status Retrieval (4 tests)

**Requirements**:
- GET /status/:journey_id returns workflow status with all step statuses
- Includes timestamps for each step
- Includes eligibility result if available
- Returns 404 if journey_id not found

**Tests to make GREEN**:
1. `should return workflow status with all step statuses when GET /status/:journey_id`
2. `should include timestamps for each step in status response`
3. `should include eligibility_result in status response when available`
4. `should return 404 when journey_id not found in workflows`

**Implementation Notes**:
- Join evaluation_workflows with workflow_steps
- Return structure:
  ```json
  {
    "workflow_id": "uuid",
    "journey_id": "uuid",
    "status": "CLAIM_PENDING",
    "eligibility_result": { ... },
    "steps": [
      {
        "step_type": "ELIGIBILITY_CHECK",
        "status": "COMPLETED",
        "started_at": "2026-01-18T12:00:01Z",
        "completed_at": "2026-01-18T12:00:05Z"
      }
    ]
  }
  ```

---

### AC-6: Observability Requirements (5 tests)

**Requirements**:
- All logs include correlation_id (ADR-002)
- Metrics pushed via @railrepay/metrics-pusher
- Duration histogram for completed workflows
- Error counter on failures

**Tests to make GREEN**:
1. `should include correlation_id in all log statements (ADR-002)`
2. `should push metrics via @railrepay/metrics-pusher not custom client`
3. `should record duration histogram when workflow completes`
4. `should increment error counter when workflow step fails`
5. `should use @railrepay/winston-logger not console.log`

**Implementation Notes**:
- Every logger call MUST include `{ correlation_id: string }`
- Metrics to implement:
  - `evaluation_coordinator_evaluations_started` (counter)
  - `evaluation_coordinator_workflow_duration_seconds` (histogram)
  - `evaluation_coordinator_step_failures_total` (counter with label: step_type)

---

### Infrastructure Wiring Tests (9 tests)

**Requirements**:
- Actually USE @railrepay/winston-logger (not just install it)
- Actually USE @railrepay/metrics-pusher (not just install it)
- Actually USE @railrepay/postgres-client (not just install it)
- NO console.log statements
- NO direct prom-client usage
- NO raw pg.Pool instantiation
- At least ONE integration test exercises REAL metrics-pusher (not mocked)

**Tests to make GREEN**:
1. `should import @railrepay/winston-logger in implementation code`
2. `should NOT use console.log in implementation code`
3. `should use logger instance that includes correlation_id in all calls`
4. `should import @railrepay/metrics-pusher in implementation code`
5. `should NOT use prom-client directly`
6. `should exercise REAL metrics-pusher in at least one integration test`
7. `should import @railrepay/postgres-client in implementation code`
8. `should NOT create raw pg.Pool instances`
9. `should have all @railrepay/* packages installed with no missing peerDependencies`

**CRITICAL - Lesson Learned (2025-12-06)**:

metrics-pusher@1.0.0 had 95% test coverage but crashed in production because:
- ALL tests mocked the prometheus-remote-write dependency
- No integration test exercised the REAL dependency chain
- Missing peerDependency (node-fetch) was never detected until Railway deployment

**YOU MUST**:
- Create at least ONE integration test that uses REAL @railrepay/metrics-pusher (no mocks)
- Run `npm ls` and verify NO missing or extraneous peerDependencies
- Actually import and use all @railrepay/* packages in src/ code

---

### Integration Tests (10 tests)

**Requirements**:
- Use Testcontainers for real PostgreSQL instance
- Test full workflow end-to-end
- Verify database constraints and foreign keys under real conditions
- Test concurrent workflow handling
- Test transactional behavior

**Tests to make GREEN**:
1. `should create workflow, eligibility step, and outbox event for eligible journey`
2. `should NOT create outbox event when journey is ineligible`
3. `should enforce foreign key constraint: workflow_steps -> evaluation_workflows`
4. `should update updated_at timestamp when workflow status changes`
5. `should cascade delete workflow_steps when workflow deleted`
6. `should handle multiple concurrent workflow initiations without conflicts`
7. `should prevent duplicate workflows for same journey_id`
8. `should rollback workflow creation if eligibility step creation fails`
9. `should create unpublished outbox event with correct structure`
10. `should query unpublished events efficiently using partial index`

**Implementation Notes**:
- Integration tests already set up Testcontainers (reuse migrations.test.ts pattern)
- Tests call your implementation functions directly
- Database is cleaned between tests (beforeEach hook)

---

## Test Fixtures Available (ADR-017)

All fixtures use REAL data from PostgreSQL (no fabricated values):

### `/tests/fixtures/db/journeys-valid.json`
- Real journey IDs from journey_matcher.journeys
- Sourced via Postgres MCP: `SELECT id, user_id, origin_crs, destination_crs FROM journey_matcher.journeys LIMIT 5`

### `/tests/fixtures/api/eligibility-engine-response-eligible.json`
- Mock successful eligibility check response
- `eligible: true`, `compensation_amount_gbp: 25.50`

### `/tests/fixtures/api/eligibility-engine-response-ineligible.json`
- Mock failed eligibility check response
- `eligible: false`, `reason: "DELAY_BELOW_THRESHOLD"`

### `/tests/fixtures/api/eligibility-engine-error-500.json`
- Mock 500 error response from eligibility-engine
- Use for error handling tests

---

## Implementation Checklist

Before handing off to Jessie for Phase 4 QA:

### Code Structure
- [ ] Create `src/` directory
- [ ] Create `src/index.ts` (Express app entry point)
- [ ] Create `src/routes/` (evaluation routes)
- [ ] Create `src/services/` (business logic)
- [ ] Create `src/db/` (database client wrapper)
- [ ] Create `src/lib/` (logger, metrics, utilities)

### Shared Package Integration
- [ ] Import and USE `@railrepay/winston-logger` in all files
- [ ] Import and USE `@railrepay/metrics-pusher` for all metrics
- [ ] Import and USE `@railrepay/postgres-client` for DB connection
- [ ] NO console.log statements anywhere
- [ ] NO direct prom-client usage
- [ ] NO raw pg.Pool instantiation

### Endpoints
- [ ] POST /evaluate/:journey_id → 202 Accepted
- [ ] GET /status/:journey_id → 200 OK or 404 Not Found

### Database Operations
- [ ] Use evaluation_coordinator schema (Hoops created in Phase 2)
- [ ] Use existing tables: evaluation_workflows, workflow_steps, outbox
- [ ] Use transactions for atomic operations
- [ ] Propagate correlation_id through all operations

### External API Integration
- [ ] Axios client for eligibility-engine API
- [ ] 30s timeout configuration
- [ ] 4xx/5xx error handling
- [ ] Timeout error handling (ETIMEDOUT)

### Observability (ADR-002, ADR-008)
- [ ] Winston logger with correlation_id in every call
- [ ] Metrics-pusher for all counters and histograms
- [ ] Health check endpoint (optional for Phase 3.2)

### Test Verification
- [ ] Run `npm test` → All 61 tests GREEN ✅
- [ ] Run `npm run test:coverage` → Coverage thresholds met (≥80/80/80/75)
- [ ] Run `npm run build` → Compiles without errors
- [ ] Run `npm run lint` → No linting errors
- [ ] Run `npm ls` → No missing or extraneous peerDependencies

---

## Coverage Thresholds (ADR-014)

**MUST MEET** before Jessie signs off in Phase 4:
- Lines: ≥80%
- Functions: ≥80%
- Statements: ≥80%
- Branches: ≥75%

**Current Coverage**: N/A (no implementation yet)

---

## Blocking Rules

**Phase 4 (Jessie QA) CANNOT START until**:
1. All 50 failing tests are GREEN ✅
2. Coverage thresholds met (≥80/80/80/75)
3. No test modifications without Jessie's approval (Test Lock Rule)
4. Full service health verified (`npm test`, `npm run build`, `npm run lint`)

---

## Handoff Artifacts

**Jessie provides to Blake**:
1. `/services/evaluation-coordinator/tests/unit/evaluation-workflow.test.ts`
2. `/services/evaluation-coordinator/tests/integration/evaluation-workflow-integration.test.ts`
3. `/services/evaluation-coordinator/tests/unit/infrastructure-wiring.test.ts`
4. `/services/evaluation-coordinator/tests/fixtures/**/*.json`
5. This handoff document (PHASE-3.1-HANDOFF.md)

**Blake must create**:
1. `/services/evaluation-coordinator/src/**/*.ts` (implementation)
2. Test results showing all 61 tests GREEN
3. Coverage report showing thresholds met

---

## Questions or Issues?

If any test specification is unclear or incorrect:
1. STOP implementation
2. Document the issue clearly
3. Hand back to Jessie with explanation
4. DO NOT modify tests yourself (Test Lock Rule)

Jessie will review, update the test if needed, and re-hand off.

---

**Phase 3.1 Status**: ✅ COMPLETE
**Next Phase**: 3.2 (Blake - Implementation)
**Next Phase Owner**: Blake (Backend Engineer)

**Blake**: Make these 50 tests GREEN. Good luck! 🚀
