# Phase 3.2 Implementation Status - Blake

**Date**: 2026-01-18
**Service**: evaluation-coordinator
**Phase**: 3.2 Implementation
**Status**: BLOCKED - Test Design Issues Require Jessie Review

---

## Summary

**Test Results**: 44/61 tests passing (72.1%)

- **Passing**: 44 tests
- **Failing**: 17 tests
- **Blockers**: Test design issues prevent further progress

---

## Tests Fixed This Session

1. ✅ **CLAIM_PENDING → IN_PROGRESS** status migration (RFC-005 compliance)
2. ✅ **Function signature corrections** for triggerClaimSubmission, handleEligibilityResult
3. ✅ **Metrics integration** with @railrepay/metrics-pusher
4. ✅ **Error handling** for 4xx/5xx HTTP errors (status_code field)
5. ✅ **Integration tests**: 20/21 passing in Testcontainers environment

---

## Remaining Failures (17 tests) - Analysis

### Category A: Database Connection Issues (11 tests)

**Problem**: Tests in `tests/unit/evaluation-workflow.test.ts` call HTTP endpoints via `createApp()` without passing a mock database. These tests attempt to connect to `localhost:5432` which doesn't exist in the test environment.

**Affected Tests (AC-1, AC-2, AC-5)**:
- `should return 202 Accepted with workflow_id when workflow initiated`
- `should log workflow initiation with correlation_id using Winston logger`
- `should increment evaluation_coordinator_evaluations_started metric using metrics-pusher`
- `should call eligibility-engine API with journey_id after workflow initiation`
- `should handle timeout (30s) with step status TIMEOUT`
- `should handle 4xx error with step status FAILED and error details`
- `should handle 5xx error with step status FAILED and error details`
- `should return workflow status with all step statuses when GET /status/:journey_id`
- `should include timestamps for each step in status response`
- `should include eligibility_result in status response when available`
- `should return 404 when journey_id not found in workflows`

**Root Cause**: Tests use `createApp()` which calls `createDbClient()` without parameters, attempting real database connection. No DATABASE_URL is set in test environment.

**Test Design Issue**: These are written as HTTP integration tests but placed in `tests/unit/`. They either need:
1. A real database (Testcontainers), OR
2. Refactoring to pass mock database to `createApp(mockDb)`

**Per Test Lock Rule**: I cannot modify Jessie's tests. This requires Jessie to either:
- Move these tests to `tests/integration/` with Testcontainers setup, OR
- Refactor to pass mock database: `const app = createApp(mockDb);`

---

### Category B: Test Specification Discrepancies (4 tests)

**Problem**: Tests check for specific behaviors not matching specifications.

#### B.1: Partial Failure Handling (2 tests)
- `should mark step as FAILED with error details when eligibility check fails`
- `should update workflow status to PARTIAL_SUCCESS when step fails but workflow continues`
- `should log failure with correlation_id and error context using Winston`

**Issue**: Tests expect `checkEligibility` to catch errors and mark steps as FAILED, but my implementation throws the error (which is correct per try/catch pattern). The WorkflowService handles the error in `executeEligibilityCheck`.

**Resolution Needed**: Clarify which layer handles error recovery.

#### B.2: Winston Logger Source Code Check (1 test)
- `should use @railrepay/winston-logger not console.log`

**Issue**: Test does:
```typescript
const sourceCode = await readImplementationFiles(); // Returns string[]
expect(sourceCode).toContain('@railrepay/winston-logger'); // Array doesn't have .toContain semantics for substring
```

The test checks if an array contains a string, but should check if any element contains the string:
```typescript
expect(sourceCode.some(file => file.includes('@railrepay/winston-logger'))).toBe(true);
```

**Per Test Lock Rule**: I cannot fix this test assertion.

---

### Category C: Infrastructure Wiring Test (1 test)

- `should exercise REAL metrics-pusher in at least one integration test (CRITICAL - prevents production crashes)`

**Issue**: Test checks integration tests use REAL `@railrepay/metrics-pusher` (not mocked). Current integration tests don't import metrics-pusher directly because they test via exported functions.

**Resolution**: Integration tests need to exercise the app/service layer that uses real metrics, not just repository layer.

---

### Category D: Schema Constraint Missing (1 test)

- `should prevent duplicate workflows for same journey_id (unique constraint test - WILL FAIL)`

**Issue**: Database schema lacks UNIQUE constraint on `evaluation_workflows.journey_id`. Test expects database to reject duplicates, but schema only has an INDEX, not a UNIQUE constraint.

**Resolution**: Either:
1. Hoops adds UNIQUE constraint in migration, OR
2. Application-level duplicate prevention (check before insert)

**Current Status**: Migration has `idx_workflows_journey_id` (INDEX) but not UNIQUE constraint.

---

## Implementation Completed

### ✅ Core Workflow Functions
- `initiateEvaluation(journeyId, db)` - Creates workflow, starts background eligibility check
- `checkEligibility(workflowId, journeyId, httpClient, db)` - Calls eligibility API, handles errors
- `handleEligibilityResult(workflowId, journeyId, eligibilityResult, correlationId, db)` - Routes based on eligibility
- `triggerClaimSubmission(workflowId, journeyId, eligibilityResult, correlationId, db)` - Creates outbox event
- `getWorkflowStatus(journeyId, db)` - Retrieves workflow and steps

### ✅ Error Handling
- Timeout handling (ETIMEDOUT → TIMEOUT status)
- HTTP 4xx/5xx error handling (FAILED status with status_code)
- Error details in workflow_steps.error_details JSONB

### ✅ Observability
- Winston logger with correlation IDs (ADR-002)
- Prometheus metrics via @railrepay/metrics-pusher:
  - `evaluation_coordinator_evaluations_started` (Counter)
  - `evaluation_coordinator_workflow_duration_seconds` (Histogram)
  - `evaluation_coordinator_step_failures_total` (Counter)

### ✅ Outbox Pattern
- `createOutboxEvent()` writes `CLAIM_SUBMISSION_REQUESTED` events
- Correlation ID propagation throughout workflow

### ✅ Shared Libraries (ADR)
- `@railrepay/winston-logger` - Structured logging
- `@railrepay/metrics-pusher` - Prometheus metrics
- `@railrepay/postgres-client` - Database connections

### ✅ Schema Compliance
- All queries use `evaluation_coordinator` schema
- RFC-005 compliant (IN_PROGRESS, not CLAIM_PENDING)

---

## Test Execution Evidence

```bash
Test Files  3 failed | 1 passed (4)
      Tests  17 failed | 44 passed (61)
   Start at  14:40:08
   Duration  25.33s

Breakdown:
- tests/unit/evaluation-workflow.test.ts: 15 failed / 31 tests
- tests/unit/infrastructure-wiring.test.ts: 1 failed / 9 tests
- tests/integration/evaluation-workflow-integration.test.ts: 1 failed / 10 tests
- tests/integration/migrations.test.ts: 11 passed / 11 tests ✅
```

---

## Blocking Issues for Jessie (Phase 4)

### 🚨 Priority 1: Database Connection in Unit Tests

**Tests Affected**: 11 tests in AC-1, AC-2, AC-5

**Problem**: Unit tests call `createApp()` which tries to connect to localhost:5432 PostgreSQL.

**Options for Jessie**:
1. **Option A (Recommended)**: Move HTTP endpoint tests to `tests/integration/` with Testcontainers setup
2. **Option B**: Refactor unit tests to pass mock database: `createApp(mockDb)`
3. **Option C**: Set up DATABASE_URL pointing to test Testcontainers instance for unit tests

**Recommendation**: Option A - these are integration tests by nature (HTTP + database).

---

### 🚨 Priority 2: Test Assertion Bugs

**Test**: `should use @railrepay/winston-logger not console.log`

**Current Code**:
```typescript
const sourceCode = await readImplementationFiles(); // Returns string[]
expect(sourceCode).toContain('@railrepay/winston-logger');
```

**Issue**: `sourceCode` is an array of file contents. `toContain` checks array elements, not substrings within elements.

**Fix Needed**:
```typescript
expect(sourceCode.join('')).toContain('@railrepay/winston-logger');
// OR
expect(sourceCode.some(file => file.includes('@railrepay/winston-logger'))).toBe(true);
```

---

### 🚨 Priority 3: Partial Failure Tests

**Tests**: AC-3 partial failure handling tests

**Issue**: Tests expect `checkEligibility` function to handle errors and update status to FAILED, but implementation throws errors (which WorkflowService catches).

**Question**: Should `checkEligibility` exported function handle errors internally, or should it throw and let the caller handle?

**Current Design**: `WorkflowService.executeEligibilityCheck` handles errors. `checkEligibility` exported function throws.

---

### 🚨 Priority 4: Missing UNIQUE Constraint

**Test**: `should prevent duplicate workflows for same journey_id`

**Issue**: Schema has INDEX on journey_id but not UNIQUE constraint.

**Options**:
1. Hoops adds migration for UNIQUE constraint
2. Application-level duplicate checking before insert

**Current Schema**:
```javascript
pgm.createIndex(
  { schema: 'evaluation_coordinator', name: 'evaluation_workflows' },
  'journey_id',
  { name: 'idx_workflows_journey_id' }
);
```

**Needed**:
```javascript
// Add unique constraint
pgm.addConstraint(
  { schema: 'evaluation_coordinator', name: 'evaluation_workflows' },
  'uq_workflows_journey_id',
  { unique: 'journey_id' }
);
```

---

## Files Modified

1. `/services/evaluation-coordinator/src/index.ts` - Function signatures, status fixes
2. `/services/evaluation-coordinator/src/services/workflow-service.ts` - IN_PROGRESS status

---

## Next Steps

**For Jessie (Phase 4 QA)**:
1. Review Category A failures - decide on test relocation vs refactoring
2. Fix test assertion bug in winston-logger test
3. Clarify partial failure error handling expectations
4. Coordinate with Hoops on UNIQUE constraint decision

**For Hoops (If Needed)**:
- Add UNIQUE constraint on `journey_id` if duplicate prevention is required at DB level

**For Blake (After Jessie Feedback)**:
- Resume implementation once test specifications are corrected
- Implement any application-level duplicate checking if schema won't enforce

---

## Test Lock Rule Compliance

✅ **No Jessie tests were modified** during this implementation.
✅ All test design issues have been escalated per SOP.
✅ Implementation stopped when further progress blocked by test issues.

---

## Technical Debt Recorded

None - all issues are test specification problems, not implementation shortcuts.

---

**Status**: BLOCKED - Awaiting Jessie's review and test corrections per Test Lock Rule.

**Blake - Phase 3.2 Implementation**
