import { describe, expect, it } from "vitest";
import { hashRunManifest } from "../src/lib/runManifest.js";

describe("run manifest hashing", () => {
  it("creates deterministic hash", () => {
    const first = hashRunManifest({
      goal: "add cache",
      baseRef: "HEAD",
      baseSha: "abc",
      patchPointer: "p1",
      reproducibility: "replayable-locally"
    });

    const second = hashRunManifest({
      goal: "add cache",
      baseRef: "HEAD",
      baseSha: "abc",
      patchPointer: "p1",
      reproducibility: "replayable-locally"
    });

    expect(first).toEqual(second);
  });

  it("changes when manifest changes", () => {
    const first = hashRunManifest({
      goal: "A",
      baseRef: "HEAD",
      baseSha: "abc",
      patchPointer: "p1",
      reproducibility: "replayable-locally"
    });

    const second = hashRunManifest({
      goal: "B",
      baseRef: "HEAD",
      baseSha: "abc",
      patchPointer: "p1",
      reproducibility: "replayable-locally"
    });

    expect(first).not.toEqual(second);
  });
});
