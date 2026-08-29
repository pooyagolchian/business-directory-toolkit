import { describe, expect, test } from "vitest";
import { SCHEMA_TYPE_BY_LABEL, schemaTypeFor } from "./schema-type";

/**
 * The parent table is declared HERE, not imported, and that is the point of it.
 *
 * A table the module under test supplies would only prove the map agrees with
 * itself. This one is a second, independent transcription of the schema.org
 * vocabulary, so a type that exists in neither — `BarberShop`, `Supermarket`,
 * `DrivingSchool` — has to be invented twice, in two files, before a test goes
 * green.
 *
 * It records a PARENT rather than mere membership because this module has two
 * failure modes, and a flat list only catches one:
 *
 *   1. A word schema.org has never defined. A flat list catches that.
 *   2. A word schema.org HAS defined, off the LocalBusiness branch or not a
 *      class at all. A flat list waves that straight through — which is not
 *      hypothetical: `Physiotherapy` shipped here for exactly that reason,
 *      passing a green allow-list, because schema.org/Physiotherapy is a real
 *      page. Its title reads "Schema.org Enumeration Member", not
 *      "Schema.org Type", and only someone transcribing its position in the
 *      hierarchy would notice.
 *
 * So every entry below was read off a page whose title says **Schema.org
 * Type**, and the parent is the one written in that page's own breadcrumb.
 * Walking the chain has to reach LocalBusiness, because this type lands on a
 * node that also carries `geo`, `openingHoursSpecification` and
 * `amenityFeature` — all Place properties. Verified against schema.org on
 * 2026-08-29.
 */
const SCHEMA_ORG_PARENT: Readonly<Record<string, string>> = {
  // FoodEstablishment
  Bakery: "FoodEstablishment",
  BarOrPub: "FoodEstablishment",
  CafeOrCoffeeShop: "FoodEstablishment",
  Restaurant: "FoodEstablishment",
  FoodEstablishment: "LocalBusiness",
  // Store
  AutoPartsStore: "Store",
  ClothingStore: "Store",
  ElectronicsStore: "Store",
  Florist: "Store",
  FurnitureStore: "Store",
  GroceryStore: "Store",
  HardwareStore: "Store",
  JewelryStore: "Store",
  MobilePhoneStore: "Store",
  MusicStore: "Store",
  PetStore: "Store",
  ShoeStore: "Store",
  SportingGoodsStore: "Store",
  ToyStore: "Store",
  Store: "LocalBusiness",
  // AutomotiveBusiness
  AutoDealer: "AutomotiveBusiness",
  AutoRental: "AutomotiveBusiness",
  AutoRepair: "AutomotiveBusiness",
  AutoWash: "AutomotiveBusiness",
  GasStation: "AutomotiveBusiness",
  AutomotiveBusiness: "LocalBusiness",
  // HealthAndBeautyBusiness
  BeautySalon: "HealthAndBeautyBusiness",
  DaySpa: "HealthAndBeautyBusiness",
  HairSalon: "HealthAndBeautyBusiness",
  NailSalon: "HealthAndBeautyBusiness",
  TattooParlor: "HealthAndBeautyBusiness",
  HealthAndBeautyBusiness: "LocalBusiness",
  // MedicalBusiness. Dentist and Pharmacy list MedicalOrganization as a second
  // parent; the branch recorded here is the one that keeps the node a Place.
  Dentist: "MedicalBusiness",
  MedicalClinic: "MedicalBusiness",
  Optician: "MedicalBusiness",
  Pharmacy: "MedicalBusiness",
  MedicalBusiness: "LocalBusiness",
  // FinancialService
  AccountingService: "FinancialService",
  InsuranceAgency: "FinancialService",
  FinancialService: "LocalBusiness",
  // SportsActivityLocation
  ExerciseGym: "SportsActivityLocation",
  SportsClub: "SportsActivityLocation",
  SportsActivityLocation: "LocalBusiness",
  // HomeAndConstructionBusiness
  GeneralContractor: "HomeAndConstructionBusiness",
  HomeAndConstructionBusiness: "LocalBusiness",
  // LodgingBusiness
  Hotel: "LodgingBusiness",
  LodgingBusiness: "LocalBusiness",
  // Hospital has three superclasses — CivicStructure, EmergencyService and
  // MedicalOrganization — which is why its page shows four inheritance paths.
  // EmergencyService is the one that makes it a LocalBusiness.
  Hospital: "EmergencyService",
  EmergencyService: "LocalBusiness",
  // Direct subtypes of LocalBusiness
  DryCleaningOrLaundry: "LocalBusiness",
  EmploymentAgency: "LocalBusiness",
  GovernmentOffice: "LocalBusiness",
  LegalService: "LocalBusiness",
  Library: "LocalBusiness",
  RealEstateAgent: "LocalBusiness",
  ShoppingCenter: "LocalBusiness",
  TravelAgency: "LocalBusiness",
};

/**
 * The trap that a flat allow-list cannot see.
 *
 * schema.org lists all of these UNDER MedicalBusiness, so each one reads as a
 * medical subtype in the hierarchy and each one has a live page. None is a
 * class: they are members of the MedicalSpecialty enumeration, and schema.org
 * marks the difference with `::` rather than `>` in the breadcrumb. Emitting
 * one as `@type` declares the business to be an enumeration value.
 *
 * Transcribed from the MedicalBusiness subtree on 2026-08-29. `Physiotherapy`
 * is on this list because it was on the map first.
 */
const MEDICAL_SPECIALTY_ENUMERATION_MEMBERS: readonly string[] = [
  "CommunityHealth",
  "Dermatology",
  "DietNutrition",
  "Emergency",
  "Geriatric",
  "Gynecologic",
  "Midwifery",
  "Nursing",
  "Obstetric",
  "Oncologic",
  "Optometric",
  "Otolaryngologic",
  "Pediatric",
  "Physiotherapy",
  "PlasticSurgery",
  "Podiatric",
  "PrimaryCare",
  "Psychiatric",
  "PublicHealth",
];

/** Walk the transcribed hierarchy from a type to its roots. */
function ancestorsOf(type: string): string[] {
  const chain: string[] = [];
  let current = SCHEMA_ORG_PARENT[type];
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = SCHEMA_ORG_PARENT[current];
  }
  return chain;
}

describe("schemaTypeFor", () => {
  /**
   * The eight labels below are the head of the corpus — 5,523 of 14,981 listing
   * pages between them. If the map is worth having at all, it is because of
   * these rows; the tail is a bonus.
   */
  test.each([
    ["Restaurants", "Restaurant"],
    ["Salons", "BeautySalon"],
    ["Cafes", "CafeOrCoffeeShop"],
    ["Pharmacies", "Pharmacy"],
    ["Clinics", "MedicalClinic"],
    ["Laundry", "DryCleaningOrLaundry"],
    ["Hotels", "Hotel"],
    ["Car Rental", "AutoRental"],
  ])("maps the head-of-corpus label %s to %s", (label, expected) => {
    expect(schemaTypeFor(label)).toBe(expected);
  });

  /**
   * A spread through the rest of the map, chosen for the cases where the
   * taxonomy's word and schema.org's word are not the same word: British
   * spelling (Jewellery/JewelryStore), British usage (Petrol Stations/
   * GasStation), and a shop type schema.org names after its trade rather than
   * its shopfront (Barbers/HairSalon).
   */
  test.each([
    ["Dentists", "Dentist"],
    ["Supermarkets", "GroceryStore"],
    ["Grocery Stores", "GroceryStore"],
    ["Banking & Exchange", "FinancialService"],
    ["Jewellery", "JewelryStore"],
    ["Petrol Stations", "GasStation"],
    ["Barbers", "HairSalon"],
    ["Mobile Phone Shops", "MobilePhoneStore"],
    ["Malls", "ShoppingCenter"],
    ["Recruitment", "EmploymentAgency"],
    ["Hospitals", "Hospital"],
    ["Contractors", "GeneralContractor"],
  ])("maps %s to %s", (label, expected) => {
    expect(schemaTypeFor(label)).toBe(expected);
  });

  /**
   * Physiotherapy is the regression this file was rewritten around, so it gets
   * a case of its own rather than a row in a table. The label must NOT answer
   * with its own name: `Physiotherapy` is an enumeration member. MedicalBusiness
   * is the nearest real type, true of a clinic and of a sole practitioner alike.
   */
  test("answers a specialty label with a real type, not the specialty", () => {
    expect(schemaTypeFor("Physiotherapy")).toBe("MedicalBusiness");
  });

  /**
   * Three labels the reference city has zero rows for, which is precisely why
   * they were missed. A directory is a toolkit here (ADR 0005) — a library is
   * an ordinary high-street business in most cities, and each of these has an
   * exact, LocalBusiness-descended type sitting unused.
   */
  test.each([
    ["Libraries", "Library"],
    ["Shoes", "ShoeStore"],
    ["Government", "GovernmentOffice"],
  ])("maps %s to %s for cities the reference crawl has none of", (l, t) => {
    expect(schemaTypeFor(l)).toBe(t);
  });

  test("falls back to LocalBusiness for a label it does not know", () => {
    expect(schemaTypeFor("Tailors")).toBe("LocalBusiness");
    expect(schemaTypeFor("Marketing & Tech")).toBe("LocalBusiness");
    expect(schemaTypeFor("Documents & Visas")).toBe("LocalBusiness");
  });

  /**
   * The four ways a label earns its way OFF the map, one example each. These
   * are regression tests against a future contributor's good intentions, so the
   * reason is spelled out beside every case.
   */
  test("declines the labels that look mappable but are not", () => {
    // schema.org has no DrivingSchool — /DrivingSchool is a 404. The term comes
    // from the external auto.schema.org extension, which Google does not read.
    expect(schemaTypeFor("Driving Schools")).toBe("LocalBusiness");

    // School and CollegeOrUniversity exist, but under EducationalOrganization,
    // which descends from Organization and never from Place. The node this type
    // goes into also carries geo and openingHoursSpecification.
    expect(schemaTypeFor("Schools")).toBe("LocalBusiness");
    expect(schemaTypeFor("Universities")).toBe("LocalBusiness");

    // VeterinaryCare exists, and is Organization > MedicalOrganization only —
    // same problem as School, and it is easy to miss because the name sounds
    // like a high-street business.
    expect(schemaTypeFor("Veterinary")).toBe("LocalBusiness");

    // data/taxonomy-map.json sends both "Nursery school" and "Plant nursery"
    // to this one label. ChildCare would be right for most of the 212 and
    // flatly wrong for the rest, and nothing downstream can tell them apart.
    expect(schemaTypeFor("Nurseries")).toBe("LocalBusiness");

    // MusicVenue is a CivicStructure, not a LocalBusiness — same failure as
    // School. These three labels have no other candidate.
    expect(schemaTypeFor("Live Music")).toBe("LocalBusiness");
    expect(schemaTypeFor("Live Music Venues")).toBe("LocalBusiness");
    expect(schemaTypeFor("Outdoor Venues")).toBe("LocalBusiness");

    // No type for either trade, and none for the pair.
    expect(schemaTypeFor("Butchers & Fishmongers")).toBe("LocalBusiness");

    // ProfessionalService exists and is a LocalBusiness, but schema.org's page
    // says it "was deprecated due to confusion with Service".
    expect(schemaTypeFor("Architecture & Engineering")).toBe("LocalBusiness");

    // A courier is not a place a visitor goes, and schema.org has no type for
    // one on this branch.
    expect(schemaTypeFor("Delivery")).toBe("LocalBusiness");
  });

  test("falls back to LocalBusiness when there is no label at all", () => {
    expect(schemaTypeFor(undefined)).toBe("LocalBusiness");
    expect(schemaTypeFor("")).toBe("LocalBusiness");
    expect(schemaTypeFor("   ")).toBe("LocalBusiness");
  });

  test("matches a label whatever its case", () => {
    expect(schemaTypeFor("restaurants")).toBe("Restaurant");
    expect(schemaTypeFor("RESTAURANTS")).toBe("Restaurant");
    expect(schemaTypeFor("ReStAuRaNtS")).toBe("Restaurant");
    expect(schemaTypeFor("mobile phone shops")).toBe("MobilePhoneStore");
  });

  /**
   * The taxonomy pluralises its labels and schema.org does not, which is the
   * single most likely reason a correct call site would silently miss. It has
   * to work in both directions: the map's plural key answers a singular query,
   * and the map's singular key answers a plural one.
   */
  test("matches a label whatever its number", () => {
    expect(schemaTypeFor("Restaurant")).toBe("Restaurant");
    expect(schemaTypeFor("Pharmacy")).toBe("Pharmacy");
    expect(schemaTypeFor("Bakery")).toBe("Bakery");
    expect(schemaTypeFor("Travel Agency")).toBe("TravelAgency");
    expect(schemaTypeFor("Pet Shop")).toBe("PetStore");
    // …and the other way, against keys the taxonomy happens to store singular.
    expect(schemaTypeFor("Laundries")).toBe("DryCleaningOrLaundry");
    expect(schemaTypeFor("Hospital")).toBe("Hospital");
  });

  test("tolerates the whitespace a template interpolation leaves behind", () => {
    expect(schemaTypeFor("  Restaurants  ")).toBe("Restaurant");
    expect(schemaTypeFor("Mobile  Phone   Shops")).toBe("MobilePhoneStore");
    expect(schemaTypeFor("\nCafes\t")).toBe("CafeOrCoffeeShop");
  });

  /**
   * The test this module exists for. Every value must be a real schema.org
   * type, and the parent table at the top of this file is the second opinion.
   */
  test("emits no type this repo invented", () => {
    for (const [label, type] of Object.entries(SCHEMA_TYPE_BY_LABEL)) {
      expect(
        Object.keys(SCHEMA_ORG_PARENT),
        `${label} maps to ${type}, which is not on the verified table`,
      ).toContain(type);
    }
  });

  /**
   * The second binding condition, and the one that had no test while the first
   * one had several. A type can be perfectly real and still wreck the node it
   * lands on: `School`, `VeterinaryCare`, `NGO` and `MusicVenue` are all types,
   * and all four would put geo and openingHoursSpecification on something that
   * is not a Place.
   */
  test("emits only types that descend from LocalBusiness", () => {
    for (const [label, type] of Object.entries(SCHEMA_TYPE_BY_LABEL)) {
      expect(
        ancestorsOf(type),
        `${label} maps to ${type}, which does not reach LocalBusiness`,
      ).toContain("LocalBusiness");
    }
  });

  /**
   * The third condition, learned the hard way. Being real and being on the
   * right branch is still not enough — the word also has to be a class.
   */
  test("emits no schema.org enumeration member", () => {
    for (const [label, type] of Object.entries(SCHEMA_TYPE_BY_LABEL)) {
      expect(
        MEDICAL_SPECIALTY_ENUMERATION_MEMBERS,
        `${label} maps to ${type}, which is an enumeration member, not a type`,
      ).not.toContain(type);
    }
  });

  /**
   * The table has to shrink when the map does, or it rots into a list of types
   * somebody once considered — exactly the state in which a wrong entry
   * survives review. Parents earn their place by being on some mapped type's
   * chain; nothing else may sit here.
   */
  test("keeps the table free of types the map neither uses nor inherits", () => {
    const used = new Set(Object.values(SCHEMA_TYPE_BY_LABEL));
    const inherited = new Set([...used].flatMap(ancestorsOf));
    expect(
      Object.keys(SCHEMA_ORG_PARENT).filter(
        (type) => !used.has(type) && !inherited.has(type),
      ),
    ).toEqual([]);
  });

  /**
   * Also the collision guard, which is why it sweeps the whole map rather than
   * sampling it. Matching case- and number-insensitively means two distinct
   * labels can normalise onto one key and silently overwrite each other —
   * "Sports Shops" and "Sport Shop" would. That failure is not a lookup miss
   * you would notice; it is one category quietly answering with another
   * category's type, and the loser of the collision is the only place it shows.
   */
  test("returns its own mapped type for every label in the map", () => {
    for (const [label, type] of Object.entries(SCHEMA_TYPE_BY_LABEL)) {
      expect(
        schemaTypeFor(label),
        `${label} answered with another key's type`,
      ).toBe(type);
    }
  });

  /**
   * The result is interpolated into a `<script type="application/ld+json">`
   * block, so the one thing this function must never do is hand a caller's
   * string back. It cannot: every answer comes from the map or the fallback.
   * This pins that closure, because the cheapest "improvement" anyone could
   * make here — echoing an unknown label as its own type — would turn a
   * business name into markup.
   */
  test("never answers with anything but a verified type or the fallback", () => {
    const permitted = new Set([
      ...Object.values(SCHEMA_TYPE_BY_LABEL),
      "LocalBusiness",
    ]);
    for (const hostile of [
      "Restaurants</script><script>alert(1)</script>",
      "__proto__",
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "مطاعم",
      "Cafe' OR 1=1 --",
      " ",
      "s",
      "ss",
      "ies",
      "a".repeat(5_000),
    ]) {
      const answer = schemaTypeFor(hostile);
      expect(permitted, `${JSON.stringify(hostile)} escaped the map`).toContain(
        answer,
      );
    }
  });
});
