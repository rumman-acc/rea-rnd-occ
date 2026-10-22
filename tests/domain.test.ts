import { describe, expect, it } from "vitest";
import { barData, donutData, PALETTE } from "@/domain/chartModels";
import { atRiskRows, criticalTone, healthCounts, linkedTone, onTimeTone, redCount, seriesSummaries } from "@/domain/derive";
import { formatClockTime, formatLongDate, formatMoney, formatShortDate, formatUnits, todayIso } from "@/domain/format";
import { applyFilters, nextSort, viewRows, type Filters, type SortState } from "@/domain/table";
import type { StatusRow } from "@/domain/types";
import { FX_ROWS } from "@/data/fixtures";
import { testRuntime } from "./helpers";

const rows = FX_ROWS as StatusRow[];
const ids = (rs: StatusRow[]) => rs.map((r) => r.so_number.replace("S-ORD", ""));
const nonGreen = atRiskRows(rows);

describe("derivations (ARC-007)", () => {
  it("counts health per row (CHT-002)", () => {
    expect(healthCounts(rows)).toEqual({ green: 1, yellow: 2, red: 5 });
  });

  it("badge counts red rows only (FR-013a)", () => {
    expect(redCount(rows)).toBe(5);
    expect(redCount([])).toBe(0);
  });

  it("table rows are the non-green rows in provider order (TBL-004)", () => {
    expect(ids(nonGreen)).toEqual(["101001", "101006", "101005", "101007", "101004", "101008", "101003"]);
  });

  it("sums units per series, in string order of the series key (CHT-011)", () => {
    expect(seriesSummaries(rows).map((s) => [s.series, s.total])).toEqual([
      ["1000", 23],
      ["2000", 18],
      ["3000", 3],
      ["6000", 1],
    ]);
    const mk = (series: string | null, quantity: number): StatusRow => ({ ...rows[0], series, quantity });
    expect(seriesSummaries([mk("9", 1), mk("10", 1), mk(null, 2)]).map((s) => s.series)).toEqual(["10", "9", "other"]);
  });

  it("worst health per series is red > yellow > green (SUP-003)", () => {
    expect(seriesSummaries(rows).map((s) => s.worst)).toEqual(["red", "red", "red", "red"]);
    const green = rows.filter((r) => r.health === "green");
    expect(seriesSummaries(green)[0].worst).toBe("green");
    const yellow = rows.filter((r) => r.health === "yellow");
    expect(seriesSummaries(yellow).map((s) => s.worst)).toEqual(["yellow", "yellow"]);
  });

  it("KPI tone thresholds (KPI-014)", () => {
    expect([74, 75, 89, 90].map(onTimeTone)).toEqual(["red", "amber", "amber", "green"]);
    expect([59, 60, 89, 90].map(linkedTone)).toEqual(["red", "amber", "amber", "green"]);
    expect([0, 5, 6].map(criticalTone)).toEqual(["green", "amber", "red"]);
  });
});

describe("chart models (CHT-001, CHT-010)", () => {
  it("donut data and colors", () => {
    const d = donutData(rows);
    expect(d.labels).toEqual(["Safe", "Watch", "At Risk"]);
    expect(d.datasets[0].data).toEqual([1, 2, 5]);
    expect(d.datasets[0].backgroundColor).toEqual(["#16a34a", "#d97706", "#dc2626"]);
    expect(d.datasets[0].borderWidth).toBe(2);
  });

  it("bar data", () => {
    const b = barData(rows);
    expect(b.labels).toEqual(["1000", "2000", "3000", "6000"]);
    expect(b.datasets[0].data).toEqual([23, 18, 3, 1]);
    expect(b.datasets[0].label).toBe("Units");
    expect(b.datasets[0].backgroundColor).toBe(PALETTE.brand);
  });
});

describe("formatting (KPI-015, TBL-006)", () => {
  it("money and units", () => {
    expect(formatMoney(43975)).toBe("$43,975");
    expect(formatMoney(33857.5)).toBe("$33,858");
    expect(formatMoney(null)).toBe("—");
    expect(formatUnits(45)).toBe("45");
    expect(formatUnits(2.25)).toBe("2.3");
    expect(formatUnits(undefined)).toBe("—");
  });

  it("short delivery date has no year; absent is a dash", () => {
    expect(formatShortDate("2026-10-22")).toBe("Oct 22");
    expect(formatShortDate("2026-11-05T08:00:00")).toBe("Nov 5");
    expect(formatShortDate(null)).toBe("—");
  });

  it("runtime-driven dates", () => {
    const rt = testRuntime();
    expect(formatLongDate(rt)).toBe("Monday, October 19, 2026");
    expect(todayIso(rt)).toBe("2026-10-19");
  });

  it("zone-less timestamps are shown as written; zoned ones in the runtime zone", () => {
    expect(formatClockTime("2026-10-19T19:11:44", testRuntime())).toBe("7:11:44 PM");
    expect(formatClockTime("2026-10-19T19:11:44Z", { ...testRuntime(), timeZone: "UTC" })).toBe("7:11:44 PM");
  });
});

describe("sort (TBL-021, TBL-022; AC-013)", () => {
  it("cycles none → asc → desc → none, and a new column restarts ascending", () => {
    let s: SortState | null = null;
    s = nextSort(s, "qty");
    expect(s).toEqual({ id: "qty", dir: 1 });
    s = nextSort(s, "qty");
    expect(s).toEqual({ id: "qty", dir: -1 });
    s = nextSort(s, "qty");
    expect(s).toBeNull();
    s = nextSort({ id: "qty", dir: -1 }, "val");
    expect(s).toEqual({ id: "val", dir: 1 });
  });

  const sorted = (id: SortState["id"], dir: 1 | -1) => ids(viewRows(nonGreen, {}, { id, dir }));

  it("QTY numerically, ties keep provider order", () => {
    expect(sorted("qty", 1)).toEqual(["101007", "101004", "101003", "101008", "101005", "101001", "101006"]);
    expect(sorted("qty", -1)).toEqual(["101006", "101001", "101005", "101008", "101003", "101007", "101004"]);
  });

  it("VALUE numerically (quantity × unit price)", () => {
    expect(sorted("val", -1)).toEqual(["101004", "101001", "101006", "101003", "101005", "101008", "101007"]);
  });

  it("CUSTOMER with localeCompare", () => {
    expect(sorted("cust", 1)).toEqual(["101006", "101003", "101007", "101005", "101001", "101008", "101004"]);
  });

  it("STATUS and DELIVERY sort on raw values", () => {
    expect(sorted("status", 1)).toEqual(ids(nonGreen)); // "red" < "yellow", stable
    expect(sorted("status", -1)).toEqual(["101008", "101003", "101001", "101006", "101005", "101007", "101004"]);
    expect(sorted("del", 1)).toEqual(["101001", "101006", "101008", "101005", "101007", "101003", "101004"]);
  });
});

describe("filter on displayed text (TBL-023, TBL-024; AC-014)", () => {
  const f = (filters: Filters) => ids(applyFilters(nonGreen, filters));

  it("customer, case-insensitive substring, trimmed", () => {
    expect(f({ cust: "mer" })).toEqual(["101005"]);
    expect(f({ cust: "MER" })).toEqual(["101005"]);
    expect(f({ cust: " mer " })).toEqual(["101005"]);
  });

  it("status uses the displayed label", () => {
    expect(f({ status: "watch" })).toEqual(["101008", "101003"]);
    expect(f({ status: "at risk" })).toEqual(["101001", "101006", "101005", "101007", "101004"]);
  });

  it("delivery uses the displayed 'Mon D' text", () => {
    expect(f({ del: "oct" })).toEqual(["101001", "101006", "101005", "101008"]);
    expect(f({ del: "nov" })).toEqual(["101007", "101004", "101003"]);
    expect(f({ del: "oct 2" })).toEqual(["101001", "101006", "101005", "101008"]);
  });

  it("value uses the displayed '$#,###' text", () => {
    expect(f({ val: "6,850" })).toEqual(["101001"]);
    expect(f({ val: "$6," })).toEqual(["101001", "101006", "101003"]);
  });

  it("columns combine with AND", () => {
    expect(f({ status: "at risk", series: "1000" })).toEqual(["101001", "101005"]);
    expect(f({ status: "at risk", series: "1000", cust: "north" })).toEqual(["101001"]);
  });

  it("blank filters impose no constraint", () => {
    expect(f({ cust: "   ", status: "" })).toEqual(ids(nonGreen));
  });

  it("INTENTIONAL DEVIATION: raw values from the original do not match", () => {
    expect(f({ status: "red" })).toEqual([]);
    expect(f({ del: "2026" })).toEqual([]);
    expect(f({ val: "6850" })).toEqual([]);
  });

  it("a missing customer is displayed as a dash and filtered by that text", () => {
    const withMissing: StatusRow[] = [{ ...nonGreen[0], customer_name: null }, nonGreen[1]];
    expect(applyFilters(withMissing, { cust: "—" })).toHaveLength(1);
  });

  it("filters first, then sorts", () => {
    expect(ids(viewRows(nonGreen, { status: "at risk" }, { id: "qty", dir: 1 }))).toEqual([
      "101007",
      "101004",
      "101005",
      "101001",
      "101006",
    ]);
  });
});
