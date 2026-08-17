// @vitest-environment jsdom
//
// The GPX/TCX import path, tested for the first time.
//
// WHY IT NEVER WAS. `parseActivityFile` uses `DOMParser`, and this project's vitest runs
// with `environment: 'node'`, where `DOMParser` does not exist — so the only test that
// could touch it would have thrown on the first line. The FIT path got a test; the format
// Erica actually exports from Garmin Connect did not. On 2026-08-17 she uploaded GPX/TCX
// files and got "Done — 0 activities imported", and there was no test anywhere that could
// have told either of us whether the parser was at fault.
//
// This file runs in jsdom so the real parser runs against real export XML.
//
// It also pins the provenance the parser used to discard. Every one of the 265 file-sourced
// rows in production says origin 'unknown' with no de-dup key, which meant a re-uploaded
// export could only be caught by Tier 2's proposal — a person confirming what the file
// itself could have proved.
import { describe, expect, it } from 'vitest';
import { parseActivityFile } from './importFile';

/** A GPX shaped like Garmin Connect's export, down to the activity link it stamps in. */
const GARMIN_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Garmin Connect" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <link href="connect.garmin.com"><text>Garmin Connect</text></link>
    <time>2026-08-16T13:04:00.000Z</time>
  </metadata>
  <trk>
    <name>Seneca Ridge Trail</name>
    <type>hiking</type>
    <link href="https://connect.garmin.com/modern/activity/20481576392"/>
    <trkseg>
      <trkpt lat="39.050524" lon="-77.303298"><ele>112.0</ele><time>2026-08-16T13:04:00.000Z</time></trkpt>
      <trkpt lat="39.050924" lon="-77.302998"><ele>113.0</ele><time>2026-08-16T13:04:30.000Z</time></trkpt>
      <trkpt lat="39.051324" lon="-77.302698"><ele>114.0</ele><time>2026-08-16T13:05:00.000Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

/** A TCX shaped like Garmin Connect's export: Creator is the watch, Author the software. */
const GARMIN_TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Hiking">
      <Id>2026-08-16T13:04:00.000Z</Id>
      <Lap StartTime="2026-08-16T13:04:00.000Z">
        <DistanceMeters>5123.4</DistanceMeters>
        <Track>
          <Trackpoint>
            <Time>2026-08-16T13:04:00.000Z</Time>
            <Position><LatitudeDegrees>39.050524</LatitudeDegrees><LongitudeDegrees>-77.303298</LongitudeDegrees></Position>
            <DistanceMeters>0.0</DistanceMeters>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-08-16T13:05:00.000Z</Time>
            <Position><LatitudeDegrees>39.051324</LatitudeDegrees><LongitudeDegrees>-77.302698</LongitudeDegrees></Position>
            <DistanceMeters>5123.4</DistanceMeters>
          </Trackpoint>
        </Track>
      </Lap>
      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <Name>Garmin fenix 6S Pro</Name>
        <UnitId>3987654321</UnitId>
        <ProductID>3121</ProductID>
      </Creator>
    </Activity>
  </Activities>
  <Author xsi:type="Application_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Name>Garmin Connect API</Name>
  </Author>
</TrainingCenterDatabase>`;

describe('parseActivityFile — GPX', () => {
  it('reads a Garmin Connect GPX export', () => {
    const parsed = parseActivityFile(GARMIN_GPX, 'activity_20481576392.gpx');
    // The failure this guards: a null here is "0 activities imported" with no explanation.
    expect(parsed, 'a valid Garmin GPX must not parse to null').not.toBeNull();
    expect(parsed!.name).toBe('Seneca Ridge Trail');
    expect(parsed!.type).toBe('Hike');
    expect(parsed!.lat).toBeCloseTo(39.050524, 5);
    expect(parsed!.lng).toBeCloseTo(-77.303298, 5);
    expect(parsed!.date).toBe('2026-08-16T13:04:00.000Z');
    expect(parsed!.polyline).toBeTruthy();
  });

  it('says where it came from instead of "unknown"', () => {
    const parsed = parseActivityFile(GARMIN_GPX, 'activity.gpx');
    expect(parsed!.origin).toBe('garmin');
    expect(parsed!.device).toBe('Garmin Connect');
  });

  it("carries Garmin's own activity id, so re-exporting the same outing attaches", () => {
    const parsed = parseActivityFile(GARMIN_GPX, 'activity.gpx');
    expect(parsed!.externalKey).toBe('garmin-connect:20481576392');
  });

  it('recognises a Strava GPX export as coming from Strava', () => {
    const parsed = parseActivityFile(GARMIN_GPX.replace('Garmin Connect"', 'StravaGPX"'), 'a.gpx');
    expect(parsed!.origin).toBe('strava-app');
  });

  it('gives no key at all when the file has nothing identifying', () => {
    // A guessed key is worse than none: file imports are not scoped by a connection, so a
    // weak key is global and two people could collide into one activity.
    const plain = GARMIN_GPX.replace(/<link[^>]*\/>/g, '').replace(
      /<link href="connect.garmin.com">.*?<\/link>/s,
      '',
    );
    const parsed = parseActivityFile(plain, 'a.gpx');
    expect(parsed!.externalKey).toBeUndefined();
  });
});

describe('parseActivityFile — TCX', () => {
  it('reads a Garmin Connect TCX export', () => {
    const parsed = parseActivityFile(GARMIN_TCX, 'activity_20481576392.tcx');
    expect(parsed, 'a valid Garmin TCX must not parse to null').not.toBeNull();
    expect(parsed!.type).toBe('Hike');
    expect(parsed!.distance).toBe(5123);
    expect(parsed!.date).toBe('2026-08-16T13:04:00.000Z');
  });

  it('names the watch, not the software that exported it', () => {
    const parsed = parseActivityFile(GARMIN_TCX, 'a.tcx');
    expect(parsed!.device).toBe('Garmin fenix 6S Pro');
    expect(parsed!.origin).toBe('garmin');
  });

  it('keys a TCX exactly like the watch file it came from', () => {
    // The whole point: the .fit off the watch and the .tcx of that same activity must be
    // ONE source record. parseFitActivity builds `fit:garmin:3121:3987654321:<created>`.
    const parsed = parseActivityFile(GARMIN_TCX, 'a.tcx');
    expect(parsed!.externalKey).toBe('fit:garmin:3121:3987654321:2026-08-16T13:04:00.000Z');
  });

  it('refuses a key when the export has no device serial', () => {
    const noUnit = GARMIN_TCX.replace('<UnitId>3987654321</UnitId>', '');
    const parsed = parseActivityFile(noUnit, 'a.tcx');
    expect(parsed!.externalKey).toBeUndefined();
    // …but the activity itself still imports. Never dropped, only unkeyed.
    expect(parsed!.lat).toBeCloseTo(39.050524, 5);
  });
});
