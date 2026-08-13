# BordChamp Authentication and Organization Onboarding Plan

Status: Approved - Implementation In Progress (custom authentication)

## Objective

Replace development identity headers with BordChamp-managed email/password authentication, Microsoft Authenticator-compatible TOTP, and production user, organization, membership, invitation, and organization-selection workflows.

## Azure Context

- Subscription: `54f37e7a-f856-45ba-80b2-12d36b2df1fb`
- Existing resource group: `bordchamp-rg`
- Existing region: `southafricanorth`
- Existing storage account: `stbordchamp164164`
- Current accessible tenant: `304616a7-7248-4620-8cee-5562f30ee9ff` (workforce tenant; not suitable as the customer External ID tenant)
- External ID tenant: must be created or supplied before tenant-backed smoke testing

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

- API/web strict TypeScript and lint.
- Unit tests for token validation and membership/invitation state changes.
- Full business E2E suite converted to bearer-token helpers.
- Azurite and in-memory suites.
- Production builds.
- Browser checks for sign-in shell, onboarding, organization switching, invitations, logout, and mobile layouts.
- Browser-backed registration, QR enrollment, Authenticator code, login, refresh, and logout smoke test.

## Approval

Approved by user. No External ID tenant or subdomain is required.
