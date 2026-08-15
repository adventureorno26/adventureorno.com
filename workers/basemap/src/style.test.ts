// NO ICONS. Erica's rule, and the only exception in the whole app is the heart and the
// flame on a photo. The basemap theme paints POI and town markers from a sprite sheet,
// so the style has to have them taken out before it is served.
import { describe, expect, it } from "vitest";
import { withoutIcons } from "./style";

const layer = (id: string, layout: Record<string, unknown>) => ({ id, layout });

describe("taking the icons out", () => {
  it("keeps the WORDS when a layer draws both", () => {
    // places_locality draws the town dot AND the town name in one layer. Dropping the
    // whole layer — which is what I did first — takes every city label off the map.
    const out = withoutIcons([
      layer("places_locality", {
        "icon-image": "townspot",
        "icon-size": 0.7,
        "text-field": "{name}",
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].layout).not.toHaveProperty("icon-image");
    expect(out[0].layout).not.toHaveProperty("icon-size");
    expect(out[0].layout).toHaveProperty("text-field");
  });

  it("drops a layer that was only ever an icon", () => {
    expect(
      withoutIcons([layer("poi_dots", { "icon-image": "dot" })]),
    ).toHaveLength(0);
  });

  it("leaves layers that draw no icon completely alone", () => {
    const roads = layer("roads", { "line-cap": "round" });
    expect(withoutIcons([roads])[0]).toBe(roads);
  });

  it("cleans up a stray icon property with no icon behind it", () => {
    // places_country carries icon-padding without an icon-image. It never drew
    // anything, but leaving it makes "there are no icons" impossible to assert.
    const out = withoutIcons([
      layer("places_country", { "icon-padding": 2, "text-field": "{name}" }),
    ]);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0].layout!).some((k) => k.startsWith("icon-"))).toBe(
      false,
    );
    expect(out[0].layout).toHaveProperty("text-field");
  });

  it("leaves nothing icon-shaped in a whole style", () => {
    const out = withoutIcons([
      layer("a", { "icon-image": "x", "text-field": "{name}" }),
      layer("b", { "icon-image": "y" }),
      layer("c", { "line-width": 1 }),
    ]);
    expect(out.map((l) => l.id)).toEqual(["a", "c"]);
    expect(
      out.some((l) =>
        Object.keys(l.layout ?? {}).some((k) => k.startsWith("icon-")),
      ),
    ).toBe(false);
  });
});
