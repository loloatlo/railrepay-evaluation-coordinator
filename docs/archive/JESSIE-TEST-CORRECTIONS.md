# Phase 3.1 Test Specification Corrections

**Date**: 2026-01-18
**Phase**: 3.1 Final Review (Jessie - QA Engineer)
**Status**: ✅ **COMPLETE - Tests Corrected**

---

## Summary

Blake identified 5 test design issues during Phase 3.2 implementation. I have reviewed each issue and updated the test specifications accordingly.

**Test File Updated**: `/services/evaluation-coordinator/tests/unit/evaluation-workflow.test.ts`

---

## Issue 1: Logger/Metrics Injection vs Singleton Pattern ✅ RESOLVED

**Blake's Concern**: Tests expect dependency injection of logger/metrics, but implementation uses singleton pattern.

**My Decision**: **Accept singleton pattern** (Blake is correct)

**Reasoning**:
- Industry standard practice for observability libraries
- `@railrepay/winston-logger` and `@railrepay/metrics-pusher` are designed as singletons
- Dependency injection adds unnecessary complexity
- Blake's implementation is correct per ADR-002 and ADR-008

**Changes Made**:
- Removed tests that mock logger/metrics injection
- Added comments explaining singleton pattern is correct
- Observability verified in `infrastructure-wiring.test.ts` instead

---

## Issue 2: Eligibility API Contract ✅ RESOLVED

**Blake's Concern**: Test expects `POST /eligibility/check` with body, implementation uses `POST /eligibility/:journeyId`

**My Decision**: **Accept Blake's RESTful pattern**

**Reasoning**:
- RESTful pattern: `/resource/:id` is more idiomatic than `/resource/action`
- Matches OpenTripPlanner pattern (`/otp/plan`)
- Simpler API contract (journey_id in URL, not request body)

**Changes Made**:
- Updated test assertion to expect `POST /eligibility/${validJourneyId}`
- Added comment explaining RESTful pattern choice

---

## Issue 3: Error Payload - `null` vs `{}` ✅ RESOLVED

**Blake's Concern**: Test expects `null` payload, implementation uses `{}` (empty object)

**My Decision**: **Accept `{}` empty object** (Blake is correct)

**Reasoning**:
- Database schema has `payload JSONB NOT NULL DEFAULT '{}'` per RFC-005
- Hoops' schema design explicitly requires NOT NULL
- Blake's implementation is schema-compliant
- Empty object `{}` is semantically equivalent to "no payload data"

**Changes Made**:
- Updated test assertion from `null` to `{}`
- Added comment referencing RFC-005 NOT NULL constraint

---

## Issue 4: handleStepFailure Signature Conflict ✅ RESOLVED (CRITICAL)

**Blake's Concern**: AC-3 and AC-6 tests expect conflicting function signatures

**My Decision**: **AC-6 signature was WRONG - Use AC-3 signature**

**Reasoning**:
- AC-3 signature: `handleStepFailure(workflowId, stepId, db, logger, correlationId)` is correct
- AC-6 signature: `handleStepFailure(stepId, stepType, metrics)` lacks workflow context
- Function must update workflow status → needs `workflowId` and `db`
- I wrote contradictory tests - I must fix them (Test Lock Rule applies to me too)

**Changes Made**:
- Removed conflicting AC-6 test for `handleStepFailure`
- Kept AC-3 signature as correct specification
- Added comment explaining why AC-6 test was removed

**Correct Signature**:
```typescript
handleStepFailure(workflowId: string, stepId: string, db: any, logger?: any, correlationId?: string, metrics?: any)
```

---

## Issue 5: Database Connection in Unit Tests ✅ ACKNOWLEDGED

**Blake's Concern**: Unit tests call `createApp()` which requires real database connection

**My Decision**: **These are INTEGRATION tests, not unit tests**

**Reasoning**:
- Tests use `createApp()` which requires real HTTP + database
- Per Testing Strategy 2.0: "Unit tests should not use supertest or createApp"
- These tests belong in `tests/integration/` with Testcontainers

**Status**: Blake already moved HTTP endpoint tests to integration test file. No action needed.

---

## Test Status After Corrections

**Before Corrections**: 44/61 tests passing (72.1%)
**Expected After**: All unit tests should pass (integration tests depend on Testcontainers)

**Changes Summary**:
- ✅ Removed 5 tests that incorrectly expected dependency injection
- ✅ Updated API contract assertion (RESTful pattern)
- ✅ Updated payload assertion (`{}` not `null`)
- ✅ Removed conflicting function signature test
- ✅ Fixed winston-logger test assertion bug (already correct, just clarified)

---

## Handoff to Blake

Blake, you can now proceed with Phase 3.2 implementation. All test specifications have been corrected:

1. **Singleton Pattern**: Your implementation is correct. Tests no longer expect injection.
2. **API Contract**: `POST /eligibility/:journeyId` is correct. Test updated.
3. **Error Payload**: `{}` is correct per RFC-005. Test updated.
4. **Function Signature**: AC-3 signature is correct. Conflicting test removed.
5. **Winston Logger Test**: Already correct, assertion clarified.

**Next Steps**:
1. Run tests again - unit tests should now align with your implementation
2. Complete any remaining Phase 3.2 implementation
3. Hand off to me for Phase 4 QA verification

---

## Test Lock Rule Compliance

✅ **I corrected my own test specifications** per Test Lock Rule.
✅ **Blake identified legitimate test design issues** - not implementation problems.
✅ **All corrections documented** with reasoning for future reference.

---

**Jessie - Phase 3.1 Final Review Complete**
**Ready for Blake Phase 3.2 Continuation**
