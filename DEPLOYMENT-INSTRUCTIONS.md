# Evaluation Coordinator - Railway Deployment Instructions

## Phase 5 Deployment (Moykle) - HUMAN ACTION REQUIRED

**Service**: evaluation-coordinator
**QA Status**: ✅ APPROVED by Jessie (75 tests passing, 86.29% line coverage, 81.08% branch coverage)

---

## Prerequisites Completed ✅

- [x] Dockerfile created with multi-stage build
- [x] .dockerignore configured
- [x] railway.toml configured
- [x] Express `trust proxy` enabled (line 41 in src/index.ts)
- [x] npm-published @railrepay/* packages used
- [x] Database migrations present (migrations/1737187200000_initial-schema.js)
- [x] Health check endpoint implemented (/health)
- [x] All tests passing with coverage thresholds met

---

## HUMAN ACTION REQUIRED: Create GitHub Repository

Since GitHub MCP authentication is not configured, please complete these steps:

### Step 1: Create GitHub Repository

1. Go to: https://github.com/new
2. Repository name: `railrepay-evaluation-coordinator`
3. Description: `Multi-step evaluation workflow orchestration service for RailRepay`
4. Visibility: Public
5. **DO NOT** initialize with README
6. Click "Create repository"

### Step 2: Push Code to GitHub

From the service directory:

```bash
cd "/mnt/c/Users/nicbo/Documents/RailRepay MVP/services/evaluation-coordinator"

# Initialize git if not already done
git init

# Add GitHub remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/railrepay-evaluation-coordinator.git

# Add all files
git add .

# Commit
git commit -m "Initial commit: evaluation-coordinator service

- Multi-step workflow orchestration
- PostgreSQL schema isolation (evaluation_coordinator)
- Winston logging with correlation IDs (ADR-002)
- Prometheus metrics via @railrepay/metrics-pusher
- Health check endpoint (ADR-008)
- Express trust proxy enabled
- 75 tests passing, 86.29% line coverage
- QA approved by Jessie

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

# Push to GitHub
git push -u origin main
```

### Step 3: Create Railway Service from GitHub

1. Go to Railway dashboard: https://railway.app/dashboard
2. Select project: **RailRepay**
3. Click "+ New Service"
4. Select "GitHub Repo"
5. Search for and select: `railrepay-evaluation-coordinator`
6. Service will be created and linked to GitHub
7. **IMPORTANT**: Service name MUST NOT contain special characters (use `railrepay-evaluation-coordinator`)

### Step 4: Configure Environment Variables

Set these environment variables in Railway dashboard:

**Required Variables:**
```
DATABASE_SCHEMA=evaluation_coordinator
DB_HOST=postgres.railway.internal
DB_NAME=railway
DB_PASSWORD=<from existing services>
DB_PORT=5432
DB_USER=postgres
NODE_ENV=production
PORT=3003
```

**Observability Variables (from existing services):**
```
ALLOY_PUSH_URL=http://railway-grafana-alloy.railway.internal:9091/api/v1/metrics/write
LOKI_ENABLED=true
LOKI_HOST=https://logs-prod-035.grafana.net
LOKI_LEVEL=info
LOKI_BASIC_AUTH=<from existing services>
METRICS_PORT=9090
METRICS_PUSH_INTERVAL=15
```

**PostgreSQL Migration Variables:**
```
PGDATABASE=railway
PGHOST=postgres.railway.internal
PGPASSWORD=<from existing services>
PGPORT=5432
PGUSER=postgres
PGSSLMODE=no-verify
```

**Copy from existing service (railrepay-eligibility-engine):**
- DB_PASSWORD
- LOKI_BASIC_AUTH

### Step 5: Verify Auto-Deploy Triggers

Railway should automatically deploy when you push to GitHub main branch.

1. Check deployment status in Railway dashboard
2. View build logs
3. View deploy logs

---

## Post-Deployment Verification Checklist

Once the service is deployed, Moykle will verify via Railway MCP:

- [ ] `mcp__Railway__list-deployments --json` → Check deployment SUCCESS
- [ ] `mcp__Railway__get-logs --logType=build` → Verify build success
- [ ] `mcp__Railway__get-logs --logType=deploy --lines=50` → Verify service startup
- [ ] `mcp__Railway__get-logs --filter="@level:error"` → Check for errors
- [ ] Health check endpoint responding: `GET https://<domain>/health`
- [ ] Migrations ran successfully
- [ ] Database schema created: `evaluation_coordinator`
- [ ] Metrics flowing to Grafana Cloud
- [ ] Logs flowing to Loki

---

## Smoke Tests (Post-Deployment)

After deployment verified:

1. **Health Check**:
   ```bash
   curl https://<domain>/health
   # Expected: 200 OK with {"status":"healthy"}
   ```

2. **Duplicate Workflow Prevention**:
   ```bash
   # First request - should succeed
   curl -X POST https://<domain>/evaluate \
     -H "Content-Type: application/json" \
     -d '{"journey_id":"test-journey-123"}'

   # Second request - should return 422
   curl -X POST https://<domain>/evaluate \
     -H "Content-Type: application/json" \
     -d '{"journey_id":"test-journey-123"}'
   # Expected: 422 Unprocessable Entity
   ```

3. **Workflow Status**:
   ```bash
   curl https://<domain>/status/test-journey-123
   # Expected: 200 OK with workflow status
   ```

---

## Rollback Plan (if needed)

If deployment fails or smoke tests fail:

1. Use Railway dashboard native rollback
2. Select previous deployment
3. Click "Rollback to this deployment"
4. Verify service returns to working state

---

## Expected Deployment Timeline

- GitHub repo creation: 2 minutes
- Code push: 1 minute
- Railway service creation: 3 minutes
- Environment variable configuration: 5 minutes
- Auto-deploy trigger: 5 minutes
- Post-deployment verification: 10 minutes

**Total: ~26 minutes**

---

## Reply When Complete

After completing Steps 1-5, reply with:

```
GitHub repository created: https://github.com/YOUR_USERNAME/railrepay-evaluation-coordinator
Railway service created: railrepay-evaluation-coordinator
Deployment triggered: [deployment ID from Railway]
Service URL: [generated domain URL]
```

Moykle will then proceed with MCP verification and smoke tests.
