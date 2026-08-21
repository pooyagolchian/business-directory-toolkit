import { describe, expect, test } from "vitest";
import { normalizePhone } from "./phone.js";

// Every raw value below was returned by the live SearchApi Google Maps engine
// for Dubai businesses on 2026-08-20. Google returns local format, never E.164.

describe("normalizePhone", () => {
  test("converts a Dubai landline to E.164", () => {
    expect(normalizePhone("04 577 6680", "AE")?.e164).toBe("+97145776680");
  });

  test("converts an Etisalat mobile to E.164", () => {
    expect(normalizePhone("052 253 3290", "AE")?.e164).toBe("+971522533290");
  });

  test("converts a du mobile to E.164", () => {
    expect(normalizePhone("050 786 8343", "AE")?.e164).toBe("+971507868343");
  });

  test("tags a 04 number as a landline", () => {
    expect(normalizePhone("04 577 6680", "AE")?.type).toBe("landline");
  });

  test("tags a 05x number as a mobile", () => {
    expect(normalizePhone("052 253 3290", "AE")?.type).toBe("mobile");
  });

  test("accepts a number that is already in international format", () => {
    expect(normalizePhone("+971 4 577 6680", "AE")?.e164).toBe("+97145776680");
  });

  test("preserves the original string so the source stays auditable", () => {
    expect(normalizePhone("04 577 6680", "AE")?.raw).toBe("04 577 6680");
  });

  test("returns null for a number that is too short to be real", () => {
    expect(normalizePhone("1234", "AE")).toBeNull();
  });

  test("returns null for an empty string", () => {
    expect(normalizePhone("", "AE")).toBeNull();
  });

  test("returns null for undefined, since the API omits phone on some listings", () => {
    expect(normalizePhone(undefined, "AE")).toBeNull();
  });

  test("returns null for a non-UAE number rather than guessing a country", () => {
    // A UK mobile. Without a region hint this must not be coerced to +971.
    expect(normalizePhone("+44 7911 123456", "AE")).toBeNull();
  });
});
