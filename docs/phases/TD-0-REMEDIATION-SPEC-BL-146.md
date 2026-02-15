# TD-0: Remediation Specification - BL-146 (TD-EVAL-COORDINATOR-002)

## Wire eligibility-engine HTTP call into delay event workflow

**Backlog Item**: BL-146 (TD-EVAL-COORDINATOR-002)
**Notion URL**: https://www.notion.so/308815ba72ee8173962ef36feb1f4a57
**Severity**: BLOCKING
**Status**: Proposed -> In Progress
**Date**: 2026-02-15
**Author**: Quinn (Orchestrator)

---

## 1. Business Context

BL-145 (TD-EVAL-COORDINATOR-001) added Kafka consumer infrastructure to evaluation-coordinator. The service now receives `delay.detected` and `delay.not-detected` events and creates evaluation workflows with status=INITIATED. However, the INITIATED workflows are never advanced -- no eligibility evaluation actually occurs.

**Pipeline Gap After BL-145**:
```
Step 14:  delay-tracker writes delay.detected to outbox (WORKS)
Step 14b: outbox-relay publishes delay.detected to Kafka (WORKS)
Step 15:  evaluation-coordinator consumes delay.detected, creates INITIATED workflow (WORKS - BL-145)
Step 16:  evaluation-coordinator calls eligibility-engine --> BROKEN (handler only creates workflow, never calls eligibility-engine)
```

**What BL-146 Fixes**: After a delay.detected event creates an INITIATED workflow, the handler will call eligibility-engine's `POST /eligibility/evaluate` with the correct payload, store the result, write an outbox event, and update the workflow to COMPLETED or FAILED.

**Source**: Notion System Index (2fa815ba-72ee-80d9-97e9-e16838db5b49), Eligibility & Compensation Domain (2fa815ba-72ee-80b1-ada9-f2b2d0088d14), Service Layer pages for evaluation-coordinator (300815ba-72ee-81d2-9159-ed332fd48a38) and eligibility-engine (300815ba-72ee-8121-8fc7-c00d9184b5a1)

---

## 2. Current Codebase Analysis

### 2.1 Critical Bug: EligibilityClient calls WRONG endpoint

**File**: `src/services/eligibility-client.ts` (line 24)

The current `EligibilityClient.checkEligibility()` makes a `GET /eligibility/${journeyId}` call. This is the **retrieval** endpoint on eligibility-engine (returns existing evaluation results). The correct endpoint for triggering an evaluation is `POST /eligibility/evaluate` with a JSON body.

```typescript
// CURRENT (WRONG):
const url = `${this.baseUrl}/eligibility/${journeyId}`;
const response = await axios.get(url, { ... });

// CORRECT:
const url = `${this.baseUrl}/eligibility/evaluate`;
const response = await axios.post(url, {
  journey_id, toc_code, delay_minutes, ticket_fare_pence
}, { headers: { 'X-Correlation-ID': correlationId } });
```

### 2.2 EligibilityClient only accepts journeyId

**File**: `src/services/eligibility-client.ts` (line 23)

The method signature is `checkEligibility(journeyId: string, correlationId: string)`. It needs to accept the full payload required by `POST /eligibility/evaluate`:
- `journey_id` (string, required)
- `toc_code` (string, required)
- `delay_minutes` (number, required)
- `ticket_fare_pence` (number, required)

### 2.3 EligibilityResult interface incomplete

**File**: `src/services/eligibility-client.ts` (lines 8-12)

The current interface only has `eligible`, `compensation_amount_gbp`, and `reason`. The actual eligibility-engine response includes:
- `journey_id`, `eligible`, `scheme`, `delay_minutes`
- `compensation_percentage`, `compensation_pence`, `ticket_fare_pence`
- `reasons` (array), `applied_rules` (array), `evaluation_timestamp`

### 2.4 DelayDetectedHandler creates workflow but never triggers evaluation

**File**: `src/kafka/delay-detected-handler.ts`

The handler creates a workflow with status=INITIATED and returns. It does not call `WorkflowService.initiateEvaluation()` or `EligibilityClient.checkEligibility()`. The gap: after creating the INITIATED workflow, the handler must invoke the eligibility check and process the result.

### 2.5 WorkflowService.initiateEvaluation() fires and forgets

**File**: `src/services/workflow-service.ts` (line 41)

The `executeEligibilityCheck()` call on line 41 is fire-and-forget (`.catch()` swallows errors). When triggered from Kafka events, the eligibility check should be awaited so that failures propagate and can be handled properly.

### 2.6 Outbox table exists but uses `published_at` timestamp column

**File**: `migrations/1737187200000_initial-schema.cjs` (line 214)

The `evaluation_coordinator.outbox` table uses `published_at` as the timestamp column (same as `whatsapp_handler`). The outbox-relay SCHEMA_TABLE_MAP needs `evaluation_coordinator` with `table: 'outbox'` and `timestampColumn: 'published_at'`.

### 2.7 delay.detected payload missing toc_code

**File**: `delay-tracker/src/kafka/journey-confirmed-handler.ts` (lines 274-285)

The `createDelayAlert()` method writes the `delay.detected` outbox event with only `{journey_id, user_id, delay_minutes, is_cancellation}`. The `toc_code` field is available in the `JourneyConfirmedPayload` (line 36: `toc_code: string`) but is NOT included in the outbox event payload.

### 2.8 ticket_fare_pence not available anywhere in pipeline

The `ticket_fare_pence` field is required by eligibility-engine but is not available in the delay.detected event, journey-matcher, or delay-tracker. This data comes from ticket scanning/manual entry (TD-WHATSAPP-058, not yet built). A default value of 0 must be used, resulting in `compensation_pence: 0` but still allowing eligibility determination.

---

## 3. Services Affected

| Service | Change Type | Description |
|---------|-------------|-------------|
| **evaluation-coordinator** | Primary target | Fix EligibilityClient, wire handler to eligibility check, outbox events |
| **delay-tracker** | Minor change | Add `toc_code` to `delay.detected` outbox event payload |
| **outbox-relay** | Config change | Add `evaluation_coordinator` to SCHEMA_TABLE_MAP |

---

## 4. Acceptance Criteria (Verified Against Codebase)

All 12 ACs from BL-146 Notion page, verified and refined against actual code:

### AC-1: Fix EligibilityClient to call POST /eligibility/evaluate
- **File**: `src/services/eligibility-client.ts`
- **Current**: `axios.get(\`/eligibility/${journeyId}\`)` (line 24, 33)
- **Required**: `axios.post(\`/eligibility/evaluate\`, { journey_id, toc_code, delay_minutes, ticket_fare_pence })`
- **Also**: Update `EligibilityResult` interface to match actual eligibility-engine response
- **Also**: Update method signature to accept full evaluation payload

### AC-2: Kafka consumer handler extracts required fields from delay.detected
- **File**: `src/kafka/delay-detected-handler.ts`
- **Current**: `DelayDetectedPayload` has `journey_id, user_id, delay_minutes, is_cancellation, correlation_id`
- **Required**: Add `toc_code` (optional string, may be missing from older events) to `DelayDetectedPayload` interface
- **Handler**: Extract `toc_code` from payload and pass to eligibility evaluation

### AC-3: Handler calls eligibility-engine via corrected EligibilityClient with X-Correlation-ID
- **File**: `src/kafka/delay-detected-handler.ts` and `src/services/eligibility-client.ts`
- **Current**: Handler only creates workflow, never calls eligibility-engine
- **Required**: After creating INITIATED workflow, call `EligibilityClient.evaluate()` with `{journey_id, toc_code, delay_minutes, ticket_fare_pence}` and `X-Correlation-ID` header
- **Note**: X-Correlation-ID header already present in current code (line 36) -- verify it is preserved in POST refactor

### AC-4: eligibility-engine response stored in workflow
- **File**: `src/repositories/workflow-repository.ts`
- **Current**: `updateWorkflowEligibilityResult()` method exists (line 104) but is only called from `delay-not-detected-handler`
- **Required**: After successful eligibility check, call `updateWorkflowEligibilityResult()` with the full response, update status to COMPLETED

### AC-5: Workflow status updated to COMPLETED or FAILED
- **File**: `src/repositories/workflow-repository.ts`
- **Current**: `updateWorkflowStatus()` method exists (line 88)
- **Required**: On success -> COMPLETED; on error/timeout -> FAILED (not PARTIAL_SUCCESS as current code does on line 136)
- **Rationale**: PARTIAL_SUCCESS suggests some steps succeeded. For a single-step evaluation, the only meaningful states are COMPLETED or FAILED.

### AC-6: Transactional outbox event for evaluation.completed
- **File**: `src/repositories/workflow-repository.ts`
- **Current**: `createOutboxEvent()` method exists (line 181), writes to `evaluation_coordinator.outbox` table
- **Required**: After eligibility result stored and workflow COMPLETED, write outbox event with event_type `evaluation.completed` and payload `{journey_id, user_id, eligible, scheme, compensation_pence, correlation_id}`
- **ADR-007**: Workflow update and outbox write MUST be in same transaction
- **Note**: Current `createOutboxEvent()` does NOT use a transaction. This needs to be refactored so that `updateWorkflowEligibilityResult()`, `updateWorkflowStatus()`, and `createOutboxEvent()` share a single transaction.

### AC-7: delay.not-detected handler creates COMPLETED workflow with eligibility_result
- **File**: `src/kafka/delay-not-detected-handler.ts`
- **Current**: Already implemented in BL-145 (creates workflow, updates status to COMPLETED, sets eligibility_result={eligible: false, reason})
- **Status**: ALREADY SATISFIED -- no change needed

### AC-8: Error handling for eligibility-engine errors
- **File**: `src/services/eligibility-client.ts`
- **Current**: Error handling exists (timeout, HTTP errors, network errors) in lines 46-78
- **Required**: When eligibility-engine returns error, workflow status set to FAILED, error_details stored in workflow_steps. Create workflow step with step_type='ELIGIBILITY_CHECK' and status='FAILED'.

### AC-9: Timeout handling (30s) for eligibility-engine call
- **File**: `src/services/eligibility-client.ts`
- **Current**: 30s timeout already configured (line 20: `this.timeout = 30000`)
- **Required**: On timeout, workflow status set to FAILED with error_details `{message: 'TIMEOUT', timeout_ms: 30000}`

### AC-10: delay.detected event enriched with toc_code (delay-tracker change)
- **File**: `delay-tracker/src/kafka/journey-confirmed-handler.ts` (lines 274-285)
- **Current**: `delay.detected` payload: `{journey_id, user_id, delay_minutes, is_cancellation}`
- **Required**: Add `toc_code: payload.toc_code` to the payload object (line 280)
- **Impact**: Small, surgical change to delay-tracker. The `toc_code` is already available in the `JourneyConfirmedPayload` (line 36).

### AC-11: outbox-relay SCHEMA_TABLE_MAP updated for evaluation_coordinator
- **File**: `outbox-relay/src/index.ts` (line 430)
- **Current**: Map has entries for `whatsapp_handler`, `darwin_ingestor`, `journey_matcher`, `data_retention`, `delay_tracker`
- **Required**: Add `evaluation_coordinator: { table: 'outbox', timestampColumn: 'published_at' }`
- **Why `published_at`**: The `evaluation_coordinator.outbox` table uses `published_at` column (migration line 214), same pattern as `whatsapp_handler`
- **Also requires**: Adding `evaluation_coordinator` to `OUTBOX_SCHEMAS` Railway environment variable

### AC-12: ticket_fare_pence defaults to 0 when unavailable
- **Required**: When `ticket_fare_pence` is not available (which is always, until TD-WHATSAPP-058), default to `0`
- **Impact**: eligibility-engine will determine eligibility (eligible: true/false) and compensation_percentage correctly, but `compensation_pence` will be 0
- **Note**: This is acceptable for MVP -- the eligibility determination is the critical path; compensation amount can be corrected later

---

## 5. Eligibility-Engine API Contract

### POST /eligibility/evaluate

**Request Body** (from `eligibility-engine/src/app.ts` lines 270-298):
```json
{
  "journey_id": "uuid",        // Required
  "toc_code": "XX",            // Required, max 5 chars
  "delay_minutes": 45,         // Required (or scheduled_arrival + actual_arrival)
  "ticket_fare_pence": 2500    // Required
}
```

**Validation Rules**:
- `journey_id` is required
- `toc_code` is required, max 5 characters
- `delay_minutes` is required (alternatively: `scheduled_arrival` AND `actual_arrival`)
- `ticket_fare_pence` is required (will be 0 as default per AC-12)

**Success Response** (200):
```json
{
  "journey_id": "uuid",
  "eligible": true,
  "scheme": "DR30",
  "delay_minutes": 45,
  "compensation_percentage": 50,
  "compensation_pence": 1250,
  "ticket_fare_pence": 2500,
  "reasons": ["Delay of 45 minutes qualifies for 50% refund under DR30 scheme"],
  "applied_rules": ["DR30_30MIN_50PCT"],
  "evaluation_timestamp": "2026-02-15T10:00:00.000Z"
}
```

**Error Responses**:
- 400: Validation error (missing/invalid fields, unknown TOC code)
- 500: Internal server error

**Idempotency**: If `journey_id` already has an evaluation, returns cached result (200).

---

## 6. Data Availability Problem: toc_code and ticket_fare_pence

### toc_code

**Problem**: `delay.detected` event payload does not include `toc_code`. eligibility-engine requires it.

**Solution (AC-10)**: Enrich `delay.detected` payload in delay-tracker. The `toc_code` is already available in the `JourneyConfirmedPayload` (the handler receives it from journey-matcher). Adding it to the outbox event payload is a one-line change at `delay-tracker/src/kafka/journey-confirmed-handler.ts` line 280.

**Fallback**: If `toc_code` is missing from older delay.detected events (published before the enrichment), evaluation-coordinator should log a warning and set workflow status to FAILED with reason `missing_toc_code`. This handles the transition period gracefully.

**Decision**: This is NOT an ADA-triggerable decision. The approach is straightforward and follows the existing pattern -- add data that the producer already has to the event payload.

### ticket_fare_pence

**Problem**: `ticket_fare_pence` is required by eligibility-engine but is not available anywhere in the current pipeline. This data comes from ticket scanning or manual entry (TD-WHATSAPP-058, not yet built).

**Solution (AC-12)**: Default to `0`. eligibility-engine will still correctly determine eligibility (eligible/ineligible) and the compensation percentage. The `compensation_pence` result will be `0`, but the actual compensation can be calculated later when fare data is available.

**Decision**: This is NOT an ADA-triggerable decision. Using a placeholder value for unavailable data is standard practice for incremental pipeline build-out. The BL-146 Notion page explicitly states this approach.

---

## 7. Schema Assessment: Is Hoops Needed? (Phase TD-0.5)

**Assessment: Hoops is NOT needed for BL-146.**

**Rationale**:
1. **evaluation_coordinator schema**: All required tables already exist (evaluation_workflows, workflow_steps, outbox) from the initial migration. No new columns or tables needed.
2. **delay_tracker schema**: No schema changes needed. The `toc_code` enrichment is a code change to the outbox event payload (JSON), not a schema change.
3. **outbox_relay**: No schema changes. The SCHEMA_TABLE_MAP is a code-level config, not a database change.
4. **No new migrations required**.

---

## 8. Cross-Service Coordination

BL-146 touches 3 services. The changes must be deployed in a specific order:

### Deployment Order

```
1. delay-tracker      (AC-10: toc_code enrichment in delay.detected payload)
2. outbox-relay       (AC-11: SCHEMA_TABLE_MAP + OUTBOX_SCHEMAS env var)
3. evaluation-coordinator (AC-1 through AC-9, AC-12: core wiring)
```

**Why this order**:
- delay-tracker must publish enriched events BEFORE evaluation-coordinator starts consuming them
- outbox-relay must be configured to poll `evaluation_coordinator.outbox` BEFORE evaluation-coordinator starts writing outbox events
- evaluation-coordinator can be deployed last since it is the consumer

### Service-to-Agent Mapping for Implementation

| Service | Files Changed | Agent |
|---------|---------------|-------|
| delay-tracker | `src/kafka/journey-confirmed-handler.ts` (1 line) | Blake |
| outbox-relay | `src/index.ts` (1 line SCHEMA_TABLE_MAP) | Blake |
| evaluation-coordinator | `src/services/eligibility-client.ts`, `src/kafka/delay-detected-handler.ts`, `src/services/workflow-service.ts`, `src/repositories/workflow-repository.ts` | Blake |

---

## 9. Detailed Implementation Plan

### 9.1 EligibilityClient Refactor (AC-1, AC-3, AC-12)

**File**: `src/services/eligibility-client.ts`

Changes:
1. Update `EligibilityResult` interface to match actual eligibility-engine response (add `scheme`, `delay_minutes`, `compensation_percentage`, `compensation_pence`, `ticket_fare_pence`, `reasons`, `applied_rules`, `evaluation_timestamp`)
2. Add `EvaluateRequest` interface: `{journey_id, toc_code, delay_minutes, ticket_fare_pence}`
3. Rename method from `checkEligibility(journeyId, correlationId)` to `evaluate(request: EvaluateRequest, correlationId: string)`
4. Change `axios.get` to `axios.post` with request body
5. Change URL from `/eligibility/${journeyId}` to `/eligibility/evaluate`
6. Keep existing error handling (timeout, HTTP errors)
7. Default `ticket_fare_pence` to `0` if not provided (AC-12)

### 9.2 DelayDetectedHandler Enhancement (AC-2, AC-3, AC-4, AC-5, AC-8, AC-9)

**File**: `src/kafka/delay-detected-handler.ts`

Changes:
1. Add `toc_code?: string` to `DelayDetectedPayload` interface
2. Add `EligibilityClient` as dependency (constructor injection)
3. After creating INITIATED workflow:
   a. Validate `toc_code` is present; if missing, set workflow to FAILED with reason `missing_toc_code`
   b. Call `eligibilityClient.evaluate({journey_id, toc_code, delay_minutes, ticket_fare_pence: 0}, correlationId)`
   c. On success: store result in workflow (eligibility_result), update status to COMPLETED, write outbox event
   d. On error/timeout: update workflow status to FAILED, store error_details in workflow_steps

### 9.3 WorkflowRepository Transaction Support (AC-6)

**File**: `src/repositories/workflow-repository.ts`

Changes:
1. Add `completeWorkflowWithOutbox(workflowId, eligibilityResult, outboxPayload, correlationId)` method
2. This method wraps `updateWorkflowEligibilityResult()`, `updateWorkflowStatus()`, and `createOutboxEvent()` in a single database transaction
3. ADR-007 compliance: workflow update and outbox event write must be atomic

### 9.4 delay-tracker toc_code Enrichment (AC-10)

**File**: `services/delay-tracker/src/kafka/journey-confirmed-handler.ts`

Change (1 line at line 280):
```typescript
// CURRENT payload (line 278-283):
payload: {
  journey_id: payload.journey_id,
  user_id: payload.user_id,
  delay_minutes: delayInfo.delay_minutes,
  is_cancellation: delayInfo.is_cancelled,
},

// ADD toc_code:
payload: {
  journey_id: payload.journey_id,
  user_id: payload.user_id,
  delay_minutes: delayInfo.delay_minutes,
  is_cancellation: delayInfo.is_cancelled,
  toc_code: payload.toc_code,
},
```

### 9.5 outbox-relay SCHEMA_TABLE_MAP (AC-11)

**File**: `services/outbox-relay/src/index.ts` (line 435)

Add after the `delay_tracker` entry:
```typescript
evaluation_coordinator: { table: 'outbox', timestampColumn: 'published_at' },
```

Also requires Moykle to add `evaluation_coordinator` to the `OUTBOX_SCHEMAS` environment variable in Railway.

---

## 10. ADR Applicability

| ADR | Applies | Notes |
|-----|---------|-------|
| ADR-001 Schema-per-service | Yes | evaluation_coordinator schema already exists |
| ADR-002 Winston Logger | Yes | Already implemented; correlation ID propagation in HTTP headers |
| ADR-003 Testcontainers | Yes | Integration tests with real PostgreSQL |
| ADR-004 Vitest | Yes | All tests use Vitest |
| ADR-005 Railway Direct Deploy | Yes | Commit to main, push, Railway auto-deploys |
| ADR-007 Transactional Outbox | Yes | evaluation.completed event via outbox; workflow update + outbox write must be transactional |
| ADR-008 Prometheus Metrics | Yes | Existing metrics preserved |
| ADR-010 Smoke Tests | No | Existing smoke tests sufficient |
| ADR-014 TDD | Yes | Always applies |
| ADR-018 Migration Isolation | N/A | No new migrations |

---

## 11. Verification Method

- **Unit tests**: Mock eligibility-engine HTTP calls, verify correct endpoint/payload/headers, verify error handling, verify workflow state transitions, verify outbox event creation
- **Integration tests**: Real PostgreSQL (Testcontainers), verify transactional outbox (workflow + outbox in same transaction), verify workflow state progression
- **Cross-service tests**: delay-tracker payload enrichment (unit test verifying toc_code in outbox payload)
- **outbox-relay tests**: SCHEMA_TABLE_MAP includes evaluation_coordinator entry
- **E2E verification**: delay.detected -> evaluation workflow COMPLETED -> eligibility_evaluations row created in eligibility-engine -> evaluation.completed outbox event written

---

## 12. Dependencies

| Dependency | Status | Impact |
|------------|--------|--------|
| BL-145 (TD-EVAL-COORDINATOR-001) | DONE | Kafka consumer exists, handlers create INITIATED workflows |
| delay-tracker toc_code enrichment | REQUIRED (AC-10) | Must deploy before evaluation-coordinator |
| outbox-relay SCHEMA_TABLE_MAP | REQUIRED (AC-11) | Must deploy before evaluation-coordinator |
| TD-WHATSAPP-058 (ticket fare) | NOT BUILT | ticket_fare_pence defaults to 0 (AC-12) |
| BL-4 (claim-dispatcher) | NOT BUILT | evaluation.completed events written to outbox but no consumer exists yet |

---

## 13. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| toc_code missing from old delay.detected events | Medium | Low | Handler checks for toc_code, sets FAILED if missing |
| eligibility-engine unavailable | Medium | Medium | 30s timeout, workflow set to FAILED, error logged |
| Transaction rollback loses outbox event | Low | High | ADR-007 transactional outbox ensures atomicity |
| OUTBOX_SCHEMAS env var not updated | Medium | High | Moykle deployment checklist includes env var update |
| eligibility-engine returns unknown TOC code | Low | Low | eligibility-engine handles this with 400 error; evaluation-coordinator marks FAILED |

---

## 14. Handoff Plan

### Phase TD-1: Test Specification (Jessie)

**Deliverables**:
1. Unit tests for `EligibilityClient.evaluate()` (correct endpoint, payload, headers, error handling, timeout)
2. Unit tests for `DelayDetectedHandler` enhanced flow (create workflow -> call eligibility -> store result -> outbox event)
3. Unit tests for `WorkflowRepository.completeWorkflowWithOutbox()` transaction method
4. Unit tests for delay-tracker `toc_code` enrichment in delay.detected payload
5. Unit tests for outbox-relay SCHEMA_TABLE_MAP evaluation_coordinator entry
6. Integration tests for transactional outbox (workflow + outbox atomically)
7. Tests for error paths (eligibility-engine error, timeout, missing toc_code)

**Quality Gates**:
- All tests MUST fail before Blake starts (RED phase)
- Tests map to ACs (AC-1 through AC-12)
- Coverage targets: >=80% lines/functions/statements, >=75% branches

### Phase TD-2: Implementation (Blake)

**Deliverables**:
1. Refactor `EligibilityClient` (AC-1, AC-3)
2. Enhance `DelayDetectedHandler` to trigger eligibility evaluation (AC-2, AC-3, AC-4, AC-5, AC-8, AC-9)
3. Add transactional outbox method to `WorkflowRepository` (AC-6)
4. Enrich delay-tracker delay.detected payload with toc_code (AC-10)
5. Add evaluation_coordinator to outbox-relay SCHEMA_TABLE_MAP (AC-11)
6. Default ticket_fare_pence to 0 (AC-12)

**Quality Gates**:
- All Jessie's tests pass (GREEN phase)
- No modifications to Jessie's test files (Test Lock Rule)
- TypeScript compiles cleanly, ESLint clean

**Blocking Rules**:
- Blake MUST NOT modify Jessie's tests
- If Blake believes a test is wrong, hand back to Jessie with explanation

### Phase TD-3: QA Sign-off (Jessie)

**Deliverables**:
1. Verify all tests pass
2. Verify coverage thresholds met
3. Verify AC coverage (all 12 ACs have corresponding tests)
4. Verify shared package usage (@railrepay/winston-logger, @railrepay/metrics-pusher, @railrepay/postgres-client)
5. Cross-service integration check: verify real HTTP client for eligibility-engine (not mocked in production code)
6. QA sign-off

### Phase TD-4: Deployment (Moykle)

**Deployment sequence** (ORDER MATTERS):

1. **delay-tracker** (AC-10):
   - Commit and push toc_code enrichment
   - Wait for Railway auto-deploy
   - Verify health check passes

2. **outbox-relay** (AC-11):
   - Commit and push SCHEMA_TABLE_MAP change
   - Update `OUTBOX_SCHEMAS` env var in Railway: add `evaluation_coordinator` to comma-separated list
   - Redeploy outbox-relay
   - Verify health check passes
   - Verify logs show evaluation_coordinator schema being polled

3. **evaluation-coordinator** (AC-1 through AC-9, AC-12):
   - Commit and push all evaluation-coordinator changes
   - Wait for Railway auto-deploy
   - Verify health check passes
   - Verify Kafka consumer reconnects successfully

### Phase TD-5: Verification (Quinn)

**Deliverables**:
1. Verify all 3 services deployed successfully
2. Verify evaluation-coordinator health endpoint responds
3. Update BL-146 status to Done in Backlog
4. Create Changelog entry for this change
5. Update Eligibility & Compensation domain page with new capability: "Eligibility Evaluation from Delay Events"
6. Record any technical debt identified during implementation
7. Collect agent effectiveness metrics

---

## 15. Technical Debt Notes

The following items are known shortcuts in this remediation:

1. **ticket_fare_pence = 0**: Compensation amount will always be 0 until TD-WHATSAPP-058 is implemented. This is documented in AC-12 and tracked by TD-WHATSAPP-058.

2. **claim-dispatcher not built**: The `evaluation.completed` outbox event will be written but never consumed (BL-4 is Planned). This is expected and not a bug.

3. **No retry mechanism**: If eligibility-engine is temporarily unavailable, the workflow is marked FAILED with no automatic retry. A future enhancement (not in scope) could add retry logic with exponential backoff.

4. **Non-transactional workflow update + eligibility check**: The HTTP call to eligibility-engine and the subsequent database updates are not in a single distributed transaction. If the process crashes after the HTTP call but before the DB update, the eligibility-engine will have a cached evaluation but evaluation-coordinator will not. This is mitigated by eligibility-engine's idempotency (same journey_id returns cached result).

---

## 16. Summary of Changes by File

| File | Service | ACs | Change Summary |
|------|---------|-----|----------------|
| `src/services/eligibility-client.ts` | evaluation-coordinator | AC-1, AC-3, AC-9, AC-12 | Fix endpoint to POST /eligibility/evaluate, update interface, accept full payload, default ticket_fare_pence=0 |
| `src/kafka/delay-detected-handler.ts` | evaluation-coordinator | AC-2, AC-3, AC-4, AC-5, AC-8 | Add toc_code to payload interface, inject EligibilityClient, wire evaluation after workflow creation |
| `src/repositories/workflow-repository.ts` | evaluation-coordinator | AC-6 | Add transactional completeWorkflowWithOutbox() method |
| `src/consumers/event-consumer.ts` | evaluation-coordinator | AC-3 | Pass EligibilityClient to DelayDetectedHandler constructor |
| `src/kafka/journey-confirmed-handler.ts` | delay-tracker | AC-10 | Add toc_code to delay.detected outbox payload |
| `src/index.ts` | outbox-relay | AC-11 | Add evaluation_coordinator to SCHEMA_TABLE_MAP |

**Total files changed**: 6 across 3 services
**Estimated complexity**: Medium (no schema changes, no new services, clear API contract)
