import crypto from "node:crypto";

export function validateGithubSignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) {
    return false;
  }
  const digest = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expected = `sha256=${digest}`;
  const actual = Buffer.from(signature);
  const target = Buffer.from(expected);
  if (actual.length !== target.length) {
    return false;
  }
  return crypto.timingSafeEqual(actual, target);
}
