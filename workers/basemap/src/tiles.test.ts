// The tile path is the only part of serving a planet file that can be tested without
// the planet file. It is also the part where a mistake is silent: an unbounded z/x/y
// goes to the archive, misses, and returns "no tile here" — which looks exactly like
// ocean.
import { describe, expect, it } from "vitest";
import { parseTilePath } from "./tiles";

describe("the tile path", () => {
  it("reads z/x/y, with or without an extension", () => {
    expect(parseTilePath("/basemap/tiles/10/292/391.mvt")).toEqual({
      z: 10,
      x: 292,
      y: 391,
    });
    expect(parseTilePath("/basemap/tiles/10/292/391.pbf")).toEqual({
      z: 10,
      x: 292,
      y: 391,
    });
    expect(parseTilePath("/basemap/tiles/0/0/0")).toEqual({ z: 0, x: 0, y: 0 });
  });

  it("leaves everything else alone, so the copy endpoints still work", () => {
    for (const p of [
      "/copy/step",
      "/basemap/health",
      "/basemap/tiles.json",
      "/",
    ]) {
      expect(parseTilePath(p), p).toBe("not-a-tile");
    }
  });

  it("refuses a tile outside the pyramid rather than asking the archive", () => {
    // At z=2 there are 4×4 tiles, so 4 does not exist. Without the bound this would be
    // a lookup that misses and returns 204 — indistinguishable from ocean.
    expect(parseTilePath("/basemap/tiles/2/4/0")).toBe("out-of-range");
    expect(parseTilePath("/basemap/tiles/2/0/4")).toBe("out-of-range");
    expect(parseTilePath("/basemap/tiles/0/1/0")).toBe("out-of-range");
    expect(parseTilePath("/basemap/tiles/99/0/0")).toBe("out-of-range");
  });

  it("accepts the far corner of a zoom level", () => {
    expect(parseTilePath("/basemap/tiles/2/3/3")).toEqual({ z: 2, x: 3, y: 3 });
    // the planet build is zoom 0–15; 15 must be reachable
    expect(parseTilePath("/basemap/tiles/15/32767/32767")).toEqual({
      z: 15,
      x: 32767,
      y: 32767,
    });
  });

  it("does not accept negatives or nonsense", () => {
    expect(parseTilePath("/basemap/tiles/-1/0/0")).toBe("not-a-tile");
    expect(parseTilePath("/basemap/tiles/1/x/0")).toBe("not-a-tile");
    expect(parseTilePath("/basemap/tiles/1/0/0/0")).toBe("not-a-tile");
  });
});
