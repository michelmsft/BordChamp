import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

const options = {
  retryOptions: {
    maxRetries: 4,
    retryDelayInMs: 800,
    maxRetryDelayInMs: 8_000,
  },
};

export function hasTableStorageConfiguration(): boolean {
  return Boolean(
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
      process.env.AZURE_STORAGE_TABLES_ENDPOINT,
  );
}

export function createTableClient(tableName: string): TableClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString !== undefined && connectionString.length > 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AZURE_STORAGE_CONNECTION_STRING is for local development only; use managed identity in production",
      );
    }
    return TableClient.fromConnectionString(connectionString, tableName, options);
  }

  const endpoint = process.env.AZURE_STORAGE_TABLES_ENDPOINT;
  if (endpoint === undefined || endpoint.length === 0) {
    throw new Error("Azure Table Storage is not configured");
  }

  return new TableClient(
    endpoint,
    tableName,
    new DefaultAzureCredential(),
    options,
  );
}