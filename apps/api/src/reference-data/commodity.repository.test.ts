import type { TableClient } from "@azure/data-tables";
import { describe, expect, it } from "vitest";

import { AzureTableCommodityRepository } from "./commodity.repository.js";

describe("AzureTableCommodityRepository", () => {
  it("queries only active public commodities in the public partition", async () => {
    let receivedOptions: unknown;
    const client = {
      listEntities: (options: unknown) => {
        receivedOptions = options;

        return (async function* entities() {
          yield {
            partitionKey: "PUBLIC_COMMODITY",
            rowKey: "TOMATO",
            category: "crop",
            nameEn: "Tomato",
            nameFr: "Tomate",
            isPublic: true,
            status: "active",
            effectiveFrom: "2026-08-12T00:00:00.000Z",
          };
        })();
      },
    } as unknown as TableClient;

    const repository = new AzureTableCommodityRepository(client);

    await expect(repository.listPublicActive()).resolves.toEqual([
      {
        code: "TOMATO",
        category: "crop",
        name: { en: "Tomato", fr: "Tomate" },
        public: true,
      },
    ]);
    expect(receivedOptions).toEqual({
      queryOptions: {
        filter:
          "PartitionKey eq 'PUBLIC_COMMODITY' and isPublic eq true and status eq 'active'",
        select: ["RowKey", "category", "nameEn", "nameFr", "iconName", "imageName"],
      },
    });
  });
});