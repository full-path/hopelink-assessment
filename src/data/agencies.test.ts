import { describe, expect, it } from "vitest";
import { createAgencyResolver, parseAgencyRoster } from "./agencies";

const HEADER = "Agency,Kind,Aliases,Capability survey,Note";
const roster = (...rows: string[]) => parseAgencyRoster([HEADER, ...rows].join("\n"));

describe("parseAgencyRoster", () => {
  it("derives the id from the display name and makes the name an alias of itself", () => {
    expect(roster("Hyde Shuttle,Ride provider,,Returned,")).toEqual([
      {
        id: "hyde-shuttle",
        displayName: "Hyde Shuttle",
        kind: "ride_provider",
        aliases: ["Hyde Shuttle"],
        capabilitySurvey: "returned",
      },
    ]);
  });

  it("splits aliases on semicolons, so an alias may itself contain a comma", () => {
    const [agency] = roster(
      'Sound Generations VTS,Ride provider,"SG VTS; Sound Generations, VTS",,',
    );
    expect(agency?.aliases).toEqual(["Sound Generations VTS", "SG VTS", "Sound Generations, VTS"]);
  });

  it("accepts each kind in sheet wording or contract wording, in any case", () => {
    const agencies = roster("A,Ride provider,,,", "B,fare program,,,", "C,TRAVEL_TRAINING,,,");
    expect(agencies.map((agency) => agency.kind)).toEqual([
      "ride_provider",
      "fare_program",
      "travel_training",
    ]);
  });

  it("rejects an unknown kind rather than guessing one", () => {
    expect(() => roster("A,Shuttle,,,")).toThrow(/Agency "A": Kind is "Shuttle"/);
  });

  it("rejects a missing kind", () => {
    expect(() => roster("A,,,,")).toThrow(/Agency "A" has no Kind/);
  });

  it("reads a blank Capability survey as not surveyed, and rejects anything but Returned", () => {
    expect(roster("A,Ride provider,,,")[0]?.capabilitySurvey).toBe("not_surveyed");
    expect(roster("A,Ride provider,,returned,")[0]?.capabilitySurvey).toBe("returned");
    expect(() => roster("A,Ride provider,,Yes,")).toThrow(/Capability survey is "Yes"/);
  });

  it("skips blank rows", () => {
    expect(roster(",,,,", "A,Ride provider,,,")).toHaveLength(1);
  });

  it("rejects two rows that would share an id", () => {
    expect(() => roster("Zip Shuttle,Ride provider,,,", "ZIP shuttle,Ride provider,,,")).toThrow(
      /two rows that produce the id "zip-shuttle"/,
    );
  });

  it("rejects a roster missing a required column", () => {
    expect(() => parseAgencyRoster("Agency,Aliases\nA,")).toThrow(
      /Agencies tab is missing expected column.*"Kind"/,
    );
  });

  it("rejects a roster with no agencies", () => {
    expect(() => parseAgencyRoster(HEADER)).toThrow(/no agencies/);
  });
});

describe("createAgencyResolver", () => {
  const resolve = createAgencyResolver(
    roster("Beyond the Borders,Ride provider,Beyond the borders,,", "ORCA,Fare program,,,"),
  );

  it("matches any alias case-insensitively, after normalizing whitespace", () => {
    expect(resolve("beyond THE   borders ")).toBe("beyond-the-borders");
  });

  it("names the roster in its error, since that is where the fix goes", () => {
    expect(() => resolve("Some New Agency")).toThrow(/Unrecognized agency name.*agency roster/);
  });

  it("rejects an alias claimed by two agencies", () => {
    const colliding = roster("ORCA,Fare program,,,", "ORCA LIFT,Fare program,ORCA,,");
    expect(() => createAgencyResolver(colliding)).toThrow(/Alias collision: "ORCA"/);
  });
});
