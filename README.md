# AegisGrid — AI Emergency Resource Operating System

AegisGrid assembles the fastest feasible emergency response from fragmented hospital resources,
lets an authorised human approve it, asks each facility to confirm its part, and replans when conditions change.
Built for First Commit (WeMakeDevs x AWS). Team Nightwatch.

## Real vs synthetic (say this in the video)

| Part | Status |
|---|---|
| 17 hospitals, their stock, locations, phone numbers | **Synthetic.** Invented names; deterministic seed. |
| Travel times | Simple distance model (42 km/h, road factor 1.35). Not live traffic. |
| Facility data feed | Facilities update inventory on the **facility desk** or push through the keyed **ingest API**. Heartbeats in this demo are simulated; two feeds are deliberately down to show stale-data handling. |
| Planner, Cedar policies, approvals, reservations, confirmations, replanning, audit | **Real, running code.** |
| Login | Built-in accounts (scrypt + signed tokens). Production swap: Amazon Cognito. |

No public real-time hospital-bed API exists that we could verify, so we built the data-entry path real facilities would use instead of pretending.

## What it does

- **Sign in** with a role: duty doctor, dispatch lead, facility admin, observer (and an AI-agent account).
- **Command center:** describe an emergency, get ranked plans against the clock (time-budget bars, route map), what-if simulation, stale-data warnings, human approval.
- **Cedar policies** (`backend/policies/`) decide every action: doctors and dispatch leads approve feasible plans; O-negative plans need a duty doctor; AI can never approve; facility desks touch only their own facility; observers are read-only.
- **Facility confirmations:** after approval each facility gets a request. Confirm, or decline, which voids the approval and replans.
- **Facility desk:** inventory (ICU, ventilators, ambulances, blood by group) editable by that facility only. Changes reach every dashboard within ~2 seconds.
- **Network view:** map and table of all facilities with ICU availability and data freshness.
- **Audit trail:** who did what and what Cedar decided, including blocked attempts.

## Accounts (password `aegis@2026`, overridable with `DEMO_PASSWORD`)

`meera.rao` (duty doctor) · `arjun.nair` (duty doctor) · `rohan.iyer` (dispatch lead) · `viewer` (observer) · `admin.f01` … `admin.f17` (facility desks) · `agent` (AI agent)

Set `DEMO_MODE=off` to hide the demo-account panel on a public deployment.

## Run locally

```powershell
npm run install:all
npm run dev:api      # terminal 1, API on :8787
npm run dev:ui       # terminal 2, UI on http://localhost:5173
npm test             # backend end-to-end checks (auth, Cedar, acks, inventory, replanning)
```

## Run with Docker (same image you deploy)

```powershell
docker compose up --build
# open http://localhost:8080
```

## Deploy to AWS (Ship It): ECR + App Runner

Use **us-east-1** so App Runner and Bedrock are in the same region. Replace `<ACCOUNT_ID>`.

```powershell
aws configure                                   # once: access key, region us-east-1
aws ecr create-repository --repository-name aegisgrid --region us-east-1
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
docker build -t aegisgrid .
docker tag aegisgrid:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/aegisgrid:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/aegisgrid:latest
```

Console: **App Runner > Create service**
1. Source: Container registry, Amazon ECR, pick the image, deployment trigger **Manual**, create a new ECR access role.
2. Service name `aegisgrid`, CPU/memory **0.5 vCPU / 1 GB**, port **8080**.
3. Environment variables: `JWT_SECRET` (any long random string), optionally `DEMO_PASSWORD`, `INGEST_KEY`.
4. Health check: HTTP, path `/api/health`.
5. Auto scaling: create custom config with **min 1, max 1** (state is in memory; two instances would disagree).
6. Create. The default `*.awsapprunner.com` URL is your Ship It URL.

Optional, Amazon Bedrock for requirement extraction: enable model access in the Bedrock console, give the App Runner **instance role** `bedrock:InvokeModel`, and set `AEGIS_LLM=bedrock`, `BEDROCK_MODEL_ID=<model or inference-profile id you have access to>`, `AWS_REGION=us-east-1`. The emergency header then reads "Requirements read by Amazon Bedrock". If the call fails the app falls back to the rule parser, so it cannot break the demo.

Delete the App Runner service after judging to stop charges.

## Facility feed API (how real hospital systems would connect)

Enable with `INGEST_KEY`. Then a hospital system can push its numbers:

```bash
curl -X POST https://<your-url>/api/ingest/facilities/F07/inventory \
  -H "x-ingest-key: <INGEST_KEY>" -H "content-type: application/json" \
  -d '{"icuBedsAvailable":1,"ventilatorsAvailable":2,"blood":{"O-":4,"A+":6}}'
```

Cedar restricts the key to that facility's inventory. Every dashboard updates within seconds and the audit trail records "via ingest API".

## Not built (be honest about it)

- Persistence: state is in memory and resets on restart (use *Reset demo data*). A DynamoDB store is the next step; `store.js` maps onto Resources/Emergencies/Events tables.
- EventBridge, Step Functions, SNS, Cognito: modelled in the design, not wired. Notifications are an in-app stand-in for SNS.
- Live traffic routing and real hospital feeds.

## Agent (Strands, optional)

`agent/aegis_agent.py` can read the network and propose plans but has no approve tool, and Cedar forbids it anyway.
`pip install strands-agents requests` then `python agent/aegis_agent.py "..."` (set `AEGIS_MODEL=ollama` for a fully local model).

## Three-minute demo script

1. **0:00** Sign in as *Dr. Meera Rao*. Click *Road accident*, *Find response plans*: critical trauma, 30-minute limit.
2. **0:20** Point at the search line and the four plans; only Plan A is inside the limit. Show the time-budget bars and the ambulance as the slowest step.
3. **0:50** *What if it fails?* on a resource. Show the replacement and delta. Note any "verify by phone" warning from a stale facility.
4. **1:15** Menu, switch to *Rohan Iyer* (dispatch lead), open the plan, Approve: Cedar blocks it because it uses O-negative. Switch to *Read-only observer*: no approve button.
5. **1:40** Switch back to *Dr. Meera Rao*, Approve. Reservations and facility requests appear; tracker starts (1 second = 1 minute).
6. **2:00** Switch to *Indiranagar Care Hospital facility desk*: it lands on *My facility* with the request. Edit an inventory number, save, then *Confirm*.
7. **2:20** Switch to *Airport Road Trauma Unit facility desk* and *Decline*: approval is voided and plans recompute (continuous replanning).
8. **2:40** *Audit trail*: show the blocked attempts. *Network*: map with stale feeds in grey.
9. **2:50** Show the architecture (Cedar, Strands, App Runner, Bedrock if enabled). Close with the one-line pitch.

Use *Reset demo data* (top-left of the command center) before recording.
