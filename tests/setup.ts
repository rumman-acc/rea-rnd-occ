import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, vi } from "vitest";

// findBy*/waitFor default to 1s, which a cold first render can exceed when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 6000 });

// Path used by the mocked next/navigation; tests may override via setPathname().
declare global {
  var __testPathname: string | undefined;
}

vi.mock("next/navigation", () => ({
  usePathname: () => globalThis.__testPathname ?? "/",
}));

// Canvas charts cannot render in jsdom. The mocks expose the exact data and options
// the page passes to the chart library so tests can assert on them.
vi.mock("react-chartjs-2", () => ({
  Doughnut: (props: { data: unknown; options: unknown }) =>
    createElement("div", {
      "data-testid": "chart-doughnut",
      "data-config": JSON.stringify({ data: props.data, options: props.options }),
    }),
  Bar: (props: { data: unknown; options: unknown }) =>
    createElement("div", {
      "data-testid": "chart-bar",
      "data-config": JSON.stringify({ data: props.data, options: props.options }),
    }),
}));

afterEach(() => {
  cleanup();
  globalThis.__testPathname = undefined;
  vi.restoreAllMocks();
});
