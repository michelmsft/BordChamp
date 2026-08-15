targetScope = 'subscription'

@description('Azure region for the BordChamp resource group and storage account.')
param location string = 'southafricanorth'

@description('Resource group containing BordChamp data resources.')
param resourceGroupName string = 'bordchamp-rg'

@description('Globally unique StorageV2 account name.')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Microsoft Entra object ID granted access to BordChamp Table data for bootstrap and development.')
param tableDataPrincipalId string

@description('Storage redundancy. Standard_LRS is the cost-conscious pilot default.')
@allowed([
  'Standard_LRS'
  'Standard_ZRS'
])
param storageSkuName string = 'Standard_LRS'

@description('Azure region for Static Web Apps metadata. Static content is globally distributed.')
param staticWebAppLocation string = 'westeurope'

param managedIdentityName string = 'id-bordchamp-api'
param containerRegistryName string = 'crbordchamp164164'
param keyVaultName string = 'kv-bordchamp-164164'
param containerAppsEnvironmentName string = 'cae-bordchamp-private'
param containerAppName string = 'ca-bordchamp-api-private'
param staticWebAppName string = 'swa-bordchamp-164164'
param virtualNetworkName string = 'vnet-bordchamp-pilot'

@description('API image. Use the public placeholder for initial provisioning, then redeploy with the ACR image.')
param apiImage string = 'crbordchamp164164.azurecr.io/bordchamp-api:20260815.3'

@description('Enable production environment and Key Vault secret references after secrets are populated.')
param configureApiSecrets bool = false

@secure()
param authJwtPrivateKey string = ''

@secure()
param authJwtPublicKey string = ''

@secure()
param authSecretEncryptionKey string = ''

@secure()
param authRefreshTokenPepper string = ''

@secure()
param authChallengeKey string = ''

@secure()
param webhookSigningMasterSecret string = ''

@secure()
param escrowWebhookSecret string = ''

resource resourceGroup 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
  tags: {
    application: 'BordChamp'
    environment: 'pilot'
    managedBy: 'Bicep'
    dataClassification: 'business'
  }
}

module storage 'storage.bicep' = {
  name: 'bordchamp-storage'
  scope: resourceGroup
  params: {
    location: location
    storageAccountName: storageAccountName
    storageSkuName: storageSkuName
    tableDataPrincipalId: tableDataPrincipalId
  }
}

module hosting 'hosting.bicep' = {
  name: 'bordchamp-hosting'
  scope: resourceGroup
  params: {
    location: location
    staticWebAppLocation: staticWebAppLocation
    storageAccountName: storageAccountName
    deploymentPrincipalId: tableDataPrincipalId
    managedIdentityName: managedIdentityName
    containerRegistryName: containerRegistryName
    keyVaultName: keyVaultName
    containerAppsEnvironmentName: containerAppsEnvironmentName
    containerAppName: containerAppName
    staticWebAppName: staticWebAppName
    virtualNetworkName: virtualNetworkName
    apiImage: apiImage
    configureApiSecrets: configureApiSecrets
    authJwtPrivateKey: authJwtPrivateKey
    authJwtPublicKey: authJwtPublicKey
    authSecretEncryptionKey: authSecretEncryptionKey
    authRefreshTokenPepper: authRefreshTokenPepper
    authChallengeKey: authChallengeKey
    webhookSigningMasterSecret: webhookSigningMasterSecret
    escrowWebhookSecret: escrowWebhookSecret
  }
  dependsOn: [
    storage
  ]
}

output resourceGroupName string = resourceGroup.name
output storageAccountName string = storage.outputs.storageAccountName
output tableEndpoint string = storage.outputs.tableEndpoint
output storageAccountResourceId string = storage.outputs.storageAccountResourceId
output apiUrl string = hosting.outputs.apiUrl
output staticWebAppUrl string = hosting.outputs.staticWebAppUrl
output containerRegistryName string = hosting.outputs.containerRegistryName
output containerRegistryLoginServer string = hosting.outputs.containerRegistryLoginServer
output keyVaultName string = hosting.outputs.keyVaultName
output managedIdentityPrincipalId string = hosting.outputs.managedIdentityPrincipalId
output managedIdentityClientId string = hosting.outputs.managedIdentityClientId
