// Infrastructure for the Cert Portal (spec §III.1, SETUP.md). SWA Standard +
// Storage (Table) + Key Vault, with a managed identity granted table access.
// Deploy: az deployment group create -g <rg> -f infra/main.bicep
@description('Base name for resources')
param baseName string = 'certportal'
@description('Location')
param location string = resourceGroup().location
@description('Azure region for the Static Web App (Static Web Apps is not available in every Azure region)')
param staticWebAppLocation string = 'eastus2'

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: toLower('${baseName}store')
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

var keyVaultName = '${baseName}-kv-${take(uniqueString(subscription().id, resourceGroup().id), 8)}'

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
  }
}

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: baseName
  location: staticWebAppLocation
  sku: { name: 'Standard', tier: 'Standard' } // Standard required for custom auth + MI
  identity: { type: 'SystemAssigned' }
  properties: {}
}

// Grant the SWA managed identity table data access on the storage account.
var tableDataContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
resource roleAssign 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, swa.id, tableDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: tableDataContributor
    principalId: swa.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output storageTableEndpoint string = storage.properties.primaryEndpoints.table
output staticWebAppName string = swa.name
output keyVaultName string = kv.name
