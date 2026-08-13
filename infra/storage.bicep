@description('Azure region for the storage account.')
param location string

@description('Globally unique StorageV2 account name.')
param storageAccountName string

@description('Storage redundancy SKU.')
param storageSkuName string

@description('Microsoft Entra object ID granted Storage Table Data Contributor.')
param tableDataPrincipalId string

var tableNames = [
  'ReferenceData'
  'Organizations'
  'UserDirectory'
  'Inventory'
  'ProductionUnits'
  'Inspections'
  'WarehouseReceipts'
  'Trading'
  'Settlements'
  'Deliveries'
  'Disputes'
  'Compliance'
  'Lineage'
  'Risk'
  'Integrations'
]

resource storageAccount 'Microsoft.Storage/storageAccounts@2026-04-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: storageSkuName
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    isHnsEnabled: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Disabled'
    supportsHttpsTrafficOnly: true
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
  tags: {
    application: 'BordChamp'
    environment: 'pilot'
    dataService: 'AzureTableStorage'
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2026-04-01' = {
  parent: storageAccount
  name: 'default'
}

resource tables 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = [for tableName in tableNames: {
  parent: tableService
  name: tableName
  properties: {}
}]

// Storage Table Data Contributor grants entity and table operations without account-key access.
var storageTableDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
)

resource tableDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, tableDataPrincipalId, storageTableDataContributorRoleDefinitionId)
  scope: storageAccount
  properties: {
    principalId: tableDataPrincipalId
    principalType: 'User'
    roleDefinitionId: storageTableDataContributorRoleDefinitionId
  }
}

output storageAccountName string = storageAccount.name
output storageAccountResourceId string = storageAccount.id
output tableEndpoint string = storageAccount.properties.primaryEndpoints.table
output tableNames array = tableNames
