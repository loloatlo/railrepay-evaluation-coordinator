# Blocking Issues Requiring Jessie's Attention

**Service**: evaluation-coordinator
**Blake Phase**: 3.2 Implementation (BLOCKED)
**Date**: 2026-01-19

## Issue 1: TypeScript Compilation Errors in Test Files (CRITICAL)

The test files have TypeScript compilation errors that prevent `npm run build` from succeeding.

### Root Cause

The Testcontainers API returns `StartedPostgreSqlContainer` after `.start()`, but test files declare the variable type as `PostgreSqlContainer`.

### Files Affected

All integration test files have this pattern:

```typescript
// Current (INCORRECT):
let container: PostgreSqlContainer;  // ❌ Wrong type

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('test')
    .start();  // Returns StartedPostgreSqlContainer, not PostgreSqlContainer
});
```

**Affected Files:**
- `tests/integration/evaluation-workflow-integration.test.ts` (line 38)
- `tests/integration/evaluation-workflow-http-integration.test.ts` (line 38)
- `tests/integration/migrations.test.ts` (line 38)

### Required Fix

Change type annotation from `PostgreSqlContainer` to `StartedPostgreSqlContainer`:

```typescript
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// CORRECT:
let container: StartedPostgreSqlContainer;  // ✅ Correct type
```

### Why Blake Cannot Fix This

Per the **Test Lock Rule** (SOPs), Blake MUST NOT modify Jessie's test files. All test files are owned by Jessie and only Jessie can update them.

---

## Issue 2: Branch Coverage 73.52% (Need ≥75%)

`eligibility-client.ts` has 42.85% branch coverage.

### Root Cause

**The `EligibilityClient` class is never actually used or tested.**

### Evidence

**File: `src/services/eligibility-client.ts`**
- Lines 14-80: Complete `EligibilityClient` class with error handling
- Imported in `src/index.ts` line 14
- **NEVER INSTANTIATED OR CALLED**

**File: `src/index.ts`**
- Line 78-150: `checkEligibility` function for unit tests
- Uses **mocked HTTP client** passed as parameter
- Does NOT use the `EligibilityClient` class

**File: `tests/unit/evaluation-workflow.test.ts`**
- Tests the `checkEligibility` function with mocked HTTP client
- Does NOT test the real `EligibilityClient` class
- Mock uses `httpClient.post()` but `EligibilityClient` uses `axios.get()` - API mismatch

### The Problem

There are TWO separate implementations:

1. **Production code** (never tested):
   - `EligibilityClient` class with real axios.get() calls
   - Has error handling for timeout, HTTP errors, network errors
   - Lines 46-78 have branches that are NEVER exercised

2. **Test code** (what's being tested):
   - `checkEligibility` function with injected mock HTTP client
   - Uses `httpClient.post()` (not axios.get)
   - Tests pass, but don't test the real production code

### Why This Causes Low Coverage

Coverage tools see the `EligibilityClient` class branches but no tests exercise them:

```typescript
// These branches in eligibility-client.ts are NEVER hit:
if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') {  // ❌ Never tested
  // ...
}

if (axiosError.response) {  // ❌ Never tested
  // ...
}
```

The unit tests mock `httpClient.post()` instead of testing the real `EligibilityClient.checkEligibility()` method.

### Required Fix (Jessie's Decision)

**Option 1: Test the Real EligibilityClient**
- Write unit tests that instantiate `EligibilityClient`
- Mock axios (not the HTTP client parameter)
- Test all error branches in the actual class
- Example:
  ```typescript
  import { EligibilityClient } from '../../src/services/eligibility-client.js';
  import axios from 'axios';
  vi.mock('axios');

  it('should handle timeout error', async () => {
    vi.mocked(axios.get).mockRejectedValue({ code: 'ETIMEDOUT' });
    const client = new EligibilityClient();
    await expect(client.checkEligibility('journey-1', 'corr-1'))
      .rejects.toThrow('TIMEOUT');
  });
  ```

**Option 2: Remove Unused EligibilityClient Class**
- If the mocked `checkEligibility` function is the intended design
- Delete the unused `EligibilityClient` class
- Update imports

**Option 3: Integration Tests Only**
- Accept unit test coverage gap
- Rely on integration tests with real HTTP calls
- Document decision in ADR

### Why Blake Cannot Fix This

This is a **test specification decision**. Blake cannot:
- Modify Jessie's existing tests (Test Lock Rule)
- Add new test files (Jessie owns Phase 3.1 test specification)
- Delete production code without test coverage justification

Jessie must decide:
1. Should `EligibilityClient` be tested?
2. Should `checkEligibility` use `EligibilityClient` instead of mocked HTTP client?
3. Should we delete unused code?

---

## Issue 3: TypeScript Error in db.ts (FIXED)

**Status**: ✅ RESOLVED by Blake

**File**: `src/lib/db.ts`

**Error**: `connectionString` does not exist in `PostgresConfig`

**Fix Applied**:
```typescript
// Before:
new PostgresClient({
  connectionString: process.env.DATABASE_URL,  // ❌ Invalid property
  // ...
});

// After:
new PostgresClient({
  serviceName: 'evaluation-coordinator',
  schemaName: 'evaluation_coordinator',
  // PostgresClient reads from PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD env vars
});
```

---

## Recommended Actions

### For Jessie (IMMEDIATE)

1. **Fix TypeScript errors in test files** (Issue 1)
   - Update type annotations: `PostgreSqlContainer` → `StartedPostgreSqlContainer`
   - Files: All 3 integration test files

2. **Decide on EligibilityClient testing strategy** (Issue 2)
   - Option A: Write tests for `EligibilityClient` class
   - Option B: Delete unused `EligibilityClient` class
   - Option C: Document as accepted coverage gap

3. **Hand back to Blake** after test files are fixed

### For Blake (AFTER Jessie's Fixes)

1. Verify TypeScript compilation succeeds: `npm run build`
2. Run tests with coverage: `npm run test:coverage`
3. Implement any additional code changes needed to pass Jessie's updated tests
4. Re-submit to Jessie for Phase 4 QA

---

## Test Lock Rule Compliance

Blake has NOT modified any of Jessie's test files per the Test Lock Rule. All test file issues are documented here for Jessie to address.

**Files Blake Modified** (implementation only):
- ✅ `src/lib/db.ts` - Fixed PostgresClient configuration

**Files Blake Did NOT Modify** (Jessie's tests):
- ❌ `tests/integration/evaluation-workflow-integration.test.ts`
- ❌ `tests/integration/evaluation-workflow-http-integration.test.ts`
- ❌ `tests/integration/migrations.test.ts`
- ❌ `tests/unit/evaluation-workflow.test.ts`

---

## Summary

**Blake's Phase 3.2 Implementation is BLOCKED** pending Jessie's test file corrections.

The primary blocker is Issue 1 (TypeScript compilation errors in test files). Issue 2 (branch coverage) requires Jessie's architectural decision on testing strategy.

Blake cannot proceed without:
1. Test files that compile successfully
2. Clear specification on whether `EligibilityClient` should be tested or deleted
