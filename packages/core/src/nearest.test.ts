import { describe, expect, test } from "vitest";
import { nearestTile } from "./nearest";
import type { CityTile } from "./types";

const tiles: CityTile[] = [
  {
    id: "downtown",
    name: "Downtown",
    lat: 25.1972,
    lng: 55.2744,
    zoom: 15,
    density: "dense",
  },
  {
    id: "difc",
    name: "DIFC",
    lat: 25.211,
    lng: 55.28,
    zoom: 15,
    density: "dense",
  },
  {
    id: "jumeirah",
    name: "Jumeirah",
    lat: 25.2048,
    lng: 55.2422,
    zoom: 15,
    density: "dense",
  },
  {
    id: "deira",
    name: "Deira",
    lat: 25.2697,
    lng: 55.3095,
    zoom: 15,
    density: "dense",
  },
  {
    id: "hatta",
    name: "Hatta",
    lat: 24.7994,
    lng: 56.1213,
    zoom: 13,
    density: "sparse",
  },
];

describe("nearestTile", () => {
  test("assigns a business to the tile it is actually closest to", () => {
    // A business sitting on the DIFC centroid belongs to DIFC.
    expect(nearestTile(25.211, 55.28, tiles)).toBe("difc");
  });

  test("corrects a business found by a distant tile's query", () => {
    // The bug this exists to fix: "Rove La Mer Beach, Jumeirah" was surfaced by
    // the DIFC query but sits in Jumeirah. Geography decides, not provenance.
    expect(nearestTile(25.2048, 55.2422, tiles)).toBe("jumeirah");
  });

  test("does not confuse a far-away tile for a near one", () => {
    // Hatta is ~130km east. Nothing in the city proper should land there.
    expect(nearestTile(25.2, 55.27, tiles)).not.toBe("hatta");
  });

  test("still picks Hatta for a business actually in Hatta", () => {
    expect(nearestTile(24.7994, 56.1213, tiles)).toBe("hatta");
  });

  test("returns null when there are no tiles to choose from", () => {
    expect(nearestTile(25.2, 55.27, [])).toBeNull();
  });

  test("is deterministic for an exact tie", () => {
    const twin: CityTile[] = [
      { id: "a", name: "A", lat: 25.0, lng: 55.0, zoom: 15, density: "dense" },
      { id: "b", name: "B", lat: 25.0, lng: 55.0, zoom: 15, density: "dense" },
    ];
    expect(nearestTile(25.0, 55.0, twin)).toBe(nearestTile(25.0, 55.0, twin));
  });

  test("accounts for longitude convergence rather than treating degrees as square", () => {
    // At Dubai's latitude a degree of longitude is ~11% shorter than a degree
    // of latitude. Treating them as equal misassigns businesses near the
    // midpoint between two tiles.
    const pair: CityTile[] = [
      {
        id: "north",
        name: "N",
        lat: 25.3,
        lng: 55.0,
        zoom: 15,
        density: "dense",
      },
      {
        id: "east",
        name: "E",
        lat: 25.0,
        lng: 55.3,
        zoom: 15,
        density: "dense",
      },
    ];
    // Equidistant in raw degrees from both; true distance favours "east",
    // because those 0.3 degrees of longitude are physically shorter.
    expect(nearestTile(25.0, 55.0, pair)).toBe("east");
  });
});
