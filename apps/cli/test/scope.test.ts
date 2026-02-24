import { describe, expect, it } from "vitest";
import { filesFromDiff, isWithinScope } from "../src/lib/scope.js";

describe("scope enforcement", () => {
  it("extracts files from diff", () => {
    const diff = ["+++ b/apps/api/src/index.ts", "+++ b/apps/web/app/page.tsx"].join("\n");
    expect(filesFromDiff(diff)).toEqual(["apps/api/src/index.ts", "apps/web/app/page.tsx"]);
  });

  it("checks scope hints", () => {
    expect(isWithinScope(["apps/api/src/index.ts"], ["apps/api/"])).toBe(true);
    expect(isWithinScope(["apps/web/app/page.tsx"], ["apps/api/"])).toBe(false);
  });
});
