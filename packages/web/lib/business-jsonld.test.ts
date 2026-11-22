import { describe, expect, test } from "vitest";
import { serializeJsonLd, type Business } from "@directory/core";
import { businessFacts, businessJsonLd } from "./business-jsonld";

/**
 * A characterisation test: it pins the LocalBusiness markup exactly as
 * /business/[slug] emitted it before the builder moved out of page.tsx.
 *
 * The expected strings were captured from the rendered pages of the three
 * listings below, not written by hand, so a pass means the move changed
 * nothing — key order included, since a reordered spread is a different byte
 * string. Fixtures are trimmed to the fields the builder reads, and are
 * business listings only (ADR 0002 covers why the full records never land here).
 */
function render(business: Business, areaName: string): string {
  return serializeJsonLd(
    businessJsonLd(business, businessFacts(business), {
      siteUrl: "https://directory.pooyagolchian.com",
      city: "Dubai",
      countryCode: "AE",
      areaName,
    }),
  );
}

describe("businessJsonLd", () => {
  test("a bilingual address, a tracked website and an l2-only type", () => {
    const business: Business = {
      placeId: "ChIJTT9PSxdDXz4RQbK51bL6bT8",
      slug: "aster-hospital-mankhool-6ispzx",
      title: "Aster Hospital - Mankhool",
      area: "bur-dubai",
      types: ["Hospital", "Health consultant"],
      address:
        "الرفاعة Kuwait Street ,Al Raffa - Kuwait St - near Sharaf DG - Mankhool - Dubai",
      lat: 25.2522975,
      lng: 55.2887036,
      phoneE164: "+97144400500",
      website:
        "https://www.asterhospitals.ae/locations/hospital-detail/aster-hospital-mankhool?utm_source=gmb&utm_medium=aster+hospital+-+mankhool",
      l2: "Hospitals",
      openHours: {
        friday: "Open 24 hours",
        saturday: "Open 24 hours",
        sunday: "Open 24 hours",
        monday: "Open 24 hours",
        tuesday: "Open 24 hours",
        wednesday: "Open 24 hours",
        thursday: "Open 24 hours",
      },
      accessibility: [
        "wheelchair-accessible-car-park",
        "wheelchair-accessible-entrance",
        "wheelchair-accessible-seating",
      ],
      payments: ["credit-cards", "debit-cards", "nfc-mobile-payments"],
      services: ["on-site-services"],
    };
    expect(render(business, "Bur Dubai")).toBe(
      '{"@context":"https://schema.org","@type":"Hospital","@id":"https://directory.pooyagolchian.com/business/aster-hospital-mankhool-6ispzx#business","mainEntityOfPage":"https://directory.pooyagolchian.com/business/aster-hospital-mankhool-6ispzx","name":"Aster Hospital - Mankhool","address":{"@type":"PostalAddress","streetAddress":"الرفاعة Kuwait Street ,Al Raffa - Kuwait St - near Sharaf DG - Mankhool - Dubai","addressLocality":"Dubai","addressCountry":"AE"},"containedInPlace":{"@type":"Place","name":"Bur Dubai"},"sameAs":["https://www.google.com/maps/place/?q=place_id:ChIJTT9PSxdDXz4RQbK51bL6bT8"],"telephone":"+97144400500","url":"https://www.asterhospitals.ae/locations/hospital-detail/aster-hospital-mankhool","geo":{"@type":"GeoCoordinates","latitude":25.2522975,"longitude":55.2887036},"amenityFeature":[{"@type":"LocationFeatureSpecification","name":"Wheelchair-accessible car park","value":true},{"@type":"LocationFeatureSpecification","name":"Wheelchair-accessible entrance","value":true},{"@type":"LocationFeatureSpecification","name":"Wheelchair-accessible seating","value":true}],"openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Monday","opens":"00:00","closes":"23:59"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Tuesday","opens":"00:00","closes":"23:59"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Wednesday","opens":"00:00","closes":"23:59"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Thursday","opens":"00:00","closes":"23:59"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Friday","opens":"00:00","closes":"23:59"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Saturday","opens":"00:00","closes":"23:59"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Sunday","opens":"00:00","closes":"23:59"}],"paymentAccepted":"Credit cards, Debit cards, Mobile payments","makesOffer":[{"@type":"Offer","itemOffered":{"@type":"Service","name":"On-site services"}}]}',
    );
  });

  test("every optional field, with an l3 that falls back to l2", () => {
    const business: Business = {
      placeId: "ChIJM8Dx5b9DXz4RK7vZ7UEKJbg",
      slug: "calicut-paragon-restaurant-llc-hi49up",
      title: "Calicut Paragon Restaurant LLC",
      area: "al-karama",
      types: ["Kerala restaurant", "Restaurant", "South Indian restaurant"],
      address: "Mattar al rayar building - Al Karama - Dubai",
      lat: 25.2433325,
      lng: 55.3061149,
      phoneE164: "+97143358700",
      website: "https://www.paragonrestaurant.net/",
      l2: "Restaurants",
      l3: "Indian",
      openHours: {
        friday: "7 AM–12:30 AM",
        saturday: "7 AM–12:30 AM",
        sunday: "7 AM–12:30 AM",
        monday: "7 AM–12:30 AM",
        tuesday: "7 AM–12:30 AM",
        wednesday: "7 AM–12:30 AM",
        thursday: "7 AM–12:30 AM",
      },
      accessibility: [
        "wheelchair-accessible-car-park",
        "wheelchair-accessible-entrance",
        "wheelchair-accessible-seating",
        "wheelchair-accessible-toilet",
        "assistive-hearing-loop",
      ],
      payments: ["credit-cards", "debit-cards", "nfc-mobile-payments"],
      services: [
        "no-contact-delivery",
        "delivery",
        "on-site-services",
        "takeaway",
        "dine-in",
      ],
    };
    expect(render(business, "Al Karama")).toBe(
      '{"@context":"https://schema.org","@type":"Restaurant","@id":"https://directory.pooyagolchian.com/business/calicut-paragon-restaurant-llc-hi49up#business","mainEntityOfPage":"https://directory.pooyagolchian.com/business/calicut-paragon-restaurant-llc-hi49up","name":"Calicut Paragon Restaurant LLC","address":{"@type":"PostalAddress","streetAddress":"Mattar al rayar building - Al Karama - Dubai","addressLocality":"Dubai","addressCountry":"AE"},"containedInPlace":{"@type":"Place","name":"Al Karama"},"sameAs":["https://www.google.com/maps/place/?q=place_id:ChIJM8Dx5b9DXz4RK7vZ7UEKJbg"],"telephone":"+97143358700","url":"https://www.paragonrestaurant.net/","geo":{"@type":"GeoCoordinates","latitude":25.2433325,"longitude":55.3061149},"amenityFeature":[{"@type":"LocationFeatureSpecification","name":"Wheelchair-accessible car park","value":true},{"@type":"LocationFeatureSpecification","name":"Wheelchair-accessible entrance","value":true},{"@type":"LocationFeatureSpecification","name":"Wheelchair-accessible seating","value":true},{"@type":"LocationFeatureSpecification","name":"Wheelchair-accessible toilet","value":true},{"@type":"LocationFeatureSpecification","name":"Assistive hearing loop","value":true}],"openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Monday","opens":"07:00","closes":"00:30"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Tuesday","opens":"07:00","closes":"00:30"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Wednesday","opens":"07:00","closes":"00:30"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Thursday","opens":"07:00","closes":"00:30"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Friday","opens":"07:00","closes":"00:30"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Saturday","opens":"07:00","closes":"00:30"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Sunday","opens":"07:00","closes":"00:30"}],"paymentAccepted":"Credit cards, Debit cards, Mobile payments","makesOffer":[{"@type":"Offer","itemOffered":{"@type":"Service","name":"On-site services"}},{"@type":"Offer","itemOffered":{"@type":"Service","name":"Delivery"}},{"@type":"Offer","itemOffered":{"@type":"Service","name":"No-contact delivery"}},{"@type":"Offer","itemOffered":{"@type":"Service","name":"Dine-in"}},{"@type":"Offer","itemOffered":{"@type":"Service","name":"Takeaway"}}]}',
    );
  });

  test("a sparse listing with no phone and no website", () => {
    const business: Business = {
      placeId: "ChIJoVhmFBZpXz4R3YN5lDhER8E",
      slug: "restaurant-5tofts",
      title: "Restaurant",
      area: "al-quoz",
      types: ["Restaurant"],
      address: "Al Qouz Third - Al Quoz - Dubai",
      lat: 25.1531753,
      lng: 55.2457004,
      l2: "Restaurants",
      openHours: {
        friday: "4 AM–12 PM",
        saturday: "4 AM–1 AM",
        sunday: "4 AM–12 AM",
        monday: "4 AM–12 AM",
        tuesday: "4 AM–12 AM",
        wednesday: "4 AM–12 AM",
        thursday: "4 AM–12 AM",
      },
      payments: ["credit-cards", "debit-cards", "nfc-mobile-payments"],
      services: [
        "outdoor-seating",
        "no-contact-delivery",
        "delivery",
        "takeaway",
        "dine-in",
      ],
    };
    expect(render(business, "Al Quoz")).toBe(
      '{"@context":"https://schema.org","@type":"Restaurant","@id":"https://directory.pooyagolchian.com/business/restaurant-5tofts#business","mainEntityOfPage":"https://directory.pooyagolchian.com/business/restaurant-5tofts","name":"Restaurant","address":{"@type":"PostalAddress","streetAddress":"Al Qouz Third - Al Quoz - Dubai","addressLocality":"Dubai","addressCountry":"AE"},"containedInPlace":{"@type":"Place","name":"Al Quoz"},"sameAs":["https://www.google.com/maps/place/?q=place_id:ChIJoVhmFBZpXz4R3YN5lDhER8E"],"geo":{"@type":"GeoCoordinates","latitude":25.1531753,"longitude":55.2457004},"openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Monday","opens":"04:00","closes":"00:00"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Tuesday","opens":"04:00","closes":"00:00"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Wednesday","opens":"04:00","closes":"00:00"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Thursday","opens":"04:00","closes":"00:00"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Friday","opens":"04:00","closes":"12:00"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Saturday","opens":"04:00","closes":"01:00"},{"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Sunday","opens":"04:00","closes":"00:00"}],"paymentAccepted":"Credit cards, Debit cards, Mobile payments","makesOffer":[{"@type":"Offer","itemOffered":{"@type":"Service","name":"Delivery"}},{"@type":"Offer","itemOffered":{"@type":"Service","name":"No-contact delivery"}},{"@type":"Offer","itemOffered":{"@type":"Service","name":"Dine-in"}},{"@type":"Offer","itemOffered":{"@type":"Service","name":"Takeaway"}},{"@type":"Offer","itemOffered":{"@type":"Service","name":"Outdoor seating"}}]}',
    );
  });
});
