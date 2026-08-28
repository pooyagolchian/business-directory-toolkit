import { describe, expect, test } from "vitest";
import {
  PAYMENT_LABELS,
  SERVICE_LABELS,
  paymentLabels,
  serviceLabels,
} from "./amenity-display";

/**
 * Display labels for the payment and service attributes Google returns.
 *
 * These sit beside ACCESSIBILITY_LABELS in facets.ts rather than inside it
 * because that map is gated by an allow-list used for FILTERING, and these two
 * groups are only ever DISPLAYED. Same shape, different job.
 *
 * The duplicate-spelling problem is the reason this is code and not a lookup at
 * the call site. Google returns the same physical fact under two spellings,
 * because the strings come from different surfaces rather than one normalised
 * field — measured in the Dubai corpus: on-site-services 5,416 vs
 * onsite-services 1,181; takeaway 1,558 vs takeout 266; cheques 380 vs
 * checks 89. Rendering both would show a reader the same capability twice.
 */
describe("paymentLabels", () => {
  test("resolves the head of the corpus to human labels", () => {
    expect(paymentLabels(["credit-cards", "debit-cards"])).toEqual([
      "Credit cards",
      "Debit cards",
    ]);
  });

  test("folds the American spelling of cheques into the British one", () => {
    // British English throughout the repo, and it is also the larger set here.
    expect(paymentLabels(["checks"])).toEqual(["Cheques"]);
  });

  test("collapses both spellings to a single chip rather than showing it twice", () => {
    expect(paymentLabels(["cheques", "checks"])).toEqual(["Cheques"]);
  });

  test("drops a value it has no label for rather than showing a raw slug", () => {
    // Payments and services are shown as plain chips with no context, so an
    // unlabelled slug reads as a rendering bug. Accessibility takes the
    // opposite decision deliberately — see the note there.
    expect(paymentLabels(["some-new-thing-google-invented"])).toEqual([]);
  });

  test("returns an empty array for undefined, not a crash", () => {
    expect(paymentLabels(undefined)).toEqual([]);
    expect(paymentLabels([])).toEqual([]);
  });

  test("preserves the order the labels were declared in, not the input order", () => {
    // Otherwise two businesses with the same capabilities render different
    // chip orders purely from crawl ordering, which reads as noise.
    const a = paymentLabels(["debit-cards", "credit-cards"]);
    const b = paymentLabels(["credit-cards", "debit-cards"]);
    expect(a).toEqual(b);
  });
});

describe("serviceLabels", () => {
  test("resolves the head of the corpus", () => {
    expect(serviceLabels(["delivery", "dine-in"])).toEqual([
      "Delivery",
      "Dine-in",
    ]);
  });

  test("folds onsite-services into on-site-services", () => {
    expect(serviceLabels(["onsite-services"])).toEqual(["On-site services"]);
    expect(serviceLabels(["on-site-services", "onsite-services"])).toEqual([
      "On-site services",
    ]);
  });

  test("folds takeout into takeaway", () => {
    expect(serviceLabels(["takeout"])).toEqual(["Takeaway"]);
    expect(serviceLabels(["takeaway", "takeout"])).toEqual(["Takeaway"]);
  });

  test("drops an unknown value", () => {
    expect(serviceLabels(["teleportation"])).toEqual([]);
  });

  test("returns an empty array for undefined", () => {
    expect(serviceLabels(undefined)).toEqual([]);
  });
});

describe("the label maps themselves", () => {
  test("carry no city- or project-specific strings", () => {
    // ADR 0005: a city is data. A fork crawling Lisbon uses these unchanged.
    const all = [
      ...Object.values(PAYMENT_LABELS),
      ...Object.values(SERVICE_LABELS),
    ].join(" ");
    expect(all).not.toMatch(/dubai|emirat|uae|\bAED\b/i);
  });

  test("declare a label for every value measured in a real crawl", () => {
    // The seven payment and eighteen service slugs observed in the Dubai v0.1
    // crawl. A value missing here is silently dropped from the page, so this
    // test is the thing that notices.
    for (const slug of [
      "nfc-mobile-payments",
      "debit-cards",
      "credit-cards",
      "cheques",
      "checks",
      "payment-plans",
      "cash-only",
    ]) {
      expect(paymentLabels([slug]), `payment: ${slug}`).toHaveLength(1);
    }
    for (const slug of [
      "on-site-services",
      "onsite-services",
      "delivery",
      "dine-in",
      "takeaway",
      "takeout",
      "in-store-shopping",
      "no-contact-delivery",
      "in-store-pick-up",
      "outdoor-seating",
      "online-appointments",
      "same-day-delivery",
    ]) {
      expect(serviceLabels([slug]), `service: ${slug}`).toHaveLength(1);
    }
  });
});
