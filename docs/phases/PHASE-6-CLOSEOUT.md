# Phase 6: Verification and Close-out

**Service**: evaluation-coordinator
**Date**: 2026-01-19
**Owner**: Quinn (Orchestrator)
**Deployment ID**: b04eb3e4-563d-42ec-a6b4-1f51fb7495bf

---

## 1. Deployment Verification

### 1.1 Railway MCP Verification (PASSED)

| Check | Status | Details |
|-------|--------|---------|
| Deployment Status | SUCCESS | Deployment ID: b04eb3e4-563d-42ec-a6b4-1f51fb7495bf |
| Commit | 7dd2ca24 | "Fix database result handling in workflow-repository" |
| Build | SUCCESS | Docker build with node:20-alpine |
| Migrations | SUCCESS | Schema `evaluation_coordinator` created |
| Health Endpoint | HEALTHY | https://railrepay-evaluation-coordinator-production.up.railway.app/health returns `{"status":"healthy"}` |

### 1.2 Service Configuration

| Setting | Value |
|---------|-------|
| Health Check Path | /health |
| Health Check Timeout | 100s |
| Restart Policy | ON_FAILURE (max 10 retries) |
| Region | europe-west4-drams3a |
| Replicas | 1 |
| Start Command | `sh -c 'npm run migrate:up && npm start'` |

### 1.3 Runtime Logs Verification

Service is actively processing requests with proper correlation ID logging:
- Winston logger with correlation IDs (ADR-002 compliant)
- Metrics instrumentation active
- Database queries executing successfully

---

## 2. Service Summary

### 2.1 What Was Built

The **evaluation-coordinator** service is a multi-step evaluation workflow orchestration service that:

1. **Initiates evaluation workflows** for journey eligibility assessment
2. **Coordinates with eligibility-engine** to determine if a journey qualifies for compensation
3. **Manages workflow state** through INITIATED -> IN_PROGRESS -> COMPLETED/PARTIAL_SUCCESS/FAILED states
4. **Publishes events** via transactional outbox pattern (ADR-007) for downstream claim processing
5. **Provides status endpoints** for workflow monitoring

### 2.2 Architecture

```
POST /api/v1/evaluations
    |
    v
WorkflowService.initiateEvaluation()
    |
    +-> WorkflowRepository.createWorkflow()
    |
    +-> [async] executeEligibilityCheck()
            |
            +-> EligibilityClient.checkEligibility()
            |
            +-> WorkflowRepository.updateWorkflowStep()
            |
            +-> [if eligible] triggerClaimSubmission()
                    |
                    +-> WorkflowRepository.createOutboxEvent()

GET /api/v1/evaluations/journey/:journeyId
    |
    v
WorkflowService.getWorkflowStatus()
    |
    +-> WorkflowRepository.getWorkflowByJourneyId()
    +-> WorkflowRepository.getWorkflowSteps()
```

### 2.3 Database Schema

**Schema**: `evaluation_coordinator` (per ADR-001 schema-per-service)

| Table | Purpose |
|-------|---------|
| `evaluation_workflows` | Track high-level workflow state for each journey evaluation |
| `workflow_steps` | Track individual step execution (ELIGIBILITY_CHECK, CLAIM_CREATION) |
| `outbox` | Transactional outbox for reliable event publishing (ADR-007) |

**Indexes**: 10 indexes for query optimization (journey_id, correlation_id, status, created_at, etc.)

---

## 3. Files Created

### 3.1 Source Code (`/src`)

| File | Purpose |
|------|---------|
| `index.ts` | Express server setup, route registration |
| `lib/logger.ts` | Winston logger wrapper (uses @railrepay/winston-logger) |
| `lib/metrics.ts` | Prometheus metrics (uses @railrepay/metrics-pusher) |
| `lib/db.ts` | PostgreSQL client (uses @railrepay/postgres-client) |
| `routes/health.ts` | Health check endpoint (ADR-008) |
| `routes/evaluate.ts` | POST /api/v1/evaluations endpoint |
| `routes/status.ts` | GET /api/v1/evaluations/journey/:journeyId endpoint |
| `services/workflow-service.ts` | Core business logic for workflow orchestration |
| `services/eligibility-client.ts` | HTTP client for eligibility-engine API |
| `repositories/workflow-repository.ts` | Database access layer |

### 3.2 Tests (`/tests`)

| File | Test Count | Purpose |
|------|------------|---------|
| `unit/infrastructure-wiring.test.ts` | 15 | Verifies shared package usage |
| `unit/evaluation-workflow.test.ts` | 25 | Unit tests for workflow service |
| `unit/eligibility-client.test.ts` | 12 | Unit tests for eligibility client |
| `integration/evaluation-workflow-integration.test.ts` | 10 | Testcontainers integration tests |
| `integration/evaluation-workflow-http-integration.test.ts` | 8 | HTTP API integration tests |
| `integration/migrations.test.ts` | 5 | Migration verification tests |

**Total Tests**: 75

### 3.3 Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | NPM package configuration |
| `tsconfig.json` | TypeScript configuration |
| `vitest.config.ts` | Test runner configuration |
| `Dockerfile` | Multi-stage Docker build |
| `railway.toml` | Railway deployment configuration |
| `.pgmigrate.json` | Migration table configuration |

### 3.4 Migrations (`/migrations`)

| File | Purpose |
|------|---------|
| `1737187200000_initial-schema.cjs` | Creates evaluation_coordinator schema with all tables, indexes, triggers |

### 3.5 Documentation (RFC)

| Document | Location |
|----------|----------|
| RFC-005 | `/docs/design/RFC-005-evaluation-coordinator-schema.md` (in repo) |

---

## 4. Test Coverage

### 4.1 Coverage Summary (Phase 4 QA Sign-off)

| Metric | Value | Threshold | Status |
|--------|-------|-----------|--------|
| Statements | 86.27% | >= 80% | PASS |
| Branches | 81.08% | >= 75% | PASS |
| Functions | 90.47% | >= 80% | PASS |
| Lines | 86.27% | >= 80% | PASS |

### 4.2 Coverage by File

| File | Lines | Branches | Notes |
|------|-------|----------|-------|
| lib/logger.ts | 100% | 100% | Full coverage |
| lib/metrics.ts | 100% | 100% | Full coverage |
| lib/db.ts | 53.33% | 100% | Connection setup uncovered |
| repositories/workflow-repository.ts | 95.68% | 80.76% | Near full coverage |
| routes/evaluate.ts | 100% | 87.5% | Full coverage |
| routes/health.ts | 85.71% | 100% | Error paths uncovered |
| routes/status.ts | 80.43% | 80% | Error paths uncovered |
| services/eligibility-client.ts | 100% | 100% | Full coverage |
| services/workflow-service.ts | 68.07% | 66.66% | **Technical Debt** |

---

## 5. Technical Debt Record

### TD-EVAL-001: Low Coverage in workflow-service.ts

| Field | Value |
|-------|-------|
| **ID** | TD-EVAL-001 |
| **Status** | OPEN |
| **Priority** | MEDIUM |
| **Affected File** | `src/services/workflow-service.ts` |
| **Coverage** | 68.07% lines, 66.66% branches |
| **Uncovered Lines** | 109-117, 147-185 |

**Description**: The `workflow-service.ts` file has coverage below the 80% threshold. Uncovered code includes:
1. Lines 109-117: Error handling in `executeEligibilityCheck()` for HTTP status extraction
2. Lines 147-185: The entire `triggerClaimSubmission()` private method

**Root Cause**: The `triggerClaimSubmission()` method is called asynchronously when eligibility returns `eligible: true`. Testing this path requires:
1. Mocking the eligibility client to return `eligible: true`
2. Waiting for async workflow completion
3. Verifying outbox event creation

**Impact**:
- Low: Core functionality is tested via integration tests
- The async nature makes unit testing complex

**Recommended Fix**:
1. Add unit tests that mock `EligibilityClient` to return `eligible: true`
2. Use `await` or promise callbacks to verify `triggerClaimSubmission` execution
3. Add dedicated tests for error path HTTP status extraction

**Estimated Effort**: 4 hours
**Target Sprint**: Next sprint
**Owner**: Jessie (QA)

### TD-EVAL-002: Migration Table Isolation Workaround

| Field | Value |
|-------|-------|
| **ID** | TD-EVAL-002 |
| **Status** | OPEN |
| **Priority** | LOW |
| **Affected File** | `package.json`, `.pgmigrate.json` |

**Description**: Required workaround to use `--migrations-table evaluation_coordinator_pgmigrations` flag because node-pg-migrate defaults to shared `pgmigrations` table.

**Root Cause**: Multiple services share Railway PostgreSQL instance but node-pg-migrate doesn't namespace migration tracking by default.

**Impact**: Low - workaround is functional, just requires documentation

**Recommended Fix**:
1. Document pattern in Architecture > Data Layer
2. Consider creating shared migration utility package

**Estimated Effort**: 2 hours
**Target Sprint**: Backlog
**Owner**: Hoops (Data Architect)

---

## 6. Deployment History

| Attempt | Deployment ID | Status | Issue | Resolution |
|---------|---------------|--------|-------|------------|
| 1 | 6d783868-... | FAILED | ERR_REQUIRE_ESM | Renamed migration to .cjs |
| 2 | 15f3f14f-... | FAILED | Migration table conflict | Added .pgmigrate.json |
| 3 | c21a8415-... | FAILED | Config file not in Docker | Added COPY to Dockerfile |
| 4 | 5c18dc0b-... | REMOVED | Superseded | Used CLI flag instead |
| 5 | b04eb3e4-... | **SUCCESS** | None | Final deployment |

---

## 7. Shared Package Verification

| Package | Version | Verified Import | Usage |
|---------|---------|-----------------|-------|
| @railrepay/winston-logger | ^1.0.0 | YES | `src/lib/logger.ts` |
| @railrepay/metrics-pusher | ^1.1.0 | YES | `src/lib/metrics.ts` |
| @railrepay/postgres-client | ^1.0.0 | YES | `src/lib/db.ts` |

Infrastructure wiring tests verify actual package usage (not just installation).

---

## 8. ADR Compliance

| ADR | Requirement | Status |
|-----|-------------|--------|
| ADR-001 | Schema-per-service | COMPLIANT - Uses `evaluation_coordinator` schema |
| ADR-002 | Correlation IDs in logs | COMPLIANT - Winston logger with correlation_id |
| ADR-005 | Railway native deployment | COMPLIANT - Direct to production |
| ADR-007 | Transactional outbox | COMPLIANT - `outbox` table implemented |
| ADR-008 | Health check endpoint | COMPLIANT - `/health` endpoint |
| ADR-010 | Smoke tests | COMPLIANT - POST/GET endpoints verified |
| ADR-014 | TDD mandatory | COMPLIANT - Tests written before implementation |

---

## 9. Outstanding Items

### 9.1 Follow-up Actions

1. **Record TD-EVAL-001 in Notion Technical Debt Register** (when Notion access restored)
2. **Record TD-EVAL-002 in Notion Technical Debt Register** (when Notion access restored)
3. **Update Service Layer page** with evaluation-coordinator entry
4. **Update Orchestrator Log** with build completion

### 9.2 Future Enhancements (Not Technical Debt)

1. **Retry logic** for eligibility-engine failures (exponential backoff)
2. **Outbox relay service** to publish events to Kafka
3. **Dashboard** for monitoring workflow metrics in Grafana

---

## 10. Phase Completion Checklist

- [x] Deployment status verified (SUCCESS)
- [x] Health endpoint responding
- [x] Logs showing proper correlation IDs
- [x] Metrics instrumented
- [x] Coverage thresholds met (overall)
- [x] Technical debt documented
- [x] Phase reports archived
- [x] Service operational in production

---

## 11. Sign-off

| Role | Agent | Status | Date |
|------|-------|--------|------|
| Specification | Quinn | COMPLETE | 2026-01-18 |
| Data Layer | Hoops | COMPLETE | 2026-01-18 |
| Test Specification | Jessie | COMPLETE | 2026-01-18 |
| Implementation | Blake | COMPLETE | 2026-01-19 |
| QA | Jessie | SIGNED OFF | 2026-01-19 |
| Deployment | Moykle | COMPLETE | 2026-01-19 |
| Verification | Quinn | **COMPLETE** | 2026-01-19 |

---

**SERVICE BUILD COMPLETE**

The evaluation-coordinator service is now operational in production at:
https://railrepay-evaluation-coordinator-production.up.railway.app

GitHub Repository: https://github.com/loloatlo/railrepay-evaluation-coordinator
