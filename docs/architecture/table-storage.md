# Azure Table Storage Architecture

BordChamp uses Azure Table Storage as its operational persistence service. The application accesses tables through module-owned repository interfaces so business logic does not depend directly on the Azure SDK.

## Authentication

- Azure-hosted applications use `DefaultAzureCredential` with a managed identity.
- Local development may use Azure CLI or developer credentials resolved by `DefaultAzureCredential`.
- Storage account keys and connection strings must not be stored in source or application settings.
- Each workload receives the narrowest applicable Storage Table Data role.

## Modeling Rules

1. Design every query from its partition key first. Production endpoints must not rely on unbounded table scans.
2. Store an aggregate and its append-only events in one partition when they require atomic batch operations.
3. Use immutable entity identifiers. Never reuse a `RowKey` for a different business entity.
4. Use ETags for optimistic concurrency on every state-changing command.
5. Deactivate entities by status and effective date. Do not delete entities referenced by historical activity.
6. Store immutable history or superseding versions for inspections, receipts, trades, ledger postings, delivery evidence, disputes, and audit records.
7. Maintain denormalized read projections for access patterns that would otherwise require joins.
8. Make projection handlers and external callbacks idempotent using stable event or request identifiers.
9. Keep large documents, photos, certificates, and POD evidence in Blob Storage; Table entities store metadata and blob references only.
10. Record money as integer minor units and quantities as normalized integers plus unit and scale. Do not use JavaScript floating-point values for financial calculations.

## Initial Tables

| Table | Partition key | Row key | Purpose |
|---|---|---|---|
| `ReferenceData` | Reference-data class, for example `PUBLIC_COMMODITY` | Stable code or versioned code | Public and controlled reference entities |
| `Organizations` | Organization ID | Entity type and ID | Organization profile, memberships, mandates, facilities |
| `Inventory` | Lot or batch ID | Snapshot or event sequence | Current lot state and immutable lineage events |
| `Trading` | Order, RFQ, or trade aggregate ID | Snapshot or event sequence | Trading aggregate state and events |
| `Settlement` | Settlement obligation ID | Journal sequence | Balanced postings and escrow lifecycle |
| `Delivery` | Delivery ID | Snapshot or event sequence | Delivery milestones, acceptance, and rejection |
| `Audit` | UTC date bucket plus organization or system scope | Time-sortable immutable event ID | Tamper-evident operational audit records |

Table names may be environment-prefixed or placed in environment-specific storage accounts. Production should use a separate storage account from development and test.

## Atomicity Boundaries

Azure Table Storage transactions are limited to entities in the same partition, with service limits on operation count and payload size. Consequently:

- A command changes one aggregate partition atomically.
- Cross-aggregate workflows use durable state machines, idempotent steps, and compensating actions.
- Both sides of a double-entry posting for one settlement obligation reside in the same partition and are submitted in one transaction.
- Inventory reservation and order acceptance use ETags and explicit retry/conflict responses.
- Public and participant-facing projections are eventually consistent and expose their update timestamp where material.

## Reference Data

The public commodity endpoint reads only the `PUBLIC_COMMODITY` partition and filters `isPublic eq true` and `status eq 'active'`. Historical or inactive versions remain stored but cannot enter new activity. Effective-dated versions will use versioned rows while a current projection provides efficient reads.

## Configuration

```text
AZURE_STORAGE_TABLES_ENDPOINT=https://<account>.table.core.windows.net
AZURE_STORAGE_COMMODITIES_TABLE=ReferenceData
```

When the endpoint is absent, the API uses the in-memory repository for local development and automated tests. Production configuration must provide the endpoint and managed-identity data-plane access.

## Known Constraints

Table Storage has no joins, secondary indexes, uniqueness constraints beyond `PartitionKey` plus `RowKey`, or cross-partition transactions. New features must define their read and write access patterns before adding entities. Continuous matching and financial reconciliation require especially careful single-writer, partition, idempotency, and recovery designs; the storage choice must be load-tested against their target throughput before those mechanisms are enabled.