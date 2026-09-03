import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
beforeEach(() => {
  localStorage.clear();
  window.location.hash = "#/overview";
  window.scrollTo = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          chainId: 50312,
          network: "Somnia Shannon",
          factory: null,
          collateral: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
          module: "0x3ecC694Cef705358864a646142ac17A90E29e388",
          explorer: "https://shannon-explorer.somnia.network",
          publicRpc: "https://api.infra.testnet.somnia.network",
          liveConfigured: false,
          executionConfigured: false,
          modelConfigured: false,
        }),
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
