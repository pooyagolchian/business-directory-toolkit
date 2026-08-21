/**
 * Seed data/taxonomy-map.json deterministically, with no LLM call.
 *
 *   pnpm seed-taxonomy --dry-run   report the coverage this would achieve
 *   pnpm seed-taxonomy --write     merge into data/taxonomy-map.json
 *
 * WHY THIS EXISTS
 *
 * The category vocabulary is Zipf-distributed. Measured on the v0.1 corpus:
 * 723 distinct primary categories across 15,246 businesses, but the top 100
 * cover 87.3% of them and the top 200 cover 93.3%.
 *
 * So the head does not need a language model. A few dozen keyword rules
 * classify the overwhelming majority of the corpus deterministically, for free,
 * and reviewably. The model's real job is the ~1,500-item tail that no human
 * would ever hand-map — which is a more honest description of where it earns
 * its keep than "the LLM does the taxonomy".
 *
 * Existing entries always win, here as everywhere: a human correction in the
 * committed map is never overwritten.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  distinctCategories,
  type RawLocalResult,
  type TaxonomyMap,
  type TaxonomyNode,
} from "@directory/core";

interface Rule {
  match: RegExp;
  l1: string;
  l2: string;
  l3?: string;
}

/**
 * Ordered; first match wins, so the specific must precede the general.
 * "Seafood restaurant" has to be tested before the bare "restaurant".
 */
const RULES: Rule[] = [
  // ---------------------------------------------------------- Food & Drink
  {
    match: /\b(shawarma|shawerma)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Shawarma",
  },
  {
    match: /\bbiryani\b/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Indian",
  },
  {
    match: /\b(indian|modern indian|south indian|kerala|punjabi)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Indian",
  },
  {
    match: /\b(pakistani|afghani|afghan)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Pakistani",
  },
  {
    match: /\b(lebanese|syrian|levantine)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Levantine",
  },
  {
    match: /\b(arab|arabian|emirati|khaleeji)\b.*\b(restaurant|food)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Arabic",
  },
  {
    match: /\b(iranian|persian)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Persian",
  },
  {
    match: /\b(turkish|ottoman)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Turkish",
  },
  {
    match: /\b(chinese|szechuan|cantonese|dim sum)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Chinese",
  },
  {
    match: /\b(japanese|sushi|ramen|izakaya)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Japanese",
  },
  { match: /\b(korean)/i, l1: "Food & Drink", l2: "Restaurants", l3: "Korean" },
  { match: /\b(thai)/i, l1: "Food & Drink", l2: "Restaurants", l3: "Thai" },
  {
    match: /\b(vietnamese)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Vietnamese",
  },
  {
    match: /\b(filipino)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Filipino",
  },
  {
    match: /\b(asian|pan-asian|oriental)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Asian",
  },
  {
    match: /\b(italian|pizza|pizzeria|pasta)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Italian",
  },
  {
    match: /\b(french|bistro|brasserie)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "French",
  },
  {
    match: /\b(spanish|tapas)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Spanish",
  },
  {
    match: /\b(greek|mediterranean)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Mediterranean",
  },
  {
    match: /\b(mexican|tex-mex)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Mexican",
  },
  {
    match: /\b(american|diner)\b.*\brestaurant\b/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "American",
  },
  {
    match: /\b(european|continental)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "European",
  },
  {
    match: /\b(russian|ukrainian|georgian)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Eastern European",
  },
  {
    match: /\b(african|ethiopian|nigerian|somali)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "African",
  },
  {
    match: /\b(seafood|oyster|fish)\b.*\b(restaurant|bar)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Seafood",
  },
  {
    match: /\b(steak|steakhouse|grill house)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Steakhouse",
  },
  {
    match: /\b(barbecue|bbq|bar & grill|grill)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Grill",
  },
  {
    match: /\b(burger|fast food|hamburger)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Fast Food",
  },
  {
    match: /\b(chicken|fried chicken|wings)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Chicken",
  },
  {
    match: /\b(vegan|vegetarian|plant-based)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Vegetarian",
  },
  { match: /\b(buffet)/i, l1: "Food & Drink", l2: "Restaurants", l3: "Buffet" },
  {
    match: /\b(fine dining)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Fine Dining",
  },
  {
    match: /\b(breakfast|brunch)/i,
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Breakfast",
  },
  {
    match: /\b(juice|smoothie)/i,
    l1: "Food & Drink",
    l2: "Cafes",
    l3: "Juice Bars",
  },
  {
    match: /\b(coffee|espresso|karak)/i,
    l1: "Food & Drink",
    l2: "Cafes",
    l3: "Coffee",
  },
  { match: /\b(cafeteria)/i, l1: "Food & Drink", l2: "Cafes", l3: "Cafeteria" },
  {
    match: /\b(tea house|tea room)/i,
    l1: "Food & Drink",
    l2: "Cafes",
    l3: "Tea",
  },
  { match: /\b(cafe|coffee shop|caf��)/i, l1: "Food & Drink", l2: "Cafes" },
  { match: /\b(hookah|shisha)/i, l1: "Food & Drink", l2: "Bars", l3: "Shisha" },
  { match: /\b(cocktail|wine bar|pub|bar\b)/i, l1: "Food & Drink", l2: "Bars" },
  {
    match: /\b(bakery|patisserie|pastry|bread)/i,
    l1: "Food & Drink",
    l2: "Bakeries",
  },
  {
    match: /\b(dessert|ice cream|sweets|chocolate|candy|confection|cake)/i,
    l1: "Food & Drink",
    l2: "Bakeries",
    l3: "Desserts",
  },
  { match: /\b(caterer|catering)/i, l1: "Services", l2: "Catering" },
  { match: /\brestaurant\b/i, l1: "Food & Drink", l2: "Restaurants" },

  // ------------------------------------------------------- Health & Medical
  {
    match: /\bpharmac(y|ies)|drugstore|chemist\b/i,
    l1: "Health & Medical",
    l2: "Pharmacies",
  },
  {
    match: /\b(dental|dentist|orthodont|endodont)/i,
    l1: "Health & Medical",
    l2: "Dentists",
  },
  {
    match: /\b(optic|optometr|eye care|eyewear|sunglasses)/i,
    l1: "Health & Medical",
    l2: "Opticians",
  },
  { match: /\b(hospital)/i, l1: "Health & Medical", l2: "Hospitals" },
  {
    match: /\b(laborator|diagnostic|radiolog|x-ray|imaging)/i,
    l1: "Health & Medical",
    l2: "Labs & Diagnostics",
  },
  {
    match: /\b(physiotherap|chiropract|rehabilitation)/i,
    l1: "Health & Medical",
    l2: "Physiotherapy",
  },
  {
    match: /\b(dermatolog|skin care clinic)/i,
    l1: "Health & Medical",
    l2: "Clinics",
    l3: "Dermatology",
  },
  {
    match: /\b(pediatric|paediatric)/i,
    l1: "Health & Medical",
    l2: "Clinics",
    l3: "Paediatrics",
  },
  {
    match: /\b(gynecolog|obstetric|fertility|maternity)/i,
    l1: "Health & Medical",
    l2: "Clinics",
    l3: "Women's Health",
  },
  {
    match: /\b(psycholog|psychiatr|mental health|counsel)/i,
    l1: "Health & Medical",
    l2: "Clinics",
    l3: "Mental Health",
  },
  {
    match: /\b(alternative medicine|homeopath|ayurved|acupunctur)/i,
    l1: "Health & Medical",
    l2: "Clinics",
    l3: "Alternative Medicine",
  },
  {
    match: /\b(clinic|medical cent|polyclinic|doctor|physician|surger)/i,
    l1: "Health & Medical",
    l2: "Clinics",
  },
  { match: /\b(veterinar|animal hospital)/i, l1: "Pets", l2: "Veterinary" },

  // ------------------------------------------------------ Beauty & Wellness
  { match: /\b(barber)/i, l1: "Beauty & Wellness", l2: "Barbers" },
  {
    match: /\b(nail salon|manicure|pedicure)/i,
    l1: "Beauty & Wellness",
    l2: "Nail Salons",
  },
  {
    match: /\b(massage|spa|hammam|sauna)/i,
    l1: "Beauty & Wellness",
    l2: "Spas",
  },
  {
    match:
      /\b(beauty salon|hair salon|hairdress|beauty parlour|beauty parlor|salon)/i,
    l1: "Beauty & Wellness",
    l2: "Salons",
  },
  {
    match: /\b(tattoo|piercing)/i,
    l1: "Beauty & Wellness",
    l2: "Tattoo & Piercing",
  },
  {
    match: /\b(gym|fitness|crossfit|yoga|pilates|martial arts|boxing)/i,
    l1: "Sports & Fitness",
    l2: "Gyms",
  },
  {
    match: /\b(swimming pool|sports club|stadium|padel|tennis|football)/i,
    l1: "Sports & Fitness",
    l2: "Sports Clubs",
  },

  // ------------------------------------------------------------- Automotive
  {
    match: /\b(car rental|rent a car|car hire)/i,
    l1: "Automotive",
    l2: "Car Rental",
  },
  { match: /\b(car wash|auto detail)/i, l1: "Automotive", l2: "Car Wash" },
  {
    match: /\b(car dealer|used car|car showroom|motor vehicle dealer)/i,
    l1: "Automotive",
    l2: "Car Dealers",
  },
  {
    match: /\b(auto part|spare part|tire|tyre|battery)/i,
    l1: "Automotive",
    l2: "Auto Parts",
  },
  {
    match: /\b(auto repair|car repair|garage|mechanic|motor|automobile)/i,
    l1: "Automotive",
    l2: "Auto Repair",
  },
  {
    match: /\b(driving school|driving instructor)/i,
    l1: "Education",
    l2: "Driving Schools",
  },
  {
    match: /\b(petrol|gas station|fuel)/i,
    l1: "Automotive",
    l2: "Petrol Stations",
  },

  // ---------------------------------------------------------------- Shopping
  { match: /\b(supermarket|hypermarket)/i, l1: "Shopping", l2: "Supermarkets" },
  {
    match: /\b(grocer|mini mart|convenience store|baqala)/i,
    l1: "Shopping",
    l2: "Grocery Stores",
  },
  {
    match: /\b(butcher|meat|poultry|fishmonger|seafood market)/i,
    l1: "Shopping",
    l2: "Butchers & Fishmongers",
  },
  {
    match: /\b(cell phone|mobile phone|smartphone)/i,
    l1: "Shopping",
    l2: "Mobile Phone Shops",
  },
  {
    match: /\b(electronic|computer|laptop|appliance)/i,
    l1: "Shopping",
    l2: "Electronics",
  },
  {
    match: /\b(furniture|mattress|home decor|interior)\b.*\b(store|shop)/i,
    l1: "Shopping",
    l2: "Furniture",
  },
  { match: /\bfurniture\b/i, l1: "Shopping", l2: "Furniture" },
  {
    match: /\b(jewel|jewell|gold|diamond|watch store)/i,
    l1: "Shopping",
    l2: "Jewellery",
  },
  {
    match: /\b(clothing|apparel|fashion|boutique|garment|abaya|tailor shop)/i,
    l1: "Shopping",
    l2: "Clothing",
  },
  { match: /\b(shoe|footwear)/i, l1: "Shopping", l2: "Shoes" },
  {
    match: /\b(perfume|fragrance|oud|cosmetic|makeup)/i,
    l1: "Shopping",
    l2: "Perfume & Cosmetics",
  },
  {
    match: /\b(book|stationer|office supply)/i,
    l1: "Shopping",
    l2: "Books & Stationery",
  },
  { match: /\b(toy|game store|hobby)/i, l1: "Shopping", l2: "Toys & Games" },
  { match: /\b(florist|flower)/i, l1: "Shopping", l2: "Florists" },
  { match: /\b(gift|souvenir)/i, l1: "Shopping", l2: "Gifts" },
  {
    match: /\b(hardware|building material|paint|tools)/i,
    l1: "Shopping",
    l2: "Hardware",
  },
  { match: /\b(pet (shop|store)|aquarium)/i, l1: "Pets", l2: "Pet Shops" },
  {
    match: /\b(shopping mall|shopping cent|department store)/i,
    l1: "Shopping",
    l2: "Malls",
  },
  {
    match: /\b(sporting goods|sports (shop|store))/i,
    l1: "Shopping",
    l2: "Sports Shops",
  },

  // ---------------------------------------------------------------- Services
  {
    match: /\b(laundry|dry clean|launderette)/i,
    l1: "Services",
    l2: "Laundry",
  },
  {
    match: /\b(tailor|alteration|sewing|embroider)/i,
    l1: "Services",
    l2: "Tailors",
  },
  {
    match: /\b(cleaning service|housekeep|maid|pest control|disinfect)/i,
    l1: "Services",
    l2: "Cleaning",
  },
  {
    match: /\b(moving|relocation|removal|storage)/i,
    l1: "Services",
    l2: "Movers & Storage",
  },
  {
    match: /\b(printing|copy shop|typing cent|photocopy|signage)/i,
    l1: "Services",
    l2: "Printing",
  },
  {
    match: /\b(courier|delivery|shipping|cargo|freight|logistics)/i,
    l1: "Services",
    l2: "Delivery & Logistics",
  },
  {
    match: /\b(photograph|photo studio|videograph)/i,
    l1: "Services",
    l2: "Photography",
  },
  { match: /\b(event|wedding|party plan)/i, l1: "Services", l2: "Events" },
  { match: /\b(security service|guard)/i, l1: "Services", l2: "Security" },
  {
    match: /\b(recruit|employment agency|manpower|staffing)/i,
    l1: "Professional",
    l2: "Recruitment",
  },

  // ------------------------------------------------------------ Professional
  {
    match: /\b(real estate|property manage|realtor|estate agent)/i,
    l1: "Professional",
    l2: "Real Estate",
  },
  {
    match: /\b(law\b|attorney|legal|advocate|notary)/i,
    l1: "Professional",
    l2: "Legal",
  },
  {
    match: /\b(account|audit|bookkeep|tax consult)/i,
    l1: "Professional",
    l2: "Accounting",
  },
  { match: /\b(insurance)/i, l1: "Professional", l2: "Insurance" },
  {
    match: /\b(bank|atm|money transfer|exchange|currency|financial)/i,
    l1: "Professional",
    l2: "Banking & Exchange",
  },
  {
    match: /\b(consult|business management|corporate service|business cent)/i,
    l1: "Professional",
    l2: "Consulting",
  },
  {
    match:
      /\b(advertis|marketing|media agency|design agency|web design|software)/i,
    l1: "Professional",
    l2: "Marketing & Tech",
  },
  {
    match: /\b(translat|attestation|visa|immigration|typing)/i,
    l1: "Professional",
    l2: "Documents & Visas",
  },

  // --------------------------------------------------- Travel & Hospitality
  {
    match: /\b(hotel|resort|guest house|hostel|serviced apartment|motel)/i,
    l1: "Travel & Hospitality",
    l2: "Hotels",
  },
  {
    match: /\b(travel agenc|tour operator|tour agency|holiday)/i,
    l1: "Travel & Hospitality",
    l2: "Travel Agencies",
  },
  {
    match:
      /\b(tourist attraction|museum|landmark|observation deck|theme park|water park|zoo)/i,
    l1: "Travel & Hospitality",
    l2: "Attractions",
  },
  {
    match: /\b(desert safari|dhow|yacht|boat|cruise)/i,
    l1: "Travel & Hospitality",
    l2: "Tours & Charters",
  },

  // --------------------------------------------------------------- Education
  {
    match: /\b(nursery|kindergarten|preschool|day care|daycare)/i,
    l1: "Education",
    l2: "Nurseries",
  },
  { match: /\b(school|academy)/i, l1: "Education", l2: "Schools" },
  {
    match: /\b(universit|college|institute of)/i,
    l1: "Education",
    l2: "Universities",
  },
  {
    match:
      /\b(training cent|tutor|coaching cent|learning cent|language school)/i,
    l1: "Education",
    l2: "Training",
  },
  { match: /\b(librar)/i, l1: "Education", l2: "Libraries" },

  // --------------------------------------------------- Home & Construction
  {
    match: /\b(contractor|construction|building compan|civil engineer)/i,
    l1: "Home & Construction",
    l2: "Contractors",
  },
  {
    match: /\b(interior design|fit-out|fitout|decorat)/i,
    l1: "Home & Construction",
    l2: "Interior Design",
  },
  {
    match: /\b(plumb|electrician|air condition|hvac|handyman|maintenance)/i,
    l1: "Home & Construction",
    l2: "Maintenance",
  },
  {
    match: /\b(carpent|joiner|glass|aluminium|aluminum|metal|welding)/i,
    l1: "Home & Construction",
    l2: "Trades",
  },
  {
    match: /\b(landscap|garden|nursery garden)/i,
    l1: "Home & Construction",
    l2: "Landscaping",
  },
  {
    match: /\b(architect|engineering consult|surveyor)/i,
    l1: "Home & Construction",
    l2: "Architecture & Engineering",
  },

  // ------------------------------------------------- Nightlife & Attractions
  {
    match: /\b(night club|nightclub|disco|lounge)/i,
    l1: "Nightlife",
    l2: "Clubs & Lounges",
  },
  {
    match: /\b(cinema|movie theat|theatre|theater|concert)/i,
    l1: "Nightlife",
    l2: "Cinemas & Venues",
  },
  {
    match: /\b(live music|karaoke|entertainment)/i,
    l1: "Nightlife",
    l2: "Live Music",
  },

  // ----------------------------------------------------------- Public & Misc
  {
    match: /\b(mosque|church|temple|gurudwara|place of worship)/i,
    l1: "Community",
    l2: "Places of Worship",
  },
  {
    match:
      /\b(government|municipal|embassy|consulate|police|post office|court)/i,
    l1: "Community",
    l2: "Government",
  },
  {
    match: /\b(charit|non-profit|foundation|association)/i,
    l1: "Community",
    l2: "Charities",
  },
  {
    match: /\b(park|playground|beach)/i,
    l1: "Community",
    l2: "Parks & Beaches",
  },
  { match: /\b(parking|valet)/i, l1: "Services", l2: "Parking" },
  {
    match:
      /\b(warehouse|factory|manufactur|industrial|trading compan|wholesal|supplier|distributor)/i,
    l1: "Trade & Industry",
    l2: "Wholesale & Manufacturing",
  },
];

export function classifyByRules(category: string): TaxonomyNode | null {
  for (const rule of RULES) {
    if (rule.match.test(category)) {
      const node: TaxonomyNode = { l1: rule.l1, l2: rule.l2 };
      if (rule.l3) node.l3 = rule.l3;
      return node;
    }
  }
  return null;
}

// ------------------------------------------------------------------ CLI

const argv = process.argv.slice(2);
const write = argv.includes("--write");

const root = new URL("../../../../", import.meta.url);
const mapPath = fileURLToPath(new URL("data/taxonomy-map.json", root));
const recordsPath = fileURLToPath(new URL("data/out/raw-records.json", root));

const existing = JSON.parse(readFileSync(mapPath, "utf8")) as TaxonomyMap;
const records = JSON.parse(
  readFileSync(recordsPath, "utf8"),
) as RawLocalResult[];
const distinct = distinctCategories(records);

const seeded: TaxonomyMap = {};
let matched = 0;
for (const category of distinct) {
  if (existing[category]) continue;
  const node = classifyByRules(category);
  if (!node) continue;
  seeded[category] = node;
  matched++;
}

// Existing entries win — a committed human correction is never overwritten.
const merged: TaxonomyMap = { ...seeded, ...existing };

const covered = records.filter((r) => {
  const cats = [r.type, ...(r.types ?? [])].filter(Boolean) as string[];
  return cats.some((c) => merged[c]);
}).length;

const unmatched = distinct.filter((c) => !merged[c]);

console.log(`
Seed taxonomy — rules only, no LLM
==================================
Distinct categories       ${distinct.length.toLocaleString()}
Already in the map        ${Object.keys(existing).length.toLocaleString()}
Newly matched by rules    ${matched.toLocaleString()}
Map total after merge     ${Object.keys(merged).length.toLocaleString()}
Still unmatched           ${unmatched.length.toLocaleString()}

Business coverage         ${((100 * covered) / records.length).toFixed(1)}%  (${covered.toLocaleString()} of ${records.length.toLocaleString()})

The tail is what the LLM is for. Run \`pnpm classify\` to handle the
${unmatched.length.toLocaleString()} categories no rule matched.
`);

if (unmatched.length > 0) {
  console.log("Sample of what rules could not place:");
  for (const c of unmatched.slice(0, 15)) console.log(`  ${c}`);
  console.log();
}

if (write) {
  const sorted = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(mapPath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(
    `Wrote ${Object.keys(sorted).length} entries to data/taxonomy-map.json\n`,
  );
} else {
  console.log("--dry-run by default. Pass --write to update the map.\n");
}
