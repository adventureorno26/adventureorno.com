"""Name a route by WHERE IT ACTUALLY WENT, from OpenStreetMap.

The bug this replaces: MapTiler returns the nearest POINT, so a hike in Seneca
Regional Park came back "Camp Fraser" (an adjacent Scout camp) and a hike that
starts in a trailhead car park came back "SR630".

The fix is to look at the whole route, not one point:
  1. sample N points evenly along the polyline
  2. ask Overpass, once, for the named trail under each sample and the named
     park/protected area containing it
  3. a TRAIL that carries most of the route wins (a long point-to-point crosses
     several parks, and the trail is what you'd call it)
  4. otherwise the PARK that contains most of the route wins (a loop inside one park)
"""
import json, time, urllib.request, urllib.parse, collections, math

OVERPASS = "https://overpass-api.de/api/interpreter"

AREA_FILTER = """
  (area.a["leisure"~"^(park|nature_reserve|recreation_ground)$"]["name"];
   area.a["boundary"~"^(protected_area|national_park)$"]["name"];
   area.a["landuse"="forest"]["name"];);
"""

def sample(pts, n=9):
    if len(pts) <= n:
        return pts
    step = (len(pts) - 1) / (n - 1)
    return [pts[round(i * step)] for i in range(n)]


def build_query(samples):
    parts = ["[out:json][timeout:60];"]
    for i, (la, ln) in enumerate(samples):
        parts.append(f'is_in({la},{ln})->.a;')
        parts.append(AREA_FILTER.replace("area.a", "area.a"))
        parts.append(f'out tags;')
        parts.append(
            f'way(around:45,{la},{ln})'
            f'["highway"~"^(path|footway|track|cycleway|bridleway|steps)$"]["name"];'
            f'out tags 6;'
        )
    return "\n".join(parts)


def overpass(q, tries=4):
    for k in range(tries):
        try:
            data = urllib.parse.urlencode({"data": q}).encode()
            req = urllib.request.Request(
                OVERPASS, data=data,
                headers={"User-Agent": "AdventureOrNo/1.0 (personal travel map)"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:
            if k == tries - 1:
                raise
            time.sleep(4 * (k + 1))
    return None


def name_route(pts, n=9):
    """-> (name, kind, evidence) or (None, None, {})"""
    s = sample(pts, n)
    res = overpass(build_query(s))
    trails = collections.Counter()
    parks = collections.Counter()
    for e in res.get("elements", []):
        t = e.get("tags", {})
        nm = (t.get("name") or "").strip()
        if not nm:
            continue
        if e["type"] == "way" and t.get("highway"):
            trails[nm] += 1
        else:
            parks[nm] += 1
    ev = {"trails": dict(trails.most_common(5)), "parks": dict(parks.most_common(5)),
          "samples": len(s)}
    # A trail that carries most of the route is what you'd call it.
    if trails:
        nm, c = trails.most_common(1)[0]
        if c >= max(2, math.ceil(0.5 * len(s))):
            return nm, "trail", ev
    # Otherwise the park that contains most of it. Prefer the one seen most; ties
    # break to the longer (more specific) name.
    if parks:
        top = max(parks.items(), key=lambda kv: (kv[1], len(kv[0])))
        if top[1] >= max(2, math.ceil(0.4 * len(s))):
            return top[0], "park", ev
        return top[0], "park-weak", ev
    if trails:
        return trails.most_common(1)[0][0], "trail-weak", ev
    return None, None, ev
