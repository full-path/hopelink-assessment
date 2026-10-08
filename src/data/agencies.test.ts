import { describe, expect, it } from "vitest";
import { createAgencyResolver, parseAgencyRoster } from "./agencies";

const HEADER = "Agency,Kind,Aliases,Note";

describe("parseAgencyRoster", () => {
  it("derives the id from the display name and makes the name an alias of itself", () => {
    expect(parseAgencyRoster([HEADER, "Hyde Shuttle,Ride provider,,"].join("\n"))).toEqual([
      {
        id: "hyde-shuttle",
        displayName: "Hyde Shuttle",
        kind: "ride_provider",
        aliases: ["Hyde Shuttle"],
      },
    ]);
  });

  it("splits aliases on semicolons, so an alias may itself contain a comma", () => {
    const [agency] = parseAgencyRoster(
      [HEADER, 'Sound Generations VTS,Ride provider,"SG VTS; Sound Generations, VTS",'].join("\n"),
    );
    expect(agency?.aliases).toEqual(["Sound Generations VTS", "SG VTS", "Sound Generations, VTS"]);
  });

  it("accepts each kind in sheet wording or contract wording, in any case", () => {
    const roster = parseAgencyRoster(
      [HEADER, "A,Ride provider,,", "B,fare program,,", "C,TRAVEL_TRAINING,,"].join("\n"),
    );
    expect(roster.map((agency) => agency.kind)).toEqual([
      "ride_provider",
      "fare_program",
      "travel_training",
    ]);
  });

  it("rejects an unknown kind rather than guessing one", () => {
    expect(() => parseAgencyRoster([HEADER, "A,Shuttle,,"].join("\n"))).toThrow(
      /Agency "A" has Kind "Shuttle"/,
    );
  });

  it("skips blank rows", () => {
    expect(parseAgencyRoster([HEADER, ",,,", "A,Ride provider,,"].join("\n"))).toHaveLength(1);
  });

  it("rejects two rows that would share an id", () => {
    expect(() =>
      parseAgencyRoster(
        [HEADER, "Zip Shuttle,Ride provider,,", "ZIP shuttle,Ride provider,,"].join("\n"),
      ),
    ).toThrow(/two rows that produce the id "zip-shuttle"/);
  });

  it("rejects a roster missing a required column", () => {
    expect(() => parseAgencyRoster("Agency,Aliases\nA,")).toThrow(
      /missing expected column.*"Kind"/,
    );
  });

  it("rejects a roster with no agencies", () => {
    expect(() => parseAgencyRoster(HEADER)).toThrow(/no agencies/);
  });
});

describe("createAgencyResolver", () => {
  const roster = parseAgencyRoster(
    [HEADER, "Beyond the Borders,Ride provider,Beyond the borders,", "ORCA,Fare program,,"].join(
      "\n",
    ),
  );
  const resolve = createAgencyResolver(roster);

  it("matches any alias case-insensitively, after normalizing whitespace", () => {
    expect(resolve("beyond THE   borders ")).toBe("beyond-the-borders");
  });

  it("names the roster in its error, since that is where the fix goes", () => {
    expect(() => resolve("Some New Agency")).toThrow(/Unrecognized agency name.*agency roster/);
  });

  it("rejects an alias claimed by two agencies", () => {
    const colliding = parseAgencyRoster(
      [HEADER, "ORCA,Fare program,,", "ORCA LIFT,Fare program,ORCA,"].join("\n"),
    );
    expect(() => createAgencyResolver(colliding)).toThrow(/Alias collision: "ORCA"/);
  });
});
