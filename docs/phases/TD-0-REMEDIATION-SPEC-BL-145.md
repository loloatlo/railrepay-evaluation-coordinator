# TD-0: Remediation Specification - BL-145 (TD-EVAL-COORDINATOR-001)

## Add Kafka Consumer for delay.detected / delay.not-detected Events

**Backlog Item**: BL-145 (TD-EVAL-COORDINATOR-001)
**Notion URL**: https://www.notion.so/308815ba72ee81f1a7fdc8e657473c68
**Severity**: BLOCKING
**Status**: Proposed -> In Progress
**Date**: 2026-02-15
**Author**: Quinn (Orchestrator)

---

## 1. Business Context

The evaluation-coordinator service is the orchestration hub for the Eligibility & Compensation domain. Its role is to receive delay events from the pipeline, initiate evaluation workflows, and coordinate eligibility checks via eligibility-engine.

Currently, evaluation-coordinator is a pure HTTP service with zero Kafka integration. The delay.detected and delay.not-detected events published by delay-tracker (via outbox-relay to Kafka) are never consumed. This breaks the E2E pipeline at Step 15 -- no evaluation workflows are triggered automatically.

**Pipeline Gap**:
```
Step 14: delay-tracker writes delay.detected to outbox (WORKS)
Step 14b: outbox-relay publishes delay.detected to Kafka (WORKS)
Step 15: evaluation-coordinator should consume delay.detected --> BROKEN (no consumer)
Step 16: evaluation-coordinator should call eligibility-engine --> BROKEN (never triggered)
```

**Source**: Notion System Index (2fa815ba-72ee-80d9-97e9-e16838db5b49), Eligibility & Compensation Domain (2fa815ba-72ee-80b1-ada9-f2b2d0088d14)

---

## 2. Scope: BL-145 Only

This specification covers BL-145 (TD-EVAL-COORDINATOR-001) ONLY -- adding the Kafka consumer infrastructure.

**Explicitly OUT of scope** (covered by BL-146 / TD-EVAL-COORDINATOR-002):
- Fixing EligibilityClient to call POST /eligibility/evaluate (AC-1 of BL-146)
- Enriching delay.detected payload with toc_code (AC-10 of BL-146)
- Wiring the eligibility-engine HTTP call into the consumer handler (AC-2 through AC-12 of BL-146)
- Adding evaluation_coordinator to outbox-relay SCHEMA_TABLE_MAP (AC-11 of BL-146)

BL-145 creates the Kafka consumer infrastructure. BL-146 wires the eligibility call into it.

---

## 3. Current State Analysis

### 3.1 Existing Code Structure

```
services/evaluation-coordinator/src/
  index.ts                        -- Express app, HTTP-only startup
  lib/
    db.ts                         -- @railrepay/postgres-client (ADR-005)
    logger.ts                     -- @railrepay/winston-logger (ADR-002)
    metrics.ts                    -- @railrepay/metrics-pusher (ADR-008)
  routes/
    evaluate.ts                   -- POST /evaluate/:journey_id (HTTP trigger)
    status.ts                     -- GET /status/:journey_id
    health.ts                     -- GET /health (hardcoded stub)
  services/
    workflow-service.ts           -- Core workflow orchestration
    eligibility-client.ts         -- EligibilityClient (calls WRONG endpoint)
  repositories/
    workflow-repository.ts        -- DB operations for workflows, steps, outbox
```

### 3.2 Database Schema (evaluation_coordinator)

Tables already exist:
- `evaluation_workflows` -- id, journey_id, correlation_id, status, eligibility_result, created_at, updated_at, completed_at
- `workflow_steps` -- id, workflow_id, step_type, status, payload, error_details, started_at, completed_at
- `outbox` -- id, aggregate_id, aggregate_type, event_type, payload, correlation_id, published, published_at, created_at

Status constraint on evaluation_workflows: `INITIATED`, `IN_PROGRESS`, `COMPLETED`, `PARTIAL_SUCCESS`, `FAILED`

### 3.3 Shared Packages Already In Use

- `@railrepay/winston-logger` -- YES (src/lib/logger.ts)
- `@railrepay/metrics-pusher` -- YES (src/lib/metrics.ts)
- `@railrepay/postgres-client` -- YES (src/lib/db.ts)
- `@railrepay/kafka-client` -- NOT INSTALLED (this is what BL-145 adds)

### 3.4 Kafka Consumer Pattern (Reference: delay-tracker)

The delay-tracker service implements the exact pattern needed:

1. **Config module** (`src/consumers/config.ts`): Parses KAFKA_BROKERS, KAFKA_USERNAME, KAFKA_PASSWORD, KAFKA_GROUP_ID, KAFKA_SSL_ENABLED from env vars. Throws `ConsumerConfigError` on missing vars.

2. **EventConsumer class** (`src/consumers/event-consumer.ts`): Wraps `KafkaConsumer` from `@railrepay/kafka-client`. Creates handler, subscribes to topic, starts consuming.

3. **Handler class** (`src/kafka/journey-confirmed-handler.ts`): Typed handler for a specific topic. Validates payload, processes event, writes to DB.

4. **index.ts startup**: Creates EventConsumer, calls `start()` in try/catch for graceful degradation (if Kafka config missing, service runs in HTTP-only mode).

5. **Graceful shutdown**: Stops consumer before closing HTTP server and DB pool.

### 3.5 @railrepay/kafka-client API

```typescript
import { KafkaConsumer } from '@railrepay/kafka-client';

const consumer = new KafkaConsumer({
  serviceName: string,      // REQUIRED
  brokers: string[],        // REQUIRED
  username: string,         // REQUIRED
  password: string,         // REQUIRED
  groupId: string,          // REQUIRED
  logger?: Logger,          // Optional
  ssl?: boolean,            // default: true
  saslMechanism?: string,   // default: 'plain'
});

await consumer.connect();
await consumer.subscribe(topic, handler, fromBeginning?);
await consumer.start();
// ... later ...
await consumer.disconnect();

consumer.isConsumerRunning(): boolean;
consumer.getStats(): ConsumerStats;
consumer.getSubscribedTopics(): string[];
```

### 3.6 delay.detected Event Payload (Current)

From delay-tracker `createDelayAlert()` method (journey-confirmed-handler.ts lines 274-285):

```json
{
  "journey_id": "uuid",
  "user_id": "uuid",
  "delay_minutes": 45,
  "is_cancellation": false
}
```

Note: `toc_code` is NOT included in the current payload. This is an upstream issue tracked by BL-146 AC-10.

### 3.7 delay.not-detected Event Payload (Current)

From delay-tracker `publishDelayNotDetected()` method (journey-confirmed-handler.ts lines 296-306):

```json
{
  "journey_id": "uuid",
  "user_id": "uuid",
  "reason": "below_threshold" | "darwin_unavailable"
}
```

---

## 4. Acceptance Criteria (from BL-145)

- [x] AC-1: Kafka consumer subscribing to `delay.detected` topic using `@railrepay/kafka-client`
- [x] AC-2: Kafka consumer subscribing to `delay.not-detected` topic using `@railrepay/kafka-client`
- [x] AC-3: On `delay.detected`, create evaluation_workflow with status=INITIATED
- [x] AC-4: Extract `correlation_id` from event, propagate through all downstream calls and logs (ADR-002)
- [x] AC-5: On `delay.not-detected`, create workflow with status=COMPLETED and eligibility_result={eligible: false, reason: payload.reason}
- [x] AC-6: Kafka env vars (KAFKA_BROKERS, KAFKA_USERNAME, KAFKA_PASSWORD, KAFKA_SSL, KAFKA_SASL_MECHANISM) configured in Railway
- [x] AC-7: Graceful degradation -- if Kafka config missing, service starts in HTTP-only mode
- [x] AC-8: Idempotent processing -- duplicate events for same journey_id are ignored
- [x] AC-9: Consumer handler uses `@railrepay/winston-logger` (no console.log)
- [x] AC-10: Consumer group ID follows naming convention: `evaluation-coordinator-consumer-group`

---

## 5. Technical Specification

### 5.1 New Files Required

```
src/
  consumers/
    config.ts                    -- Kafka consumer configuration (env var parsing)
    event-consumer.ts            -- EventConsumer wrapper (KafkaConsumer lifecycle)
  kafka/
    delay-detected-handler.ts    -- Handler for delay.detected events
    delay-not-detected-handler.ts -- Handler for delay.not-detected events
```

### 5.2 Modified Files

```
src/index.ts                     -- Add EventConsumer initialization + graceful shutdown
package.json                     -- Add @railrepay/kafka-client dependency
```

### 5.3 Component Design

#### 5.3.1 ConsumerConfig (src/consumers/config.ts)

Follows delay-tracker pattern exactly:
- Required env vars: KAFKA_BROKERS, KAFKA_USERNAME, KAFKA_PASSWORD, KAFKA_GROUP_ID
- Optional: KAFKA_SSL_ENABLED (default true), SERVICE_NAME (default 'evaluation-coordinator')
- Throws ConsumerConfigError with all missing vars listed
- Group ID: `evaluation-coordinator-consumer-group` (AC-10)

#### 5.3.2 EventConsumer (src/consumers/event-consumer.ts)

Wraps KafkaConsumer, creates and wires both handlers:
- Subscribes to `delay.detected` and `delay.not-detected` topics
- Manages lifecycle (connect, subscribe, start, disconnect)
- Tracks per-handler statistics
- Dependencies injected: db (PostgresClient or Pool), logger

#### 5.3.3 DelayDetectedHandler (src/kafka/delay-detected-handler.ts)

For BL-145 scope:
1. Validate payload: journey_id (required), user_id (required), delay_minutes (required), is_cancellation (required)
2. Extract correlation_id from Kafka message headers or payload (AC-4)
3. Check idempotency: query evaluation_workflows for existing active workflow for this journey_id (AC-8)
4. If no existing workflow: create evaluation_workflow with status=INITIATED (AC-3)
5. Log all operations with correlation_id using @railrepay/winston-logger (AC-9)

Note: The actual eligibility-engine call is NOT wired in BL-145. The workflow is created in INITIATED status. BL-146 will add the handler logic to call eligibility-engine and transition to COMPLETED/FAILED.

#### 5.3.4 DelayNotDetectedHandler (src/kafka/delay-not-detected-handler.ts)

1. Validate payload: journey_id (required), user_id (required), reason (required)
2. Extract correlation_id from Kafka message headers or payload (AC-4)
3. Check idempotency: skip if workflow already exists for this journey_id (AC-8)
4. Create evaluation_workflow with status=COMPLETED and eligibility_result={eligible: false, reason: payload.reason} (AC-5)
5. Log all operations with correlation_id (AC-9)

#### 5.3.5 Index.ts Changes

Follow delay-tracker pattern:
1. Import EventConsumer and createConsumerConfig
2. After HTTP server starts, attempt to create and start EventConsumer
3. Wrap in try/catch with ConsumerConfigError check (AC-7 graceful degradation)
4. Add consumer to graceful shutdown sequence (stop consumer before HTTP server and DB)

### 5.4 Environment Variables (AC-6)

Required Railway env vars for evaluation-coordinator:

| Variable | Source | Example |
|----------|--------|---------|
| KAFKA_BROKERS | Same as darwin-ingestor, outbox-relay | `pkc-xxx.us-east-1.aws.confluent.cloud:9092` |
| KAFKA_USERNAME | Confluent API key | `XXXXXXXXXXXX` |
| KAFKA_PASSWORD | Confluent API secret | `xxxxxxxxxxxxxxxx` |
| KAFKA_GROUP_ID | Fixed value | `evaluation-coordinator-consumer-group` |
| KAFKA_SSL_ENABLED | Default true | `true` |

These are the same Confluent credentials used by darwin-ingestor, journey-matcher, delay-tracker, and outbox-relay.

### 5.5 Idempotency Strategy (AC-8)

Before creating a workflow for any event:
```sql
SELECT id FROM evaluation_coordinator.evaluation_workflows
WHERE journey_id = $1
AND status IN ('INITIATED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL_SUCCESS')
LIMIT 1
```

If a row exists, skip processing (log at info level with correlation_id).

Note: This differs from the existing WorkflowRepository.createWorkflow() duplicate check, which only checks for ACTIVE workflows (INITIATED, IN_PROGRESS, PARTIAL_SUCCESS). For idempotency, we also check COMPLETED to prevent re-processing events for already-evaluated journeys.

### 5.6 Correlation ID Propagation (AC-4, ADR-002)

The correlation_id flows from the original WhatsApp interaction through the entire pipeline:
1. whatsapp-handler creates correlation_id
2. journey.created event includes correlation_id
3. journey.confirmed event includes correlation_id
4. delay.detected/delay.not-detected events include correlation_id in the outbox payload

The Kafka message value (parsed as JSON) contains `correlation_id` as a sibling of `journey_id` in the outbox payload wrapper. The handler must extract this and pass it through to:
- evaluation_workflow.correlation_id column
- All log entries
- Future HTTP calls to eligibility-engine (in BL-146)

---

## 6. Data Layer Assessment (Phase TD-0.5)

### Does this need Hoops?

**NO.** The existing database schema already has everything needed:
- `evaluation_coordinator.evaluation_workflows` table exists with all required columns
- `evaluation_coordinator.workflow_steps` table exists
- `evaluation_coordinator.outbox` table exists
- No new tables, columns, or migrations are needed for BL-145

The work is purely application-level: adding Kafka consumer code and wiring it to existing repository methods.

### Migration Isolation Check

The `.migrationrc.json` uses `migrationsTable: "pgmigrations"` but the `package.json` migrate script uses `--migrations-table evaluation_coordinator_pgmigrations`. This inconsistency should be noted but is not blocking for BL-145 since no new migrations are needed.

---

## 7. ADR Applicability

| ADR | Applies | Notes |
|-----|---------|-------|
| ADR-001 Schema-per-service | Yes | Using evaluation_coordinator schema |
| ADR-002 Winston Logger + Correlation IDs | Yes | AC-4, AC-9 |
| ADR-004 Vitest | Yes | All tests in Vitest |
| ADR-005 Railway Direct Deploy | Yes | Deploy via git push to main |
| ADR-007 Transactional Outbox | N/A for BL-145 | Applies to BL-146 |
| ADR-008 Prometheus Metrics | Yes | Consumer metrics |
| ADR-010 Smoke Tests | Yes | Post-deployment |
| ADR-014 TDD | Yes | Tests before implementation |
| ADR-018 Migration Isolation | N/A | No new migrations |
| ADR-019 Historic Journey Delay Detection | Yes | Defines the pipeline flow |

---

## 8. Dependencies

### Upstream (must be true before this works E2E)
- delay-tracker publishes delay.detected events to outbox -- DONE (TD-DELAY-TRACKER-005)
- outbox-relay publishes delay_tracker outbox to Kafka -- DONE (TD-OUTBOX-RELAY-002)
- Confluent Kafka cluster operational -- DONE

### This Item (BL-145)
- `@railrepay/kafka-client` shared package -- AVAILABLE (used by delay-tracker, journey-matcher)
- Kafka credentials for evaluation-coordinator Railway service -- REQUIRES HUMAN ACTION

### Downstream (blocked by this item)
- BL-146 (TD-EVAL-COORDINATOR-002) -- Wire eligibility call into delay event workflow

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Kafka credentials not configured | Low | Blocks Kafka consumer | AC-7: graceful degradation, HTTP-only mode |
| Duplicate event processing | Medium | Extra workflow rows | AC-8: idempotency check |
| Event payload missing correlation_id | Low | Broken tracing | Generate new UUID if missing, log warning |
| Consumer crash loop | Low | Service instability | Graceful degradation pattern from delay-tracker |

---

## 10. Workflow Plan

### Phase TD-0.5: Data Impact Analysis (Hoops)
**SKIP** -- No data layer changes required. Existing schema is sufficient.

### Phase TD-1: Test Specification (Jessie)

Jessie writes failing tests for:

1. **Unit Tests -- delay-detected-handler.test.ts**
   - AC-3: On delay.detected, creates workflow with status=INITIATED
   - AC-4: Extracts and propagates correlation_id
   - AC-8: Skips duplicate events (idempotent)
   - AC-9: Uses winston-logger, no console.log
   - Payload validation (missing journey_id, missing user_id, etc.)

2. **Unit Tests -- delay-not-detected-handler.test.ts**
   - AC-5: On delay.not-detected, creates workflow with COMPLETED + eligibility_result
   - AC-4: Extracts and propagates correlation_id
   - AC-8: Skips duplicate events
   - AC-9: Uses winston-logger
   - Payload validation

3. **Unit Tests -- consumer-config.test.ts**
   - AC-6: Parses all required env vars
   - AC-7: Throws ConsumerConfigError when vars missing
   - AC-10: Group ID is `evaluation-coordinator-consumer-group`

4. **Unit Tests -- event-consumer.test.ts**
   - Subscribes to both topics (delay.detected, delay.not-detected)
   - Lifecycle: connect -> subscribe -> start -> disconnect
   - Stats tracking
   - Error handling in message processing

5. **Integration Tests -- kafka-consumer-integration.test.ts** (if Docker available)
   - Full Kafka consumer with Testcontainers
   - Publish delay.detected message -> verify workflow created in DB
   - Publish delay.not-detected message -> verify workflow created with COMPLETED
   - Duplicate event -> verify idempotent

6. **Infrastructure Wiring Tests -- kafka-wiring.test.ts**
   - Verify `@railrepay/kafka-client` is imported and used (not raw kafkajs)
   - Verify `@railrepay/winston-logger` is used in handlers
   - Verify no console.log in handler files

### Phase TD-2: Implementation (Blake)

Blake makes Jessie's tests GREEN by implementing:
1. `src/consumers/config.ts` -- Consumer configuration
2. `src/consumers/event-consumer.ts` -- EventConsumer wrapper
3. `src/kafka/delay-detected-handler.ts` -- delay.detected handler
4. `src/kafka/delay-not-detected-handler.ts` -- delay.not-detected handler
5. Modified `src/index.ts` -- Consumer startup + graceful shutdown
6. Modified `package.json` -- Add @railrepay/kafka-client dependency

### Phase TD-3: QA Sign-off (Jessie)

Jessie verifies:
- All tests passing
- Coverage >= 80% lines/functions/statements, >= 75% branches
- No console.log in new files
- @railrepay/kafka-client used (not raw kafkajs)
- @railrepay/winston-logger used in all handlers
- AC coverage: all 10 ACs have corresponding tests

### Phase TD-4: Deployment (Moykle)

Moykle:
1. Commit and push to main
2. Configure Railway env vars (KAFKA_BROKERS, KAFKA_USERNAME, KAFKA_PASSWORD, KAFKA_GROUP_ID, KAFKA_SSL_ENABLED)
3. Verify deployment succeeds
4. Verify health endpoint still works
5. Check logs for "Kafka event consumer started successfully" or graceful degradation message

### Phase TD-5: Verification (Quinn)

Quinn:
1. Verify deployment via Railway MCP
2. Check logs for consumer startup
3. Update BL-145 status to Done
4. Create Changelog entry
5. Record any technical debt
6. Update Notion domain/service pages if needed
7. Confirm BL-146 is unblocked

---

## 11. Handoff Instructions

### Handoff to Jessie (Phase TD-1)

**From**: Quinn (Phase TD-0)
**Context**: BL-145 remediation specification complete. evaluation-coordinator needs Kafka consumer for delay.detected and delay.not-detected topics.

#### Deliverables Required
- [ ] Unit tests for delay-detected-handler (AC-3, AC-4, AC-8, AC-9, payload validation)
- [ ] Unit tests for delay-not-detected-handler (AC-5, AC-4, AC-8, AC-9, payload validation)
- [ ] Unit tests for consumer config (AC-6, AC-7, AC-10)
- [ ] Unit tests for event-consumer (lifecycle, subscriptions, stats)
- [ ] Infrastructure wiring tests (shared package usage verification)
- [ ] Integration tests for Kafka consumer with DB (if Docker available)

#### Quality Gates
- [ ] All tests FAIL (RED phase -- no implementation exists yet)
- [ ] Tests map to ACs via comments: `// AC-1: description`
- [ ] Tests use Vitest (ADR-004), NOT Jest
- [ ] Mocks use vi.fn(), vi.mock() -- NOT jest equivalents
- [ ] Tests follow interface-based mocking (mock WorkflowRepository, not DB queries)
- [ ] Handler tests mock @railrepay/kafka-client KafkaConsumer
- [ ] DB tests mock WorkflowRepository methods

#### Blocking Rules
- Tests MUST be written BEFORE Blake implements (ADR-014)
- No placeholder assertions (assert.ok(true))
- Use delay-tracker handler tests as reference pattern

#### References
- BL-145 Notion page: https://www.notion.so/308815ba72ee81f1a7fdc8e657473c68
- delay-tracker EventConsumer pattern: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/delay-tracker/src/consumers/event-consumer.ts`
- delay-tracker config pattern: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/delay-tracker/src/consumers/config.ts`
- @railrepay/kafka-client API: KafkaConsumer with connect(), subscribe(), start(), disconnect()
- Current event payloads documented in Section 3.6 and 3.7 above
- Existing test files: `/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/evaluation-coordinator/tests/`

---

### Handoff to Blake (Phase TD-2) -- AFTER Jessie completes TD-1

**From**: Jessie (Phase TD-1)
**Context**: Failing tests exist for Kafka consumer infrastructure. Blake makes them GREEN.

#### Deliverables Required
- [ ] src/consumers/config.ts implemented
- [ ] src/consumers/event-consumer.ts implemented
- [ ] src/kafka/delay-detected-handler.ts implemented
- [ ] src/kafka/delay-not-detected-handler.ts implemented
- [ ] src/index.ts modified with consumer startup + graceful shutdown
- [ ] package.json updated with @railrepay/kafka-client dependency
- [ ] All Jessie's tests passing (GREEN)

#### Quality Gates
- [ ] All tests passing
- [ ] TypeScript compiles with no errors
- [ ] No console.log anywhere in new code
- [ ] @railrepay/kafka-client used (not raw kafkajs)
- [ ] @railrepay/winston-logger used (not console.log)
- [ ] Graceful degradation: service starts without Kafka config

#### Blocking Rules
- Blake MUST NOT modify Jessie's tests (Test Lock Rule)
- If a test seems wrong: hand back to Jessie with explanation
- Follow delay-tracker patterns (EventConsumer, config, handler)

---

### Handoff to Jessie (Phase TD-3) -- AFTER Blake completes TD-2

**From**: Blake (Phase TD-2)
**Context**: Implementation complete. Jessie verifies QA.

#### Deliverables Required
- [ ] QA sign-off report
- [ ] Coverage report (>= 80/80/80/75)
- [ ] AC coverage verification (all 10 ACs)

#### Quality Gates
- [ ] All tests passing
- [ ] Coverage thresholds met
- [ ] No anti-patterns (console.log, any types, skipped tests)
- [ ] Shared package verification (grep confirms usage)

---

### Handoff to Moykle (Phase TD-4) -- AFTER Jessie signs off TD-3

**From**: Jessie (Phase TD-3)
**Context**: QA sign-off complete. Deploy to Railway.

#### Deliverables Required
- [ ] Code committed and pushed to main
- [ ] Railway env vars configured (KAFKA_BROKERS, KAFKA_USERNAME, KAFKA_PASSWORD, KAFKA_GROUP_ID, KAFKA_SSL_ENABLED)
- [ ] Deployment verified successful
- [ ] Health endpoint responding
- [ ] Logs confirm consumer startup (or graceful degradation if no Kafka creds)

#### Quality Gates
- [ ] All tests pass before push
- [ ] Deployment succeeds on Railway
- [ ] No crash loops in logs
- [ ] Health endpoint returns 200

#### Blocking Rules
- Must have QA sign-off from Jessie before deploying
- Kafka credentials: same Confluent credentials used by other services (copy from darwin-ingestor or outbox-relay Railway env vars)

---

## 12. Technical Debt Identified

| Item | Description | Severity |
|------|-------------|----------|
| Migration config inconsistency | .migrationrc.json uses "pgmigrations" but package.json uses "evaluation_coordinator_pgmigrations" | DEFERRED |
| Health endpoint is a stub | Returns hardcoded {status: 'healthy'} without checking DB/Kafka | Tracked by TD-OBSERVABILITY-004 |
| EligibilityClient calls wrong endpoint | GET /eligibility/:id instead of POST /eligibility/evaluate | Tracked by BL-146 |

---

## 13. Definition of Done

### Design
- [x] Notion requirements referenced with specific links
- [x] ADR applicability assessed
- [x] NFRs listed (graceful degradation, idempotency, correlation ID)

### TDD
- [ ] Failing tests authored FIRST (Jessie Phase TD-1)
- [ ] Implementation written to pass tests (Blake Phase TD-2)
- [ ] All tests passing (Jessie Phase TD-3)

### Code Quality
- [ ] TypeScript types precise (no `any`)
- [ ] ESLint/Prettier clean
- [ ] No console.log in new code

### Observability
- [ ] Winston logs with correlation IDs (AC-4, AC-9)
- [ ] Prometheus metrics for consumer operations
- [ ] Error cases log appropriate severity

### Release
- [ ] Railway deployment successful (Moykle Phase TD-4)
- [ ] Health endpoint still works post-deploy
- [ ] Kafka consumer starts or gracefully degrades

### Technical Debt
- [ ] All shortcuts recorded in Backlog
- [ ] Each item: description, context, impact, fix, owner

### Sign-Offs
- [ ] Jessie approved (QA Phase TD-3)
- [ ] Moykle approved (Deployment Phase TD-4)
- [ ] Quinn final approval (Phase TD-5)
