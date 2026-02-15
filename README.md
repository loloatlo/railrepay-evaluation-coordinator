# evaluation-coordinator

Multi-step evaluation workflow orchestration service for RailRepay.

## Overview

The evaluation-coordinator service manages the lifecycle of journey evaluation workflows. It coordinates with downstream services to determine eligibility and initiate compensation claims.

## API Endpoints

### Health Check
```
GET /health
```
Returns service health status.

### Initiate Evaluation
```
POST /api/v1/evaluations
Content-Type: application/json

{
  "journey_id": "uuid"
}
```
Initiates an evaluation workflow for the specified journey.

**Response:**
```json
{
  "workflow_id": "uuid",
  "journey_id": "uuid",
  "correlation_id": "uuid",
  "status": "INITIATED"
}
```

### Get Workflow Status
```
GET /api/v1/evaluations/journey/:journeyId
```
Retrieves the current status of an evaluation workflow.

**Response:**
```json
{
  "workflow_id": "uuid",
  "journey_id": "uuid",
  "status": "COMPLETED",
  "eligibility_result": { ... },
  "steps": [
    {
      "step_type": "ELIGIBILITY_CHECK",
      "status": "COMPLETED",
      "started_at": "timestamp",
      "completed_at": "timestamp"
    }
  ]
}
```

## Workflow States

| Status | Description |
|--------|-------------|
| INITIATED | Workflow created, not yet started |
| IN_PROGRESS | Workflow steps are executing |
| COMPLETED | All steps completed successfully |
| PARTIAL_SUCCESS | Some steps failed but workflow can continue |
| FAILED | Critical failure, workflow cannot proceed |

## Development

### Prerequisites
- Node.js >= 18
- PostgreSQL 15+
- npm

### Setup
```bash
npm install
```

### Run Tests
```bash
npm test
npm run test:coverage
```

### Run Locally
```bash
# Set environment variables
export DATABASE_URL=postgresql://...
export DATABASE_SCHEMA=evaluation_coordinator
export SERVICE_NAME=evaluation-coordinator
export ELIGIBILITY_ENGINE_URL=http://localhost:3002

npm run dev
```

### Run Migrations
```bash
npm run migrate:up
npm run migrate:down  # rollback
```

## Architecture

- **Schema**: `evaluation_coordinator` (ADR-001)
- **Logging**: Winston with correlation IDs (ADR-002)
- **Events**: Transactional outbox pattern (ADR-007)
- **Health**: `/health` endpoint (ADR-008)

## Dependencies

| Package | Purpose |
|---------|---------|
| @railrepay/winston-logger | Structured logging |
| @railrepay/metrics-pusher | Prometheus metrics |
| @railrepay/postgres-client | Database access |

## Database Tables

- `evaluation_workflows` - Workflow state tracking
- `workflow_steps` - Individual step execution
- `outbox` - Event publishing queue

## Deployment

Deployed to Railway: https://railrepay-evaluation-coordinator-production.up.railway.app

See `/docs/phases/PHASE-6-CLOSEOUT.md` for deployment details.
