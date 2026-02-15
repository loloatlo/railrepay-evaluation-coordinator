# TD-1: Test Specification Summary - BL-145 (TD-EVAL-COORDINATOR-001)

**Phase**: TD-1 (Test Specification)
**Agent**: Jessie (QA Engineer)
**Date**: 2026-02-15
**Status**: COMPLETE - Ready for handoff to Blake (Phase TD-2)

---

## Test Specification Overview

I have written **72 failing tests** across **4 test files** that comprehensively cover all 10 Acceptance Criteria for BL-145 (TD-EVAL-COORDINATOR-001: Add Kafka consumer infrastructure to evaluation-coordinator).

All tests are in the RED phase (failing because implementation doesn't exist yet). This is correct TDD workflow per ADR-014.

---

## Test Files Created

### 1. `/tests/unit/consumers/config.test.ts`
**Tests**: 15
**Coverage**: AC-6, AC-7, AC-10

**Test Breakdown**:
- AC-6 (Kafka env vars): 7 tests
  - Parse KAFKA_BROKERS as comma-separated list
  - Parse KAFKA_USERNAME
  - Parse KAFKA_PASSWORD
  - Use evaluation-coordinator-consumer-group as group ID
  - Default SSL to true
  - Set SSL to false when KAFKA_SSL_ENABLED=false
  - Default serviceName to evaluation-coordinator

- AC-7 (Graceful degradation): 6 tests
  - Throw ConsumerConfigError when KAFKA_BROKERS missing
  - Throw ConsumerConfigError when KAFKA_USERNAME missing
  - Throw ConsumerConfigError when KAFKA_PASSWORD missing
  - Throw ConsumerConfigError when KAFKA_GROUP_ID missing
  - List ALL missing variables in error message
  - Throw when env var is empty string
  - Throw when env var is whitespace only

- AC-10 (Consumer group ID): 1 test
  - Use exact group ID from KAFKA_GROUP_ID env var

### 2. `/tests/unit/consumers/event-consumer.test.ts`
**Tests**: 15
**Coverage**: AC-1, AC-2, AC-9

**Test Breakdown**:
- AC-1, AC-2 (Subscribe to both topics): 3 tests
  - Subscribe to delay.detected topic
  - Subscribe to delay.not-detected topic
  - Subscribe to BOTH topics

- Lifecycle management: 5 tests
  - Follow connect -> subscribe -> start lifecycle
  - Disconnect on stop
  - isRunning returns true after start
  - isRunning returns false after stop
  - Stats tracking via getStats

- Stats tracking: 3 tests
  - Return consumer stats via getStats
  - Track delay.detected handler stats
  - Track delay.not-detected handler stats

- AC-9 (Winston logger): 2 tests
  - Pass logger to KafkaConsumer
  - Log connection events with logger

- Error handling: 3 tests
  - Throw error if connection fails
  - Log error on connection failure
  - Graceful shutdown on disconnect failure

### 3. `/tests/unit/kafka/delay-detected-handler.test.ts`
**Tests**: 20
**Coverage**: AC-3, AC-4, AC-8, AC-9

**Test Breakdown**:
- AC-3 (Create workflow with INITIATED status): 3 tests
  - Create workflow with INITIATED status when delay detected
  - Create workflow when is_cancellation is true
  - Create workflow when delay_minutes exceeds threshold

- AC-4 (Correlation ID propagation): 5 tests
  - Extract correlation_id from payload
  - Propagate correlation_id to logs
  - Generate correlation_id if missing
  - Log warning when correlation_id missing
  - Verify all logs include correlation_id

- AC-8 (Idempotent processing): 5 tests
  - Skip if workflow exists with INITIATED status
  - Skip if workflow exists with IN_PROGRESS status
  - Skip if workflow exists with COMPLETED status
  - Skip if workflow exists with PARTIAL_SUCCESS status
  - Log at info level when duplicate detected

- AC-9 (Winston logger): 2 tests
  - Log workflow creation with winston-logger
  - Log errors with winston-logger

- Payload validation: 6 tests
  - Throw when journey_id missing
  - Throw when user_id missing
  - Throw when delay_minutes missing
  - Throw when is_cancellation missing
  - Throw when delay_minutes is not a number
  - Throw when is_cancellation is not a boolean

### 4. `/tests/unit/kafka/delay-not-detected-handler.test.ts`
**Tests**: 22
**Coverage**: AC-5, AC-4, AC-8, AC-9

**Test Breakdown**:
- AC-5 (Create workflow with COMPLETED + eligibility_result): 5 tests
  - Create workflow with COMPLETED status
  - Set eligibility_result with eligible=false
  - Handle reason=below_threshold
  - Handle reason=darwin_unavailable
  - Mark workflow as COMPLETED immediately

- AC-4 (Correlation ID propagation): 5 tests
  - Extract correlation_id from payload
  - Propagate correlation_id to logs
  - Generate correlation_id if missing
  - Log warning when correlation_id missing
  - Verify all logs include correlation_id

- AC-8 (Idempotent processing): 5 tests
  - Skip if workflow exists with INITIATED status
  - Skip if workflow exists with IN_PROGRESS status
  - Skip if workflow exists with COMPLETED status
  - Skip if workflow exists with PARTIAL_SUCCESS status
  - Log at info level when duplicate detected

- AC-9 (Winston logger): 2 tests
  - Log workflow creation with winston-logger
  - Log errors with winston-logger

- Payload validation: 6 tests
  - Throw when journey_id missing
  - Throw when user_id missing
  - Throw when reason missing
  - Throw when reason is not valid
  - Accept reason=below_threshold
  - Accept reason=darwin_unavailable

---

## Acceptance Criteria Coverage Matrix

| AC | Description | Test Files | Test Count |
|----|-------------|------------|------------|
| AC-1 | Kafka consumer subscribing to delay.detected | event-consumer.test.ts | 3 |
| AC-2 | Kafka consumer subscribing to delay.not-detected | event-consumer.test.ts | 3 |
| AC-3 | On delay.detected, create workflow with status=INITIATED | delay-detected-handler.test.ts | 3 |
| AC-4 | Extract correlation_id, propagate through calls/logs | delay-detected-handler.test.ts, delay-not-detected-handler.test.ts | 10 |
| AC-5 | On delay.not-detected, create workflow COMPLETED with eligibility_result | delay-not-detected-handler.test.ts | 5 |
| AC-6 | Kafka env vars configured | config.test.ts | 7 |
| AC-7 | Graceful degradation if Kafka config missing | config.test.ts | 7 |
| AC-8 | Idempotent processing (duplicate events ignored) | delay-detected-handler.test.ts, delay-not-detected-handler.test.ts | 10 |
| AC-9 | Uses @railrepay/winston-logger (no console.log) | event-consumer.test.ts, delay-detected-handler.test.ts, delay-not-detected-handler.test.ts | 6 |
| AC-10 | Consumer group ID: evaluation-coordinator-consumer-group | config.test.ts | 1 |

**Total Tests**: 72
**All ACs Covered**: ✅ Yes

---

## Test Execution Results (RED Phase Verification)

All test files fail correctly because implementation files don't exist yet:

```
❯ npm test -- tests/unit/consumers/config.test.ts
FAIL: Failed to load url ../../../src/consumers/config.js

❯ npm test -- tests/unit/consumers/event-consumer.test.ts
FAIL: Failed to load url ../../../src/consumers/event-consumer.js

❯ npm test -- tests/unit/kafka/delay-detected-handler.test.ts
FAIL: Failed to load url ../../../src/kafka/delay-detected-handler.js

❯ npm test -- tests/unit/kafka/delay-not-detected-handler.test.ts
FAIL: Failed to load url ../../../src/kafka/delay-not-detected-handler.js
```

**Status**: ✅ Tests are in RED phase (correct TDD workflow)
**No syntax errors**: ✅ All tests are syntactically correct
**Runnable**: ✅ Tests run and fail for the right reason (missing implementation)

---

## Test Quality Checklist

### TDD Compliance
- [x] Tests written BEFORE implementation (RED phase)
- [x] Tests fail for right reasons (missing implementation, not syntax errors)
- [x] Tests are runnable with `npm test`
- [x] Tests use Vitest (ADR-004), NOT Jest
- [x] All tests map to specific Acceptance Criteria

### Mocking Strategy
- [x] Interface-based mocking (mock WorkflowRepository, not DB queries)
- [x] Shared logger mock instance outside factory (guideline #11)
- [x] Mock @railrepay/kafka-client KafkaConsumer
- [x] No mocking of internal implementation details

### Test Naming & Documentation
- [x] Test names clearly describe behavior
- [x] AC numbers referenced in test comments
- [x] Test file headers document TDD workflow
- [x] Each test has single, specific assertion focus

### Coverage Expectations
- [x] Happy path tests (workflow creation)
- [x] Error cases (missing env vars, validation failures)
- [x] Edge cases (duplicate events, missing correlation_id)
- [x] Integration points (logger, repository, Kafka client)

---

## Package.json Updates

Updated `package.json` to add `@railrepay/kafka-client` dependency:

```json
"dependencies": {
  "@railrepay/kafka-client": "^1.0.0",
  // ... other dependencies
}
```

Blake will need to run `npm install` before implementation.

---

## Implementation Files Required (for Blake)

Blake must create these files to make tests pass:

### New Files
1. `src/consumers/config.ts` - Consumer configuration with env var parsing
2. `src/consumers/event-consumer.ts` - EventConsumer wrapper for KafkaConsumer
3. `src/kafka/delay-detected-handler.ts` - Handler for delay.detected events
4. `src/kafka/delay-not-detected-handler.ts` - Handler for delay.not-detected events

### Modified Files
5. `src/index.ts` - Add EventConsumer initialization + graceful shutdown
6. `package.json` - Already updated with @railrepay/kafka-client

---

## Reference Patterns

Blake should follow these patterns from delay-tracker:

1. **Config pattern**: `/services/delay-tracker/src/consumers/config.ts`
   - Required env vars: KAFKA_BROKERS, KAFKA_USERNAME, KAFKA_PASSWORD, KAFKA_GROUP_ID
   - Throw ConsumerConfigError with all missing vars listed
   - Parse KAFKA_BROKERS as comma-separated list
   - Default SSL to true

2. **EventConsumer pattern**: `/services/delay-tracker/src/consumers/event-consumer.ts`
   - Wrap KafkaConsumer from @railrepay/kafka-client
   - Subscribe to multiple topics in start()
   - Track stats per handler
   - Graceful shutdown in stop()

3. **Handler pattern**: `/services/delay-tracker/src/kafka/journey-confirmed-handler.ts`
   - Validate payload
   - Extract correlation_id
   - Check idempotency (getWorkflowByJourneyId)
   - Use winston-logger for all logging
   - Propagate correlation_id through all calls

---

## Blocking Rules for Blake (Test Lock Rule)

**Blake MUST NOT modify these test files.**

If Blake believes a test is wrong:
1. Blake hands back to Jessie with explanation
2. Jessie reviews and updates test if needed
3. Jessie re-hands off updated failing test

**Why**: The test IS the specification - changing it changes the requirement.

---

## Quality Gates for Phase TD-2 (Blake)

Before handing back to Jessie for TD-3 QA, Blake must verify:

- [ ] All 72 tests passing (GREEN)
- [ ] TypeScript compiles with no errors (`npm run build`)
- [ ] No console.log in new code
- [ ] @railrepay/kafka-client used (not raw kafkajs)
- [ ] @railrepay/winston-logger used in handlers
- [ ] Graceful degradation: service starts without Kafka config

---

## Handoff to Blake (Phase TD-2)

**Status**: ✅ READY FOR HANDOFF

**Context**: Failing tests exist for Kafka consumer infrastructure (BL-145). Blake makes them GREEN.

**Deliverables Required from Blake**:
- [ ] src/consumers/config.ts implemented
- [ ] src/consumers/event-consumer.ts implemented
- [ ] src/kafka/delay-detected-handler.ts implemented
- [ ] src/kafka/delay-not-detected-handler.ts implemented
- [ ] src/index.ts modified with consumer startup + shutdown
- [ ] All 72 tests passing

**Next Phase**: TD-2 (Implementation by Blake)

---

## Test Effectiveness Metrics (Recorded)

- `tests_written`: 72
- `tests_passing`: 0 (RED phase - correct)
- `ac_coverage`: 100% (all 10 ACs have tests)
- `test_files_created`: 4
- `package_updates`: 1 (@railrepay/kafka-client added)

---

**Jessie Sign-off**: Test specification complete. Ready for Blake (Phase TD-2).
