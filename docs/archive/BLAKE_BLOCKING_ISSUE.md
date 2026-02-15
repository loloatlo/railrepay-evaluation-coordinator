# Phase 3.2 Implementation - BLOCKING ISSUE

**Date**: 2026-01-18
**Phase**: 3.2 (Implementation)
**Agent**: Blake (Backend Engineer)
**Status**: 🔴 **BLOCKED - Schema/Test Mismatch**

---

## Issue Summary

**Tests expect `CLAIM_PENDING` status that doesn't exist in the approved schema CHECK constraint.**

### Evidence

1. **RFC-005** (Hoops' approved schema design):
   ```
   Line 90: CHECK constraint on status: status IN ('INITIATED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED')
   ```

2. **Migration** `1737187200000_initial-schema.js`:
   ```javascript
   check: "status IN ('INITIATED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED')",
   ```

3. **Jessie's Integration Tests** expect `CLAIM_PENDING`:
   ```javascript
   // tests/integration/evaluation-workflow-integration.test.ts:92
   expect(workflowResult.rows[0].status).toBe('CLAIM_PENDING');
   ```

4. **Database Rejects INSERT/UPDATE**:
   ```
   error: new row for relation "evaluation_workflows" violates check constraint "evaluation_workflows_status_check"
   ```

### Test Lock Rule Applies

**Per SOPs Rule #1 (Five Immutable Laws) - Law of Test Primacy**:
> Tests are written before implementation. Tests define the specification.

**Per CLAUDE.md - Test Lock Rule**:
> Blake MUST NOT modify Jessie's tests. If Blake believes a test is wrong, hand back to Jessie with explanation.

**Therefore**: I cannot modify the tests to use `IN_PROGRESS` instead of `CLAIM_PENDING`, even though the schema requires it.

---

## Impact

### Tests Blocked by This Issue

**Integration Tests** (5 failing):
1. `should create workflow, eligibility step, and outbox event for eligible journey`
2. `should update updated_at timestamp when workflow status changes`
3. `should prevent duplicate workflows for same journey_id`
4. `should create unpublished outbox event with correct structure`
5. `should query unpublished events efficiently using partial index`

**Unit Tests** (multiple):
- Any test asserting or updating to `CLAIM_PENDING` status

### Current Test Status

- **Passing**: 36 / 61 (59%)
- **Failing**: 25 / 61 (41%)
  - 5 integration tests (CLAIM_PENDING violations)
  - 20 unit tests (various issues including CLAIM_PENDING)

---

## Technical Analysis

### What `CLAIM_PENDING` Represents

When a journey is eligible for compensation:
1. Workflow creates `CLAIM_CREATION` step (PENDING status)
2. Workflow updates its own status to indicate "claim is being processed"
3. Outbox event published for claim-dispatcher service

### Semantic Equivalence

**RFC-005 Intent**: Use `IN_PROGRESS` to mean "workflow has active steps in progress"

**Test Intent**: Use `CLAIM_PENDING` to mean "claim submission has been triggered, awaiting claim-dispatcher"

These are **semantically equivalent** from a state machine perspective:
- Both indicate: "workflow is not yet COMPLETED"
- Both indicate: "further processing is happening"

The difference is **granularity**: `CLAIM_PENDING` is more specific about *what* is in progress.

### Why This Happened

**Phase 2** (Hoops - Schema Design):
- RFC-005 defined 5 statuses based on generic workflow states
- Schema enforced with CHECK constraint
- Migration GREEN (passed all Hoops' tests)

**Phase 3.1** (Jessie - Test Specification):
- Tests written based on business logic understanding
- Tests assume `CLAIM_PENDING` is a valid status
- Tests GREEN against in-memory mocks (no real DB constraints)

**Coordination Gap**: Jessie didn't verify tests against Hoops' actual schema constraints.

---

## Resolution Options

### Option 1: Jessie Updates Tests (RECOMMENDED)

**Action**: Jessie modifies tests to use `IN_PROGRESS` instead of `CLAIM_PENDING`

**Rationale**:
- Schema is source of truth (Phase 2 completed before Phase 3.1)
- RFC-005 is approved and documented
- `IN_PROGRESS` is semantically correct per RFC
- Minimal code changes required

**Impact**: ~10 test files need search-replace

**Pros**:
- Fastest resolution
- Respects phase ordering (schema before tests)
- No migration changes

**Cons**:
- Less specific status name
- Tests must be re-run

---

### Option 2: Hoops Adds CLAIM_PENDING to Schema

**Action**: Hoops creates new migration to add `CLAIM_PENDING` to CHECK constraint

**Rationale**:
- Tests represent business requirements
- More granular status improves observability
- Business logic benefits from explicit "claim pending" state

**Impact**: Requires new migration + RFC amendment

**Pros**:
- Tests don't need changes
- More descriptive status value
- Better business alignment

**Cons**:
- Requires Hoops to create new migration
- RFC-005 must be amended
- Delays Phase 3.2 completion
- Adds complexity to status enum

**Migration Required**:
```javascript
exports.up = async (pgm) => {
  pgm.sql(`
    ALTER TABLE evaluation_coordinator.evaluation_workflows
    DROP CONSTRAINT evaluation_workflows_status_check;
  `);

  pgm.sql(`
    ALTER TABLE evaluation_coordinator.evaluation_workflows
    ADD CONSTRAINT evaluation_workflows_status_check
    CHECK (status IN ('INITIATED', 'IN_PROGRESS', 'CLAIM_PENDING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'));
  `);
};
```

---

### Option 3: ADA Escalation (Human Decision)

**Action**: Quinn escalates to human for architectural decision

**Rationale**: This is a cross-phase coordination issue that impacts service semantics

**Pros**: Human makes final call on status naming
**Cons**: Slowest resolution

---

## Recommendation

**I recommend Option 1**: Jessie updates tests to use `IN_PROGRESS`.

**Reasoning**:
1. **Schema is source of truth** - RFC-005 was approved in Phase 2
2. **Semantic equivalence** - `IN_PROGRESS` accurately describes the state
3. **Fastest resolution** - Simple search-replace in tests
4. **Respects phase ordering** - Schema (Phase 2) before tests (Phase 3.1)

**If stakeholders want CLAIM_PENDING for business reasons**, then Option 2 (Hoops updates schema) is appropriate, but requires RFC amendment and new migration.

---

## Work Completed Despite Block

### ✅ Implemented Features

1. **Integration test support functions**:
   - `initiateEvaluationWorkflow()`
   - `processEligibilityCheck()`
   - `getWorkflowUpdatedAt()`
   - `updateWorkflowStatus()`
   - `createWorkflowStep()`
   - `deleteWorkflow()`
   - `initiateEvaluationWorkflowWithStepFailure()`

2. **NOT NULL payload handling**:
   - Workflow steps always created with payload (empty object for PENDING)
   - Prevents NULL constraint violations

3. **Transactional workflow deletion**:
   - CASCADE correctly deletes child workflow_steps

4. **Outbox event creation**:
   - Events created with `published = false`
   - Correct structure for transactional outbox pattern

### ✅ Passing Tests (36 / 61)

- Health endpoint tests
- Migration schema tests
- Foreign key constraint tests
- Cascade delete tests
- Concurrent workflow handling tests
- Transactional rollback tests

### ❌ Blocked Tests (25 / 61)

- 5 integration tests (CLAIM_PENDING constraint violations)
- 20 unit tests (various issues + CLAIM_PENDING references)

---

## Next Steps

**BLOCKING**: Cannot proceed with Phase 3.2 until schema/test mismatch is resolved.

**Required Decision**:
1. Jessie updates tests to use `IN_PROGRESS` (recommended), OR
2. Hoops adds `CLAIM_PENDING` to schema CHECK constraint, OR
3. Quinn escalates to human for architectural decision

**Once Resolved**:
- Blake completes Phase 3.2 implementation
- All 61 tests pass
- Hand off to Jessie for Phase 4 QA verification

---

## Files Modified (So Far)

- `src/index.ts` - Added integration test exports
- `src/repositories/workflow-repository.ts` - Fixed NULL payload handling
- All changes respect Test Lock Rule (no test modifications)

---

**Awaiting Resolution**
**Blake (Backend Engineer)**
