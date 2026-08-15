targetScope = 'resourceGroup'

param location string
param staticWebAppLocation string
param storageAccountName string
param deploymentPrincipalId string
param managedIdentityName string
param containerRegistryName string
param keyVaultName string
param containerAppsEnvironmentName string
param containerAppName string
param staticWebAppName string
param virtualNetworkName string
param apiImage string
param configureApiSecrets bool

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

var tags = {
  application: 'BordChamp'
  environment: 'pilot'
  managedBy: 'Bicep'
}

module virtualNetwork 'br/public:avm/res/network/virtual-network:0.10.1' = {
  name: 'bordchamp-network'
  params: {
    name: virtualNetworkName
    location: location
    addressPrefixes: [
      '10.42.0.0/24'
    ]
    subnets: [
      {
        name: 'snet-container-apps'
        addressPrefix: '10.42.0.0/27'
        delegation: 'Microsoft.App/environments'
      }
      {
        name: 'snet-private-endpoints'
        addressPrefix: '10.42.0.32/27'
        privateEndpointNetworkPolicies: 'Disabled'
      }
    ]
    tags: tags
  }
}

module tablePrivateDnsZone 'br/public:avm/res/network/private-dns-zone:0.8.1' = {
  name: 'bordchamp-table-private-dns'
  params: {
    name: 'privatelink.table.${az.environment().suffixes.storage}'
    virtualNetworkLinks: [
      {
        name: '${virtualNetworkName}-link'
        virtualNetworkResourceId: virtualNetwork.outputs.resourceId
        registrationEnabled: false
      }
    ]
    tags: tags
  }
}

module apiIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.6.0' = {
  name: 'bordchamp-api-identity'
  params: {
    name: managedIdentityName
    location: location
    tags: tags
  }
}

module registry 'br/public:avm/res/container-registry/registry:0.12.1' = {
  name: 'bordchamp-registry'
  params: {
    name: containerRegistryName
    location: location
    acrSku: 'Basic'
    acrAdminUserEnabled: false
    roleAssignments: [
      {
        principalId: apiIdentity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'AcrPull'
      }
      {
        principalId: deploymentPrincipalId
        principalType: 'User'
        roleDefinitionIdOrName: 'AcrPush'
      }
    ]
    tags: tags
  }
}

module keyVault 'br/public:avm/res/key-vault/vault:0.14.0' = {
  name: 'bordchamp-key-vault'
  params: {
    name: keyVaultName
    location: location
    sku: 'standard'
    enableRbacAuthorization: true
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    roleAssignments: [
      {
        principalId: deploymentPrincipalId
        principalType: 'User'
        roleDefinitionIdOrName: 'Key Vault Secrets Officer'
      }
    ]
    tags: tags
  }
}

module environment 'br/public:avm/res/app/managed-environment:0.15.0' = {
  name: 'bordchamp-container-environment'
  params: {
    name: containerAppsEnvironmentName
    location: location
    infrastructureSubnetResourceId: virtualNetwork.outputs.subnetResourceIds[0]
    publicNetworkAccess: 'Enabled'
    zoneRedundant: false
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
    tags: tags
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

module tablePrivateEndpoint 'br/public:avm/res/network/private-endpoint:0.12.1' = {
  name: 'bordchamp-table-private-endpoint'
  params: {
    name: 'pep-${storageAccountName}-table'
    location: location
    subnetResourceId: virtualNetwork.outputs.subnetResourceIds[1]
    privateLinkServiceConnections: [
      {
        name: '${storageAccountName}-table'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: [
            'table'
          ]
        }
      }
    ]
    privateDnsZoneGroup: {
      name: 'table'
      privateDnsZoneGroupConfigs: [
        {
          privateDnsZoneResourceId: tablePrivateDnsZone.outputs.resourceId
        }
      ]
    }
    tags: tags
  }
}

var storageTableDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
)

resource apiTableDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, managedIdentityName, storageTableDataContributorRoleDefinitionId)
  scope: storageAccount
  properties: {
    principalId: apiIdentity.outputs.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleDefinitionId
  }
}

var apiSecrets = configureApiSecrets ? [
  {
    name: 'auth-jwt-private-key'
    value: authJwtPrivateKey
  }
  {
    name: 'auth-jwt-public-key'
    value: authJwtPublicKey
  }
  {
    name: 'auth-secret-encryption-key'
    value: authSecretEncryptionKey
  }
  {
    name: 'auth-refresh-token-pepper'
    value: authRefreshTokenPepper
  }
  {
    name: 'auth-challenge-key'
    value: authChallengeKey
  }
  {
    name: 'webhook-signing-master-secret'
    value: webhookSigningMasterSecret
  }
  {
    name: 'escrow-webhook-secret'
    value: escrowWebhookSecret
  }
] : []

var tableEnvironmentVariables = [
  {
    name: 'AZURE_STORAGE_TABLES_ENDPOINT'
    value: storageAccount.properties.primaryEndpoints.table
  }
  {
    name: 'AZURE_STORAGE_COMMODITIES_TABLE'
    value: 'ReferenceData'
  }
  {
    name: 'AZURE_STORAGE_ORGANIZATIONS_TABLE'
    value: 'Organizations'
  }
  {
    name: 'AZURE_STORAGE_USER_DIRECTORY_TABLE'
    value: 'UserDirectory'
  }
  {
    name: 'AZURE_STORAGE_INVENTORY_TABLE'
    value: 'Inventory'
  }
  {
    name: 'AZURE_STORAGE_PRODUCTION_UNITS_TABLE'
    value: 'ProductionUnits'
  }
  {
    name: 'AZURE_STORAGE_INSPECTIONS_TABLE'
    value: 'Inspections'
  }
  {
    name: 'AZURE_STORAGE_WAREHOUSE_RECEIPTS_TABLE'
    value: 'WarehouseReceipts'
  }
  {
    name: 'AZURE_STORAGE_TRADING_TABLE'
    value: 'Trading'
  }
  {
    name: 'AZURE_STORAGE_SETTLEMENTS_TABLE'
    value: 'Settlements'
  }
  {
    name: 'AZURE_STORAGE_DELIVERIES_TABLE'
    value: 'Deliveries'
  }
  {
    name: 'AZURE_STORAGE_DISPUTES_TABLE'
    value: 'Disputes'
  }
  {
    name: 'AZURE_STORAGE_COMPLIANCE_TABLE'
    value: 'Compliance'
  }
  {
    name: 'AZURE_STORAGE_LINEAGE_TABLE'
    value: 'Lineage'
  }
  {
    name: 'AZURE_STORAGE_RISK_TABLE'
    value: 'Risk'
  }
  {
    name: 'AZURE_STORAGE_INTEGRATIONS_TABLE'
    value: 'Integrations'
  }
]

var authEnvironmentVariables = configureApiSecrets ? [
  {
    name: 'AUTH_JWT_PRIVATE_KEY'
    secretRef: 'auth-jwt-private-key'
  }
  {
    name: 'AUTH_JWT_PUBLIC_KEY'
    secretRef: 'auth-jwt-public-key'
  }
  {
    name: 'AUTH_SECRET_ENCRYPTION_KEY'
    secretRef: 'auth-secret-encryption-key'
  }
  {
    name: 'AUTH_REFRESH_TOKEN_PEPPER'
    secretRef: 'auth-refresh-token-pepper'
  }
  {
    name: 'AUTH_CHALLENGE_KEY'
    secretRef: 'auth-challenge-key'
  }
  {
    name: 'WEBHOOK_SIGNING_MASTER_SECRET'
    secretRef: 'webhook-signing-master-secret'
  }
  {
    name: 'ESCROW_WEBHOOK_SECRET'
    secretRef: 'escrow-webhook-secret'
  }
] : []

var apiEnvironmentVariables = concat([
  {
    name: 'NODE_ENV'
    value: configureApiSecrets ? 'production' : 'development'
  }
  {
    name: 'PORT'
    value: '3000'
  }
  {
    name: 'AZURE_CLIENT_ID'
    value: apiIdentity.outputs.clientId
  }
  {
    name: 'BORDCHAMP_SKIP_ADMIN_SEED'
    value: '1'
  }
], tableEnvironmentVariables, authEnvironmentVariables)

module api 'br/public:avm/res/app/container-app:0.23.0' = {
  name: 'bordchamp-api'
  params: {
    name: containerAppName
    location: location
    environmentResourceId: environment.outputs.resourceId
    managedIdentities: {
      userAssignedResourceIds: [
        apiIdentity.outputs.resourceId
      ]
    }
    registries: [
      {
        server: registry.outputs.loginServer
        identity: apiIdentity.outputs.resourceId
      }
    ]
    secrets: apiSecrets
    containers: [
      {
        name: 'api'
        image: apiImage
        env: apiEnvironmentVariables
        resources: {
          cpu: json('0.5')
          memory: '1Gi'
        }
        probes: configureApiSecrets ? [
          {
            type: 'Liveness'
            httpGet: {
              path: '/health'
              port: 3000
              scheme: 'HTTP'
            }
            initialDelaySeconds: 10
            periodSeconds: 30
          }
          {
            type: 'Readiness'
            httpGet: {
              path: '/health'
              port: 3000
              scheme: 'HTTP'
            }
            initialDelaySeconds: 5
            periodSeconds: 10
          }
        ] : []
      }
    ]
    ingressExternal: true
    ingressAllowInsecure: false
    ingressTargetPort: 3000
    ingressTransport: 'auto'
    scaleSettings: {
      minReplicas: 0
      maxReplicas: 2
      rules: [
        {
          name: 'http-requests'
          http: {
            metadata: {
              concurrentRequests: '50'
            }
          }
        }
      ]
    }
    tags: tags
  }
  dependsOn: [
    apiTableDataContributor
    tablePrivateEndpoint
  ]
}

module staticWebApp 'br/public:avm/res/web/static-site:0.9.5' = {
  name: 'bordchamp-static-web-app'
  params: {
    name: staticWebAppName
    location: staticWebAppLocation
    sku: 'Free'
    publicNetworkAccess: 'Enabled'
    functionAppSettings: {
      BORDCHAMP_API_URL: 'https://${api.outputs.fqdn}/'
    }
    tags: tags
  }
}

output apiUrl string = 'https://${api.outputs.fqdn}'
output staticWebAppUrl string = 'https://${staticWebApp.outputs.defaultHostname}'
output containerRegistryName string = registry.outputs.name
output containerRegistryLoginServer string = registry.outputs.loginServer
output keyVaultName string = keyVault.outputs.name
output managedIdentityPrincipalId string = apiIdentity.outputs.principalId
output managedIdentityClientId string = apiIdentity.outputs.clientId