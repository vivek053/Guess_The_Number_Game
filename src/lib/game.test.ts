import { describe, it, expect } from "vitest";
import { clueFor, parseNumber, isRoomCode } from "./game";

describe("clue rule", () => {
  it("says higher when guess is below the secret (25 vs 70)", () => expect(clueFor(25, 70)).toBe("higher"));
  it("says lower when guess is above the secret", () => expect(clueFor(80, 50)).toBe("lower"));
  it("says correct on exact match", () => expect(clueFor(50, 50)).toBe("correct"));
});

describe("input validation", () => {
  it("accepts 1 and 100", () => { expect(parseNumber("1")).toBe(1); expect(parseNumber("100")).toBe(100); });
  it("rejects 0, 101, decimals and text", () => {
    for (const v of ["0", "101", "4.5", "abc", "-3", ""]) expect(parseNumber(v)).toBeNull();
  });
  it("room codes are exactly six digits", () => {
    expect(isRoomCode("123456")).toBe(true);
    expect(isRoomCode("12345")).toBe(false);
    expect(isRoomCode("12a456")).toBe(false);
  });
});
