import { describe, expect, it } from "vitest";
import { fmtDateTime, fmtPrice, fmtNumber } from "./format";

describe("fmtDateTime", () => {
  it("swaps the T separator for a space and truncates to seconds", () => {
    expect(fmtDateTime("2026-01-01T12:34:56.789Z")).toBe("2026-01-01 12:34:56");
  });

  it("returns an em dash for null, undefined, or empty string", () => {
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtDateTime(undefined)).toBe("—");
    expect(fmtDateTime("")).toBe("—");
  });
});

describe("fmtPrice", () => {
  it("formats a number as a whole-dollar price", () => {
    expect(fmtPrice(85)).toBe("$85");
    expect(fmtPrice(85.6)).toBe("$86");
    expect(fmtPrice(0)).toBe("$0");
  });

  it("returns an em dash for null or undefined", () => {
    expect(fmtPrice(null)).toBe("—");
    expect(fmtPrice(undefined)).toBe("—");
  });
});

describe("fmtNumber", () => {
  it("formats a number with locale thousands separators", () => {
    expect(fmtNumber(1234567)).toBe(new Intl.NumberFormat().format(1234567));
    expect(fmtNumber(0)).toBe("0");
  });

  it("returns an em dash for null or undefined", () => {
    expect(fmtNumber(null)).toBe("—");
    expect(fmtNumber(undefined)).toBe("—");
  });
});
