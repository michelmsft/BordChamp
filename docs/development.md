# Local Development

## Azure Table Storage

BordChamp uses Azurite for local Table Storage development.

Start Azurite from the repository root:

```powershell
azurite --silent --location .azurite --debug .azurite/debug.log
```

In a second terminal, configure the emulator and create the required tables:

```powershell
$env:AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true"
pnpm --filter @bordchamp/api storage:bootstrap
```

The bootstrap is idempotent. It creates `ReferenceData`, `Organizations`, `UserDirectory`, `Inventory`, `ProductionUnits`, `Inspections`, `WarehouseReceipts`, `Trading`, `Settlements`, `Deliveries`, `Disputes`, `Compliance`, `Lineage`, `Risk`, and `Integrations`, then upserts the initial public commodity catalog.

Build and start the API with the same environment variable:

```powershell
pnpm build
$env:AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true"
pnpm --filter @bordchamp/api start
```

The API is available at `http://localhost:3000`.

## Web Application

Start the React participant console from the repository root:

```powershell
pnpm --filter @bordchamp/web dev
```

The web application is available at `http://localhost:5173`. During development, Vite proxies `/api` requests to `http://localhost:3001` so the browser remains same-origin. To target another API instance, set `BORDCHAMP_API_URL` before starting the web application:

```powershell
$env:BORDCHAMP_API_URL = "http://localhost:3000"
pnpm --filter @bordchamp/web dev
```

Until the authentication flow is exercised through the UI, use the identity control at the bottom of the desktop navigation to set the development user, persona, and organization ID.

The **Gestion ERP** workspace is the participant-facing application. It loads the authorized organization through `GET /v1/erp/organizations/:organizationId/workspace` and presents module views for production, stock, quality, warehousing, sales, finance, logistics, compliance, and risk. It includes searchable record tables, status filters, a prioritized work queue, record drawers, business creation forms, and contextual actions such as making a lot available, finalizing an inspection, quoting an RFQ, advancing a delivery, and acknowledging an alert.

The existing **Console avancée** remains available separately. It exposes the complete command-level lifecycle for exceptional and administrative work: organizations and mandates, production units and lots, inspection, warehouse receipts, RFQs and quotes, settlement, delivery and proof of delivery, disputes, compliance, recalls, movement restrictions, risk, audit, and integrations. Commands capture returned IDs and ETags in a browser-local workflow ledger and reuse them in later requests. Use **Gérer les références** to inspect or replace those values when working with an existing aggregate.

Switch the development identity before commands owned by another party, such as inspector finalization, warehouse custody, buyer quotation and delivery decision, logistics milestones, or administrative mediation. The escrow callback form accepts a provider-generated HMAC signature; the web application never receives or derives `ESCROW_WEBHOOK_SECRET`.

## Development Identity

Automated tests and low-level scripts may set these temporary headers when `NODE_ENV=test`:

```text
x-user-id: farmer-1
x-personas: Farmer
x-organization-id: <organization-id>
```

Multiple personas are comma-separated. Representation scope is never accepted from a header; the API resolves active mandates from `UserDirectory` / `Organizations`. Outside test mode these headers are ignored — every request must present a valid access token.

## Authentication

BordChamp manages its own accounts. There is no external identity provider.

- **Credentials**: email + password. Passwords are hashed with Argon2id (memory 64 MiB, time cost 3, parallelism 1) and never stored, logged, or transmitted after the initial POST.
- **Second factor**: RFC 6238 TOTP (SHA-1, 6 digits, 30-second window, ±1 step tolerance). Any authenticator app works; Microsoft Authenticator is recommended. The secret is scanned from a `qrcode`-rendered `otpauth://` URI during registration and is encrypted at rest with AES-256-GCM using `AUTH_SECRET_ENCRYPTION_KEY`.
- **Recovery**: ten single-use recovery codes (`AAAAA-BBBBB`) are shown once at enrollment and stored as SHA-256 hashes. Consuming a code marks it used.
- **Access tokens**: RS256 JWT, `iss=bordchamp`, `aud=bordchamp-api`, 15-minute TTL, carried by the SPA in `Authorization: Bearer` on every business request. Keys are configured through `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEY`.
- **Refresh tokens**: a rotating opaque token stored HttpOnly / Secure (prod) / SameSite=Strict / Path=`/v1/auth` in the cookie `bc_refresh`. The cookie plaintext is `${userId}.${tokenId}.${secret}`; the secret is HMAC-SHA256-hashed at rest with `AUTH_REFRESH_TOKEN_PEPPER`. Successful refresh rotates the token; presenting an already-rotated token revokes the entire family (reuse detection). Cookie lifetime is 30 days.
- **Challenge JWTs**: short-lived HS256 tokens signed with `AUTH_CHALLENGE_KEY` carry state between `register` → `verifyRegistration` (5 minutes) and `login` → `verifyLogin` (2 minutes).
- **Session invalidation**: every `UserProfile` carries a `sessionVersion`. The access token embeds the value observed at issue time; the guard rejects any token whose version no longer matches, so administrative disable / password reset invalidates all outstanding tokens on the next request.

### Auth endpoints

```
POST /v1/auth/register           { email, password }                → { challenge, provisioning: { otpauthUri, recoveryCodes } }
POST /v1/auth/register/verify    { challenge, code }                → { accessToken } + Set-Cookie: bc_refresh
POST /v1/auth/login              { email, password }                → { challenge }
POST /v1/auth/login/verify       { challenge, code|recoveryCode }   → { accessToken } + Set-Cookie: bc_refresh
POST /v1/auth/refresh                                               → { accessToken } + rotated Set-Cookie
POST /v1/auth/logout                                                → 204 + expired Set-Cookie
```

All auth endpoints are `@Public()`; every other route requires a valid access token.

Tenant secrets are documented in [.env.example](../.env.example). Generate them with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # for the three symmetric keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-private.pem
openssl rsa -pubout -in jwt-private.pem -out jwt-public.pem
```

## Organization Concurrency

Organization reads and writes return an ETag in both the HTTP `ETag` header and resource representation. `PATCH` and deactivation requests require the latest value in `If-Match`. A stale value returns HTTP `409`; missing `If-Match` returns HTTP `400`.

Organization deactivation changes status to `inactive`. It does not delete the profile, membership, mandates, or audit history.

Production units and inventory lots use the same ETag convention. Finalized inspections are immutable. A failed inspection quarantines its lot before the certificate is finalized; this conservative ordering prevents a failed-quality result from leaving a lot tradable if a later cross-table write must be retried.

Warehouse receipts cover the entire linked lot quantity and are unique per lot lifecycle. Warehouse operators control issuance and physical release; receipt owners control pledging and transfer; pledgees control pledge release. Pledged receipts and receipts linked to quarantined or inactive lots cannot be physically released.

Sell RFQs reserve one complete available lot using a deterministic RFQ ID. Quotes and the accepted trade confirmation share the RFQ partition. Acceptance marks the lot sold before atomically accepting the quote; retries are idempotent for the same deterministic trade. This conservative ordering prevents double sale if a cross-table operation must be retried. Cancelling an open RFQ, including an expired RFQ, releases its lot reservation. When a warehouse receipt exists, its current owner controls sale authority and an active pledge blocks the offer.

Each settlement uses a deterministic trade-derived ID. Its profile, funding instruction, provider callback inbox, immutable events, and double-entry postings share one Table partition. Every journal is rejected unless total debits equal total credits. Funding, release, and refund callbacks are HMAC-SHA256 verified using `ESCROW_WEBHOOK_SECRET`, stored idempotently by provider event ID, and committed atomically with their state transition and postings. The application records obligations and partner reconciliation; it does not claim custody of client funds.

Each trade has one deterministic delivery. The delivery partition stores its profile and immutable assignment, pickup, transit, arrival, POD, and receipt-decision events, including integer temperature or oxygen readings and evidence references. Only the stored logistics assignee may advance milestones or submit POD. Accepted and rejected quantities must preserve the original trade quantity, unit, and scale. Full acceptance requests settlement release, full rejection requests refund, and partial acceptance places settlement in `deliveryHold` for dispute resolution. The settlement transition is applied before terminal delivery finalization and is idempotent for exact retries.

Each partial or rejected delivery has one deterministic dispute lifecycle. A dispute must be filed by the seller, buyer, or an active representative within seven days. Evidence, party responses, mediation, and the final decision are stored as immutable rows and events in the dispute partition. Only ExchangeAdmin can begin mediation or decide a remedy; Regulator has historical read access. Financial remedy execution is conservative: a held settlement is moved to release- or refund-pending before the dispute is marked resolved, and exact retries are idempotent. The current pilot remedy model is whole-settlement release or refund; proportional financial allocation is deferred until the escrow partner contract supports split instructions.

Compliance documents are organization-partitioned, effective-dated, and reviewed through ETag-protected decisions; approved documents are reported as expired once `validUntil` passes without rewriting history. Lot lineage is stored as deterministic parent-to-child and child-to-parent adjacency projections for bounded traceability traversal. Recalls use deterministic references and conservatively apply reversible quarantine to a root lot and every descendant, recording an idempotent impact row for each cross-partition outcome. Recall release restores only lots still held for that exact recall. Geographic movement restrictions are effective-dated by region and optional commodity, and are enforced both when an RFQ is created and when a quote is accepted.

Risk limits, open-trade exposure reservations, and alerts are partitioned by organization. ExchangeAdmin configures XOF single-trade and aggregate open-delivery exposure limits. Trade acceptance reserves deterministic exposure for both parties before inventory is sold; terminal delivery decisions release it idempotently. Limit breaches block acceptance and create deterministic critical alerts. Delivery temperatures outside 0-25°C or oxygen outside 80-110% create condition alerts under the logistics organization. ExchangeAdmin can scan approved documents for expiry within a configurable window. Participants acknowledge their alerts; only ExchangeAdmin resolves them, with all ETag-protected transitions retained as immutable events.

Integration events use globally ordered sequence IDs and separate public and organization partitions. Public consumers can page the public feed; authenticated organization members can page only their private feed. Webhook subscriptions accept only known topics and HTTPS endpoints that do not use or resolve to loopback, private, or link-local addresses. Delivery attempts are signed with a per-subscription HMAC secret derived from `WEBHOOK_SIGNING_MASTER_SECRET`, retried with bounded exponential backoff, and retained for explicit replay and audit. Configure that secret with at least 24 characters in every environment.

## Azure Authentication

Deployed workloads configure `AZURE_STORAGE_TABLES_ENDPOINT` and authenticate through managed identity. Do not configure `AZURE_STORAGE_CONNECTION_STRING` in production. Grant the workload the narrowest applicable Storage Table Data role.

The pilot Azure account is `stbordchamp164164` in `bordchamp-rg` (`southafricanorth`), with Table endpoint `https://stbordchamp164164.table.core.windows.net`. Its 15 application tables are provisioned through [infra/main.bicep](../infra/main.bicep). Shared keys are disabled; the API connection path is `DefaultAzureCredential` plus `AZURE_STORAGE_TABLES_ENDPOINT`.

The effective account configuration disables public network access. A deployed API therefore needs VNet access to a Table private endpoint and `Storage Table Data Contributor` on its managed identity. Local Azurite remains the supported workstation data store until that Azure application network is deployed. See [infra/README.md](../infra/README.md) for deployment and role-assignment commands.