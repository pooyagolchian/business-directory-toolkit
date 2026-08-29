/**
 * Choose the schema.org type for a business from its category label.
 *
 * `/business/<slug>` already emits valid markup: it declares `LocalBusiness` on
 * all 14,981 pages, and generic LocalBusiness forfeits no rich-result
 * eligibility whatsoever. So this is not a fix. It is a precision gain, and a
 * modest one — the page's visible subtitle already says "Restaurants" beside
 * markup that says only "a local business", and an answer engine reading the
 * markup rather than the prose deserves the same sentence the visitor gets.
 *
 * The rule the map obeys is INVENT NOTHING, and it takes three conditions to
 * satisfy, each of which has caught a different mistake.
 *
 * **The word must exist.** `BarberShop`, `Supermarket` and `DrivingSchool` all
 * sound like types. None of them are. Emitting one would be a claim about what
 * a business IS, asserted in a vocabulary that has no such word; emitting
 * LocalBusiness instead is merely less specific, and less specific is
 * recoverable.
 *
 * **The word must descend from LocalBusiness.** This replaces `@type` on a node
 * that also carries `geo`, `openingHoursSpecification` and `amenityFeature` —
 * all Place properties. `School` and `VeterinaryCare` are real schema.org types
 * that would each make that node incoherent, because both sit on the
 * Organization branch and never touch Place. So they are absent, and 320 pages
 * across Schools, Universities and Veterinary keep the generic type rather than
 * trade a valid document for a more specific word.
 *
 * **The word must be a class.** This one is the reason the other two are not
 * enough, and it is invisible to anyone checking that a page exists.
 * schema.org/Physiotherapy is a live page, listed under MedicalBusiness, and it
 * is not a type — its title says "Schema.org Enumeration Member" and its
 * breadcrumb reads `MedicalBusiness :: Physiotherapy`, where every real subtype
 * gets a `>`. Nineteen words under MedicalBusiness are like this. `Physiotherapy`
 * shipped here as its own type before anyone read the `::`.
 *
 * See schema-type.test.ts, which pins all three conditions per case.
 */

/**
 * Taxonomy label → schema.org type, keyed by the label exactly as
 * `data/taxonomy-map.json` writes it so the two can be grepped against each
 * other. Lookup is case- and number-insensitive; see `normalise`.
 *
 * Order follows corpus frequency, which is also roughly the order in which a
 * mistake would matter. Labels that are deliberately NOT here are listed under
 * DELIBERATELY UNMAPPED below — an absent label is a decision, not an oversight,
 * and the ones that look mappable have tests holding them out.
 */
export const SCHEMA_TYPE_BY_LABEL: Readonly<Record<string, string>> = {
  Restaurants: "Restaurant",
  // The taxonomy splits Barbers, Nail Salons and Spas into their own labels, so
  // what is left under "Salons" is the beauty salon proper — which is what makes
  // BeautySalon a reading of the label rather than a guess about its contents.
  Salons: "BeautySalon",
  Cafes: "CafeOrCoffeeShop",
  Pharmacies: "Pharmacy",
  Clinics: "MedicalClinic",
  Laundry: "DryCleaningOrLaundry",
  Hotels: "Hotel",
  "Car Rental": "AutoRental",
  Clothing: "ClothingStore",
  "Auto Repair": "AutoRepair",
  Dentists: "Dentist",
  // schema.org has no Supermarket. GroceryStore is the type it defines for the
  // trade, and a supermarket is a grocery store — a coarser truth, not a false
  // one, which is the line this whole file is drawn along.
  Supermarkets: "GroceryStore",
  Spas: "DaySpa",
  // Banks and exchange houses share one label, and BankOrCreditUnion is untrue
  // of an exchange house. FinancialService is their common parent and covers
  // both without asserting either.
  "Banking & Exchange": "FinancialService",
  "Real Estate": "RealEstateAgent",
  "Travel Agencies": "TravelAgency",
  Gyms: "ExerciseGym",
  "Mobile Phone Shops": "MobilePhoneStore",
  Furniture: "FurnitureStore",
  "Grocery Stores": "GroceryStore",
  Bakeries: "Bakery",
  Electronics: "ElectronicsStore",
  // schema.org names its beauty types after the trade, not the shopfront, and
  // hair is the trade: 273 of the 325 titles under this label say barber, gents
  // or men's, and most of the remainder are grooming rooms that say neither.
  // HealthAndBeautyBusiness would also be true and would say less.
  Barbers: "HairSalon",
  Opticians: "Optician",
  Hardware: "HardwareStore",
  // British label, American vocabulary. The taxonomy is written in the repo's
  // English and schema.org is not, so the spelling has to be bridged here.
  Jewellery: "JewelryStore",
  Florists: "Florist",
  // LegalService, not Attorney. The label covers law firms, legal consultancies
  // and typing centres alike, and Attorney is a claim about an individual.
  Legal: "LegalService",
  Accounting: "AccountingService",
  "Pet Shops": "PetStore",
  "Auto Parts": "AutoPartsStore",
  Insurance: "InsuranceAgency",
  // Hospital has three superclasses — CivicStructure, EmergencyService and
  // MedicalOrganization — which is why its page draws four inheritance paths.
  // EmergencyService is a LocalBusiness, so the Place properties stay valid.
  Hospitals: "Hospital",
  Bars: "BarOrPub",
  // The one label whose meaning is "a shop, unspecified" — which is exactly
  // what schema.org's bare Store means.
  "General Retail": "Store",
  "Nail Salons": "NailSalon",
  "Sports Clubs": "SportsClub",
  Malls: "ShoppingCenter",
  "Sports Shops": "SportingGoodsStore",
  "Car Wash": "AutoWash",
  Recruitment: "EmploymentAgency",
  // NOT "Physiotherapy". That word is a MedicalSpecialty enumeration member, so
  // `"@type": "Physiotherapy"` says the business is a value in a list rather
  // than a kind of thing. MedicalBusiness is the nearest class, and unlike
  // MedicalClinic it stays true when the label covers a sole practitioner
  // rather than a practice — which it does in most cities.
  Physiotherapy: "MedicalBusiness",
  "Musical Instruments": "MusicStore",
  // Again British against American: schema.org calls a petrol station a
  // GasStation.
  "Petrol Stations": "GasStation",
  "Toys & Games": "ToyStore",
  "Car Dealers": "AutoDealer",
  "Tattoo & Piercing": "TattooParlor",
  Contractors: "GeneralContractor",
  // The tail below is outside the frequency order because the reference crawl
  // returned nothing for it — which is exactly why all three were missed on the
  // first pass. A city is data, not code (ADR 0005): a library is an ordinary
  // high-street business almost everywhere, and each of these has an exact type
  // that was sitting unused because Dubai happened to have no rows.
  Libraries: "Library",
  Shoes: "ShoeStore",
  Government: "GovernmentOffice",
};

/*
 * DELIBERATELY UNMAPPED — the four reasons, so nobody has to re-derive them.
 *
 * 1. schema.org has no such type, however obvious the word feels.
 *    Tailors, Printing, Consulting, Cleaning, Catering, Photography, Security,
 *    Events, Landscaping, Interior Design, Maintenance, Trades, Gifts,
 *    Marketing & Tech, Documents & Visas, Training. And Driving Schools (121
 *    pages): `DrivingSchool` belongs to the external auto.schema.org extension
 *    and 404s on schema.org itself.
 *
 * 2. The type exists but is not a LocalBusiness, so it would break the node it
 *    is dropped into. Schools and Universities (School, CollegeOrUniversity —
 *    EducationalOrganization descends from Organization, never from Place),
 *    Veterinary (VeterinaryCare — MedicalOrganization, same problem),
 *    Charities (NGO), Attractions and Parks & Beaches (TouristAttraction, Park
 *    — Place but not a business), Labs & Diagnostics (DiagnosticLab).
 *
 * 3. The label bundles two trades and no single type is true of both.
 *    Wholesale & Manufacturing, Movers & Storage, Books & Stationery,
 *    Clubs & Lounges, Cinemas & Venues, Delivery & Logistics, Tours & Charters,
 *    Perfume & Cosmetics, Butchers & Fishmongers, Architecture & Engineering.
 *    (ProfessionalService would take the last of those and is a LocalBusiness,
 *    but schema.org's own page says the type "was deprecated due to confusion
 *    with Service". A deprecated type is a worse answer than a general one.)
 *
 * 4. The word itself is ambiguous in the source data. Nurseries, 212 pages:
 *    data/taxonomy-map.json routes both "Nursery school" and "Plant nursery"
 *    to this one label. ChildCare would be right for most of them and flatly
 *    wrong for the rest, and nothing downstream can tell which is which.
 *
 * Three more labels the taxonomy defines and this list owes an answer for, all
 * of them venues: Live Music, Live Music Venues and Outdoor Venues. MusicVenue
 * is the obvious type and is a CivicStructure — reason 2 again. Delivery is
 * reason 1: a courier is not a place a visitor goes, and schema.org has no type
 * for one on this branch.
 *
 * That is every l2 label in data/taxonomy-map.json accounted for: 51 mapped
 * above, the rest named here. A label in neither list is a bug in this comment,
 * not a silent decision.
 */

/** What a page gets when the label is missing, unknown, or deliberately unmapped. */
const FALLBACK = "LocalBusiness";

/**
 * Reduce one word to a form that is the same whether the caller wrote it
 * singular or plural. The taxonomy pluralises ("Restaurants") and schema.org
 * does not ("Restaurant"), so a call site holding either spelling has to land
 * on the same key — and both the map's keys and the caller's label go through
 * this, which is what makes the match work in both directions.
 *
 * It is a fold, not a linguistic singulariser: "Electronics" folds to
 * "electronic", which is not a word anyone means, and that is fine because the
 * key folds to it too. The only real risk is two labels folding together, and
 * schema-type.test.ts sweeps the whole map for that.
 */
function fold(word: string): string {
  if (word.endsWith("ies") && word.length > 3) return `${word.slice(0, -3)}y`;
  // "ss" is never a plural marker — without this guard "Wellness" becomes
  // "wellnes", which is harmless today and a collision waiting for the label
  // that ends in a bare "s".
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s") && word.length > 1) return word.slice(0, -1);
  return word;
}

function normalise(label: string): string {
  return label.toLowerCase().split(/\s+/).filter(Boolean).map(fold).join(" ");
}

/**
 * Built once at module load. The literal above stays readable and greppable
 * against the taxonomy; the lookup key is derived, so nobody has to remember to
 * write labels in a normalised form.
 */
const BY_NORMALISED_LABEL = new Map(
  Object.entries(SCHEMA_TYPE_BY_LABEL).map(([label, type]) => [
    normalise(label),
    type,
  ]),
);

/**
 * The schema.org `@type` for a business with this category label, or
 * "LocalBusiness" when there is no type we can stand behind.
 *
 * Never throws and never returns an empty string: the caller drops the result
 * straight into `"@type"`, and a page with no type at all is worse than a page
 * with a general one.
 */
export function schemaTypeFor(label: string | undefined): string {
  if (!label) return FALLBACK;
  return BY_NORMALISED_LABEL.get(normalise(label)) ?? FALLBACK;
}
