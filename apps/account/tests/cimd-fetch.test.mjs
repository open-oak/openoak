import assert from "node:assert/strict";
import test from "node:test";

import { createPinnedLookup } from "../lib/cimd-fetch.ts";

const pinnedAddress = { address: "203.0.113.10", family: 4 };

test("pinned lookup returns an address array when Node requests all addresses", async () => {
  const result = await new Promise((resolve, reject) => {
    createPinnedLookup(pinnedAddress)("metadata.example", { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });

  assert.deepEqual(result, [pinnedAddress]);
});

test("pinned lookup retains the legacy single-address callback shape", async () => {
  const result = await new Promise((resolve, reject) => {
    createPinnedLookup(pinnedAddress)("metadata.example", {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });

  assert.deepEqual(result, pinnedAddress);
});
