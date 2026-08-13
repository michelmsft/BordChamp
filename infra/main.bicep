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

output resourceGroupName string = resourceGroup.name
output storageAccountName string = storage.outputs.storageAccountName
output tableEndpoint string = storage.outputs.tableEndpoint
output storageAccountResourceId string = storage.outputs.storageAccountResourceId
