# BordChamp Azure Deployment Plan

Status: Validated

Recipe: Bicep + Azure CLI

Deployment scope: Existing Vite web app, NestJS API, and Azure Table persistence

## Objective

Replace development identity headers with BordChamp-managed email/password authentication, Microsoft Authenticator-compatible TOTP, and production user, organization, membership, invitation, and organization-selection workflows.

## Azure Context

- Subscription: `54f37e7a-f856-45ba-80b2-12d36b2df1fb`
- Existing resource group: `bordchamp-rg`
- Existing region: `southafricanorth`
- Existing storage account: `stbordchamp164164`
- Current accessible tenant: `304616a7-7248-4620-8cee-5562f30ee9ff` (workforce tenant; not suitable as the customer External ID tenant)
- External ID tenant: must be created or supplied before tenant-backed smoke testing

The custom BordChamp authentication implementation does not require an External ID tenant. The existing subscription, region, resource group, and storage account were reconfirmed on 2026-08-14.

## Deployment Architecture

- **Azure Static Web Apps Free** hosts the production Vite build with globally distributed static content and managed TLS.
- A small **SWA-managed Azure Function** proxies the same-origin `/api/*` route to the NestJS API. This preserves secure first-party refresh-cookie behavior while staying within the Free plan, which cannot link an existing Container App directly.
- **Azure Container Apps consumption** hosts the NestJS API with scale-to-zero enabled and a user-assigned managed identity in a VNet-integrated workload-profile environment.
- The existing `stbordchamp164164` StorageV2 account remains the system of record. `AZURE_STORAGE_TABLES_ENDPOINT` selects `AzureTableIdentityRepository`; no production storage connection string is used.
- The API user-assigned managed identity receives `Storage Table Data Contributor` at the storage-account scope and is selected through `AZURE_CLIENT_ID`.
- **Azure Container Apps secrets** store JWT signing keys, TOTP encryption key, refresh-token pepper, challenge key, and webhook secrets from secure Bicep parameters. Governance forces the provisioned Key Vault to private-only, so it is reserved for a future VNet hardening phase and is not a runtime dependency in this low-cost pilot.
- **Azure Container Registry Basic** stores the private API image and grants the Container App managed identity `AcrPull`.
- Storage public network access is disabled by governance. The API reaches Azure Tables through a `table` private endpoint and private DNS from its delegated Container Apps subnet. Authentication remains Microsoft Entra managed identity, shared-key access stays disabled, and HTTPS/TLS 1.2 remain mandatory.

### Request Path

1. Browser requests `https://<static-app>.azurestaticapps.net/api/v1/...`.
2. The SWA managed Function forwards the request to the Container App HTTPS ingress and returns status, headers, body, and cookies.
3. The NestJS API authenticates users and accesses Azure Tables through the VNet private endpoint using `DefaultAzureCredential` and its user-assigned identity.

### Cost Posture

- Static Web Apps: Free plan.
- Container Apps: consumption billing with zero minimum replicas; usage can remain within monthly grants for a light pilot.
- Key Vault: provisioned private-only for future hardening; no runtime operations in this pilot.
- Container Registry: Basic tier, the primary fixed monthly cost.
- Existing StorageV2 account: transaction and capacity charges continue.

This pilot architecture has no SLA on the SWA Free tier. The data plane is privately networked; the frontend and API ingress remain public HTTPS endpoints.

## Architecture

### Authentication

- Users register and sign in with a normalized email address and password.
- Passwords are hashed with Argon2id and never stored or logged in plaintext.
- Registration requires Microsoft Authenticator-compatible TOTP enrollment using a QR code and verification code.
- TOTP secrets are encrypted at rest with an application key; recovery codes are stored only as hashes.
- Login is two-stage: password verification followed by a six-digit Authenticator code.
- The API issues short-lived signed JWT access tokens and rotating refresh tokens.
- Refresh tokens are stored as hashes and sent only in `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
- Refresh-token reuse revokes the token family.
- Logout revokes the current refresh-token family and clears the cookie.
- No identity provider tenant, application registration, CIAM subdomain, MSAL, or browser client secret is used.

### API Authentication

- Add an ESM-compatible `jose` local JWT signer/verifier using an asymmetric key pair supplied through secure environment configuration.
- Add a global NestJS authentication guard and explicit `@Public()` metadata.
- Validate RS256 signature, exact BordChamp issuer, audience, token lifetime, token type, and session version.
- Public routes remain limited to health, public commodities, public market/event feeds, and the HMAC-protected escrow callback.
- Resolve the authenticated principal by immutable BordChamp user ID. Email is a unique normalized login identifier, not the authorization key.
- `RequestActorService` derives personas, memberships, mandates, assignments, and active organization from BordChamp persistence.
- `X-BordChamp-Organization-Id` is retained only as an untrusted organization selector. The API verifies active membership before using it.
- Delete all runtime acceptance of `x-user-id`, `x-personas`, and `x-organization-id`.

### Azure Table Persistence

Use the existing `UserDirectory` and `Organizations` tables:

- `UserDirectory / LOGIN / EMAIL:<email-hash>`: normalized-email lookup to BordChamp user ID.
- `UserDirectory / <userId> / PROFILE`: profile, status, locale, onboarding state, preferred organization, ETag.
- `UserDirectory / <userId> / CREDENTIAL`: Argon2id password hash, encrypted TOTP secret, MFA status, session version.
- `UserDirectory / <userId> / REFRESH:<tokenId>`: refresh-token hash, family ID, expiry, status, replacement token ID.
- `UserDirectory / <userId> / RECOVERY:<codeId>`: recovery-code hash and consumption state.
- `UserDirectory / <userId> / MEMBER:<organizationId>`: membership projection and personas.
- `Organizations / <organizationId> / MEMBER:<userId>`: authoritative membership, role, personas, status, inviter, ETag.
- `Organizations / <organizationId> / INVITE:<invitationId>`: destination hash, token hash, role/personas, status, expiry.
- Existing `AUDIT:` convention records profile, membership, invitation, and organization actions.

Invitation secrets are random and only their SHA-256 hashes are stored. Acceptance is idempotent and requires an authenticated user.

### API Contracts

- `POST /v1/auth/register`: create pending account and return TOTP enrollment URI plus enrollment challenge.
- `POST /v1/auth/register/verify`: verify first TOTP code, activate account, issue access/refresh tokens, and return one-time recovery codes.
- `POST /v1/auth/login`: verify email/password and return an MFA challenge.
- `POST /v1/auth/login/verify`: verify TOTP or recovery code and issue access/refresh tokens.
- `POST /v1/auth/refresh`: rotate the refresh cookie and issue a new access token.
- `POST /v1/auth/logout`: revoke refresh family and clear cookie.
- `GET /v1/me`: return profile, onboarding state, memberships, organizations, preferred/active organization, and effective personas.
- `PATCH /v1/me/profile`: ETag-protected profile update.
- `POST /v1/me/onboarding/complete`: finalize required user profile data.
- `GET /v1/me/organizations`: organization selector data.
- `PUT /v1/me/active-organization`: validate membership and persist preference.
- `POST /v1/onboarding/organization`: create an organization plus owner membership/projections as one onboarding operation.
- `GET /v1/organizations/:id/members`.
- `PATCH /v1/organizations/:id/members/:userId`.
- `POST/GET /v1/organizations/:id/invitations`.
- `POST /v1/organizations/:id/invitations/:invitationId/accept`.
- `POST /v1/organizations/:id/invitations/:invitationId/revoke`.

### Web Experience

- Add native email/password registration and login screens.
- Add QR-based Authenticator enrollment, TOTP verification, recovery-code display/download, logout, and automatic refresh-cookie renewal.
- Replace the editable development identity dialog with authenticated profile/account controls.
- Add first-login profile and organization onboarding wizard.
- Add member and invitation administration to the ERP.
- Add an organization selector for users with multiple active memberships.
- Keep public market screens available without authentication.
- Keep the advanced command console, but authorize it from the authenticated BordChamp session rather than development headers.

## Implementation Phases

1. Add password/TOTP/refresh persistence, local JWT signer/verifier, global guard, public-route metadata, and authentication tests.
2. Add user/profile/membership/invitation repositories with Azure Table and in-memory adapters.
3. Add `/me`, onboarding, membership, invitation, and organization-selection services/controllers.
4. Repair organization-owner membership projection symmetry and add authorization catalog actions/tests.
5. Convert E2E tests to bearer helpers; add invalid issuer/audience/signature/expiry, TOTP replay/window, refresh rotation/reuse, and cross-organization tests.
6. Add native auth context, bearer API client, login/registration/TOTP/logout/refresh, onboarding, invitations, and selector UI.
7. Remove development identity types, local storage, dialogs, and all three development headers.
8. Configure signing/encryption keys and secure cookie settings in the Azure-hosted API.
9. Validate complete registration, Authenticator enrollment, login, refresh rotation, logout, and recovery in browser/API smoke tests.

## Constraints

- No client secrets in the SPA.
- API validates issuer, audience, signature, lifetime, and required subject claims.
- Organization/persona authorization comes from BordChamp persistence, not mutable browser headers.
- Existing business authorization and command APIs remain intact.
- Existing Azure Table data model remains the system of record.
- Normal automated tests do not depend on a live External ID tenant.
- External ID configuration values are environment variables; no secrets are committed.
- Existing Azurite development remains supported with authenticated test identities only.
- Deployment will not proceed until this plan is finalized and approved.

## Required Secure Configuration

- RS256 private/public signing key pair for access tokens.
- 32-byte encryption key for TOTP secrets.
- Cookie domain and HTTPS production origin.
- Optional transactional email provider for account recovery and invitation delivery.

## Validation Gates

- [x] All available pre-deployment validation checks pass
	- [x] Core validation: Azure CLI, authentication, Bicep build, subscription validation, and what-if
	- [x] Bicep linting
	- [x] Container build inputs verified through the successful native workspace build; Azure Container Registry Build is the first blocking deployment gate because no local or WSL container engine is available
	- [x] Azure Policy validation
- API/web strict TypeScript and lint.
- Unit tests for token validation and membership/invitation state changes.
- Full business E2E suite converted to bearer-token helpers.
- Azurite and in-memory suites.
- Production builds.
- Browser checks for sign-in shell, onboarding, organization switching, invitations, logout, and mobile layouts.
- Browser-backed registration, QR enrollment, Authenticator code, login, refresh, and logout smoke test.

## Deployment Steps

1. Add the API production container definition and SWA managed proxy Function.
2. Extend Bicep with Static Web Apps Free, Container Registry Basic, Container Apps environment/API, Key Vault, managed identities, role assignments, and application settings.
3. Keep storage public network access disabled and add a Table private endpoint, private DNS, and a VNet-integrated Container Apps environment.
4. Generate production authentication secrets locally and transmit them only as secure deployment parameters into native Container Apps secrets; do not write secret values to tracked files or command output.
5. Build and validate the monorepo, API image, and SWA frontend/proxy artifacts locally.
6. Run Bicep lint/build and subscription-scope `what-if`; inspect any resource replacement, deletion, RBAC, or network change.
7. Provision Azure resources, wait for `AcrPull` and Table RBAC propagation, push the API image, and update the Container App revision.
8. Deploy the Vite build and managed proxy to Static Web Apps Free.
9. Run live RBAC verification and smoke-test health, registration, TOTP enrollment, login, refresh, logout, and persisted login after API restart/scale-to-zero.

## Validation Proof

Validated at `2026-08-14T16:32:09Z` against subscription `54f37e7a-f856-45ba-80b2-12d36b2df1fb`.

- `pnpm build`: passed for domain, authz, API, web, and SWA proxy packages.
- `pnpm test`: passed; 36 tests passed across authz and API, with no-test packages accepted explicitly.
- `pnpm --filter @bordchamp/swa-api check`: passed.
- `az bicep build --file infra/main.bicep`: passed with no diagnostics.
- `az bicep lint --file infra/main.bicep`: passed with no diagnostics.
- Official `validate-deployment.ps1` at subscription scope with `infra/main.bicepparam`: `OVERALL: PASS` for Azure CLI, authentication, Bicep compilation, ARM validation, and what-if.
- What-if summary: 11 creates, 3 modifications, 0 deletes. Resource-ID review shows new Container Apps, ACR, Key Vault, user-assigned identity, Static Web Apps Free, and resource-scoped RBAC; existing storage/tables are deployed in place; the Event Grid topic is ignored.
- Azure Policy: applicable management-group deploy/audit/deny, resource-creation, MFA-on-write/delete, and Defender assignments reviewed. ARM validation passed under enforcement mode `Default`.
- Static RBAC: verified as documented below.
- Local Docker build: unavailable because no Docker engine is installed. The identical `apps/api/Dockerfile` will be built by Azure Container Registry Build immediately after registry provisioning; API rollout is blocked until that build succeeds.
- ACR Build run `df1`: passed and pushed `crbordchamp164164.azurecr.io/bordchamp-api:20260814.1`.
- Static Web Apps: deployed through the cached SWA CLI without npm package resolution; the production environment reports `Ready`.
- Private networking: storage public access is `Disabled`; the Table private endpoint is `Approved`, private DNS is linked to `vnet-bordchamp-pilot`, and the replacement API runs in `cae-bordchamp-private`.
- Identity persistence: registration and TOTP enrollment succeeded, `ca-bordchamp-api-private` was restarted, and login with the same identity succeeded afterward from Azure Tables.
- Production route: the SWA root and `/api/health` return HTTP 200, and registration through the same-origin `/api` proxy succeeds.

## Role Assignment Verification

- Status: Verified on 2026-08-14.
- API identity: `id-bordchamp-api`.
- `Storage Table Data Contributor` is scoped to `stbordchamp164164` for entity/table operations used by all Azure Table repositories.
- Container Apps secrets are supplied through secure deployment parameters; the API does not require Key Vault data-plane access in this pilot.
- `AcrPull` is scoped to `crbordchamp164164` for managed-identity image pulls.
- Deployment principal `76091599-8241-44cb-aa8e-18d7e8b9cf37` has resource-scoped `AcrPush` and `Key Vault Secrets Officer` roles for image and secret deployment.
- The existing local bootstrap principal retains resource-scoped `Storage Table Data Contributor`.
- No generic Owner, Contributor, or subscription-scoped application data roles are introduced.

## Approval

Authentication implementation and the Azure deployment architecture above were approved by the user on 2026-08-14. No External ID tenant or subdomain is required.
