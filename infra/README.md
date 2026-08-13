# BordChamp Azure Table Storage

This deployment creates the BordChamp data resource group, StorageV2 account, Azure Tables, and a least-privilege Table data role assignment.

## Target

- Subscription: `ME-MngEnvMCAP164164-agahgnango-1`
- Subscription ID: `54f37e7a-f856-45ba-80b2-12d36b2df1fb`
- Resource group: `bordchamp-rg`
- Region: `southafricanorth`
- Storage account: `stbordchamp164164`
- Table endpoint: `https://stbordchamp164164.table.core.windows.net`

## Security

- Shared-key access is disabled.
- OAuth is the default authentication mode.
- HTTPS and TLS 1.2 are required.
- Blob public access and cross-tenant replication are disabled.
- Public network access is disabled in the effective Azure configuration.
- `Storage Table Data Contributor` is assigned only at the storage-account scope.

The API uses `DefaultAzureCredential` with `AZURE_STORAGE_TABLES_ENDPOINT`. Do not configure `AZURE_STORAGE_CONNECTION_STRING` in production.

## Deploy

Preview every change before deployment:

```powershell
az account set --subscription 54f37e7a-f856-45ba-80b2-12d36b2df1fb
az deployment sub what-if `
  --name bordchamp-storage-preview `
  --location southafricanorth `
  --template-file infra/main.bicep `
  --parameters infra/main.bicepparam
```

Deploy after reviewing the preview:

```powershell
az deployment sub create `
  --name bordchamp-storage `
  --location southafricanorth `
  --template-file infra/main.bicep `
  --parameters infra/main.bicepparam
```

## Application Identity

When the API is deployed to Azure, grant its managed identity `Storage Table Data Contributor` on the storage account. Replace `<principal-id>` with the API identity object ID:

```powershell
$storageId = az storage account show `
  --resource-group bordchamp-rg `
  --name stbordchamp164164 `
  --query id `
  --output tsv

az role assignment create `
  --assignee-object-id <principal-id> `
  --assignee-principal-type ServicePrincipal `
  --role "Storage Table Data Contributor" `
  --scope $storageId
```

The Azure-hosted API must have network reachability to the Table endpoint, normally through a virtual network and a `table` private endpoint with private DNS. Local bootstrap is intentionally blocked while public network access is disabled. Run `pnpm --filter @bordchamp/api storage:bootstrap` from the Azure-hosted workload after private connectivity and managed identity are active to seed reference entities idempotently.
