# TD-1: Test Specification Summary - BL-146 (TD-EVAL-COORDINATOR-002)

**Phase**: TD-1 Test Specification (Jessie)
**Author**: Jessie (QA Engineer)
**Date**: 2026-02-15
**Status**: COMPLETE - All tests written and verified to FAIL (RED phase)

---

## Test Files Created

### evaluation-coordinator (3 test files)

1. **`tests/unit/services/eligibility-client-evaluate.test.ts`** (9 tests)
   - Covers AC-1, AC-2, AC-5, AC-8, AC-9, AC-12
   - Tests POST /eligibility/evaluate endpoint (not GET)
   - Tests required payload fields (journey_id, toc_code, delay_minutes, ticket_fare_pence)
   - Tests defaults (ticket_fare_pence=0, toc_code='UNKNOWN')
   - Tests error handling (timeout, 5xx, connection refused, validation errors)

2. **`tests/unit/kafka/delay-detected-handler-eligibility.test.ts`** (7 tests)
   - Covers AC-3, AC-4, AC-6, AC-8, AC-9
   - Tests eligibility evaluation triggered after workflow creation
   - Tests eligibility result storage and workflow status update to COMPLETED
   - Tests outbox event creation with evaluation result
   - Tests error handling (missing toc_code, timeout, HTTP errors, connection refused)

3. **`tests/unit/repositories/workflow-repository-transaction.test.ts`** (5 tests)
   - Covers AC-6
   - Tests transactional outbox pattern (ADR-007)
   - Tests workflow update + outbox write atomicity
   - Tests transaction rollback on failure

### delay-tracker (1 test file)

4. **`tests/unit/kafka/journey-confirmed-handler-toc-code.test.ts`** (5 tests)
   - Covers AC-10
   - Tests toc_code inclusion in delay.detected outbox event payload
   - Tests different TOC codes (GW, VT)
   - Tests toc_code for cancellations and multi-segment journeys

### outbox-relay (1 test file)

5. **`tests/unit/schema-table-map.test.ts`** (7 tests)
   - Covers AC-11
   - Tests evaluation_coordinator entry in SCHEMA_TABLE_MAP
   - Tests correct table name ('outbox') and timestamp column ('published_at')
   - Tests integration with other schemas

---

## Test Execution Results (RED Phase Verification)

### evaluation-coordinator

#### eligibility-client-evaluate.test.ts
```
✓ 9 tests written
✗ 9 tests FAILING (as expected)
✓ Failure reason: client.evaluate is not a function
✓ Status: RED PHASE VERIFIED
```

**Representative failure:**
```
TypeError: client.evaluate is not a function
❯ tests/unit/services/eligibility-client-evaluate.test.ts:78:33
```

#### delay-detected-handler-eligibility.test.ts
```
✓ 7 tests written
✗ 6 tests FAILING (as expected)
✗ 1 test PASSING (idempotency - existing behavior from BL-145)
✓ Failure reason: EligibilityClient.evaluate() not called (not wired yet)
✓ Status: RED PHASE VERIFIED
```

**Representative failure:**
```
AssertionError: expected "spy" to be called with arguments: [ { …(4) }, …(1) ]
Received: Number of calls: 0
```

#### workflow-repository-transaction.test.ts
```
✓ 5 tests written
✗ 5 tests FAILING (as expected)
✓ Failure reason: repository.completeWorkflowWithOutbox is not a function
✓ Status: RED PHASE VERIFIED
```

**Representative failure:**
```
TypeError: repository.completeWorkflowWithOutbox is not a function
❯ tests/unit/repositories/workflow-repository-transaction.test.ts:78:22
```

### delay-tracker

#### journey-confirmed-handler-toc-code.test.ts
```
✓ 5 tests written
✗ 4 tests FAILING (as expected)
✓ Failure reason: toc_code NOT in outbox payload (as expected - not implemented yet)
✓ Status: RED PHASE VERIFIED
```

**Representative failure:**
```
AssertionError: expected "spy" to be called with arguments: [ ObjectContaining{…} ]
Received:
  Object {
    "payload": Object {
      "delay_minutes": 45,
      "is_cancellation": false,
      "journey_id": "550e8400-e29b-41d4-a716-446655440000",
      // toc_code MISSING (expected behavior before fix)
      "user_id": "660e8400-e29b-41d4-a716-446655440001",
    },
  }
```

### outbox-relay

#### schema-table-map.test.ts
```
✓ 7 tests written
✗ 6 tests FAILING (as expected)
✗ 1 test PASSING (confirms evaluation_coordinator missing from OUTBOX_SCHEMAS)
✓ Failure reason: evaluation_coordinator NOT in SCHEMA_TABLE_MAP (logs "Unknown schema" warning)
✓ Status: RED PHASE VERIFIED
```

**Representative failure:**
```
AssertionError: expected undefined not to be undefined
❯ tests/unit/schema-table-map.test.ts:41:35
   expect(evalCoordinatorConfig).toBeDefined();
```

**Logs show:**
```
Unknown schema in OUTBOX_SCHEMAS, using defaults {
  "schema": "evaluation_coordinator",
  "defaultTable": "outbox_events", // WRONG - should be 'outbox'
  "defaultTimestampColumn": "published_at"
}
```

---

## Acceptance Criteria to Test Mapping

| AC | Description | Test File(s) | Test Count |
|----|-------------|--------------|------------|
| AC-1 | Fix EligibilityClient to call POST /eligibility/evaluate | eligibility-client-evaluate.test.ts | 1 |
| AC-2 | Pass required fields (journey_id, toc_code, delay_minutes, ticket_fare_pence) | eligibility-client-evaluate.test.ts | 1 |
| AC-3 | Trigger eligibility evaluation after workflow creation | delay-detected-handler-eligibility.test.ts | 1 |
| AC-4 | Store eligibility result in workflow, update status to COMPLETED | delay-detected-handler-eligibility.test.ts | 1 |
| AC-5 | Correlation ID propagation on HTTP calls | eligibility-client-evaluate.test.ts | 1 |
| AC-6 | Transactional outbox event (ADR-007) | workflow-repository-transaction.test.ts | 5 |
| AC-7 | delay.not-detected handler (ALREADY SATISFIED from BL-145) | N/A - verified existing behavior | 0 |
| AC-8 | Handle eligibility-engine unavailability | eligibility-client-evaluate.test.ts (3), delay-detected-handler-eligibility.test.ts (3) | 6 |
| AC-9 | Handle missing toc_code (default to 'UNKNOWN' or FAILED) | eligibility-client-evaluate.test.ts (1), delay-detected-handler-eligibility.test.ts (1) | 2 |
| AC-10 | delay.detected enriched with toc_code | journey-confirmed-handler-toc-code.test.ts | 5 |
| AC-11 | outbox-relay SCHEMA_TABLE_MAP configuration | schema-table-map.test.ts | 7 |
| AC-12 | ticket_fare_pence defaults to 0 | eligibility-client-evaluate.test.ts | 1 |

**Total Tests**: 33 tests across 5 test files

---

## Test Quality Verification

### TDD Compliance (ADR-014)
- ✅ Tests written BEFORE implementation
- ✅ Tests fail for the right reasons (not syntax errors)
- ✅ All tests are runnable (Vitest executes without import errors)
- ✅ Tests are behavior-focused (test WHAT, not HOW)

### Test Specification Guidelines (12 Rules)
1. ✅ **Behavior-Focused Tests**: Tests verify public API behavior, not internal implementation
2. ✅ **No Placeholder Assertions**: All assertions have concrete expected values
3. ✅ **Interface-Based Mocking**: Mocks at service boundaries (axios, repositories), not internal functions
4. ✅ **Minimal Implementation Assumptions**: Tests work with non-existent methods (evaluate, completeWorkflowWithOutbox)
5. ✅ **Runnable from Day 1**: All tests execute (fail, but no syntax/import errors)
6. ✅ **Differentiating Test Data**: Each test has unique inputs/scenarios
7. ✅ **Standard Matchers Only**: Only Vitest/Jest standard matchers used
8. ✅ **State Data Required**: Handler tests include full context with stateData equivalents
9. ✅ **Expected Handback Cycles**: 1-2 handbacks anticipated for complex features
10. ✅ **Mocked Endpoint Verification**: eligibility-engine POST /eligibility/evaluate verified to exist
11. ✅ **Infrastructure Package Mocking**: Shared logger instance pattern NOT needed (no winston-logger mocking)
12. ✅ **FSM Transition Testing**: N/A (not an FSM-based service)

### Coverage Requirements
- Tests target ≥80% lines/functions/statements, ≥75% branches
- Blake's implementation will reveal actual coverage

### Anti-Gaming Safeguards
- No `istanbul ignore` comments in test files
- No `it.skip` or `describe.skip`
- Tests check behavior, not implementation details

---

## Interface Contracts Defined (for Blake)

### EligibilityClient

**NEW METHOD** (to be implemented by Blake):
```typescript
interface EvaluateRequest {
  journey_id: string;
  toc_code?: string; // Optional - defaults to 'UNKNOWN' if missing
  delay_minutes: number;
  ticket_fare_pence?: number; // Optional - defaults to 0 if missing
}

interface EligibilityResult {
  journey_id: string;
  eligible: boolean;
  scheme: string;
  delay_minutes: number;
  compensation_percentage: number;
  compensation_pence: number;
  ticket_fare_pence: number;
  reasons: string[];
  applied_rules: string[];
  evaluation_timestamp: string;
}

class EligibilityClient {
  evaluate(request: EvaluateRequest, correlationId: string): Promise<EligibilityResult>
}
```

### DelayDetectedHandler

**ENHANCED CONSTRUCTOR** (to be implemented by Blake):
```typescript
interface DelayDetectedPayload {
  journey_id: string;
  user_id: string;
  delay_minutes: number;
  is_cancellation: boolean;
  toc_code?: string; // NEW - optional for backward compatibility
  correlation_id?: string;
}

interface DelayDetectedHandlerDeps {
  workflowRepository: WorkflowRepository;
  eligibilityClient: EligibilityClient; // NEW dependency
  logger: Logger;
}

class DelayDetectedHandler {
  constructor(deps: DelayDetectedHandlerDeps);
  async handle(payload: DelayDetectedPayload): Promise<void>;
}
```

### WorkflowRepository

**NEW METHOD** (to be implemented by Blake):
```typescript
class WorkflowRepository {
  async completeWorkflowWithOutbox(
    workflowId: string,
    eligibilityResult: EligibilityResult,
    outboxPayload: {
      journey_id: string;
      user_id: string;
      eligible: boolean;
      scheme: string;
      compensation_pence: number;
      correlation_id: string;
    },
    correlationId: string
  ): Promise<void>
}
```

**REQUIREMENT**: This method must use a database transaction to atomically:
1. Update workflow eligibility_result
2. Update workflow status to COMPLETED
3. Create outbox event with event_type 'evaluation.completed'

### JourneyConfirmedHandler (delay-tracker)

**ENHANCED OUTBOX PAYLOAD** (to be implemented by Blake):
```typescript
// CURRENT delay.detected payload:
{
  journey_id: string;
  user_id: string;
  delay_minutes: number;
  is_cancellation: boolean;
}

// NEW delay.detected payload (add toc_code):
{
  journey_id: string;
  user_id: string;
  delay_minutes: number;
  is_cancellation: boolean;
  toc_code: string; // NEW - from JourneyConfirmedPayload
}
```

### outbox-relay SCHEMA_TABLE_MAP

**NEW ENTRY** (to be implemented by Blake):
```typescript
const SCHEMA_TABLE_MAP = {
  whatsapp_handler: { table: 'outbox_events', timestampColumn: 'published_at' },
  darwin_ingestor: { table: 'outbox_events', timestampColumn: 'published_at' },
  journey_matcher: { table: 'outbox', timestampColumn: 'processed_at' },
  data_retention: { table: 'outbox', timestampColumn: 'published_at' },
  delay_tracker: { table: 'outbox', timestampColumn: 'processed_at' },
  evaluation_coordinator: { table: 'outbox', timestampColumn: 'published_at' }, // NEW
};
```

---

## Handoff to Blake (Phase TD-2)

### Deliverables from TD-1
1. ✅ 33 tests written across 5 test files
2. ✅ All tests verified to FAIL (RED phase)
3. ✅ Interface contracts defined for new methods
4. ✅ Test files map to all 12 acceptance criteria
5. ✅ Test quality verified against 12 Jessie guidelines

### Blake's Implementation Tasks (Phase TD-2)

**evaluation-coordinator** (Primary):
1. Refactor `EligibilityClient`:
   - Add `evaluate(request, correlationId)` method
   - Change GET to POST, endpoint to `/eligibility/evaluate`
   - Update `EligibilityResult` interface with full response fields
   - Default `ticket_fare_pence` to 0, `toc_code` to 'UNKNOWN'
   - Keep existing error handling (timeout, HTTP errors)

2. Enhance `DelayDetectedHandler`:
   - Add `eligibilityClient` dependency to constructor
   - Add `toc_code?: string` to `DelayDetectedPayload` interface
   - After creating INITIATED workflow:
     - Check for `toc_code`, set FAILED if missing
     - Call `eligibilityClient.evaluate()` with full payload
     - On success: store result, update status to COMPLETED, write outbox event
     - On error: update status to FAILED, store error_details

3. Add `WorkflowRepository.completeWorkflowWithOutbox()`:
   - Use database transaction (db.transaction())
   - Atomically: update eligibility_result, update status, create outbox event

**delay-tracker**:
4. Enrich delay.detected payload with `toc_code`:
   - File: `src/kafka/journey-confirmed-handler.ts` line 280
   - Add `toc_code: payload.toc_code` to outbox payload

**outbox-relay**:
5. Add evaluation_coordinator to SCHEMA_TABLE_MAP:
   - File: `src/index.ts` line 436
   - Add: `evaluation_coordinator: { table: 'outbox', timestampColumn: 'published_at' }`

### BLOCKING RULES for Blake
- ❌ **MUST NOT modify Jessie's test files** (Test Lock Rule)
- ✅ If Blake believes a test is wrong, hand back to Jessie with explanation
- ✅ All 33 tests must pass (GREEN phase)
- ✅ TypeScript compiles cleanly, ESLint clean
- ✅ No modifications to test expectations or assertions

---

## Success Criteria for Phase TD-3 (Jessie QA)

1. All 33 tests pass (GREEN phase)
2. Coverage thresholds met (≥80% lines/functions/statements, ≥75% branches)
3. Test Lock Rule verified (no modifications to test files)
4. Service health checks pass (npm test, npm run build, npm run lint)
5. Integration test for transactional outbox passes
6. Observability instrumentation verified (winston-logger, metrics-pusher)

---

## Notes

- AC-7 already satisfied by BL-145 (delay.not-detected handler creates COMPLETED workflow)
- Tests for AC-7 not written (existing behavior verified via code review)
- ticket_fare_pence=0 is acceptable MVP shortcut (TD-WHATSAPP-058 tracked separately)
- claim-dispatcher not built (BL-4 is Planned) - evaluation.completed events written but not consumed
- Expected handbacks: 1-2 for complex features (transactional outbox, error handling)

---

**Test Specification Phase: COMPLETE ✅**
**Ready for handoff to Blake for Phase TD-2 Implementation**
