import { expect, it } from "vitest";
import {
  canonicalJson,
  validateIdempotencyKey,
} from "@narada/core/idempotency";
it("canonicalizes object keys recursively without collapsing array order or value types", () => {
  expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: null })).toBe(
    canonicalJson({ a: null, z: [{ a: 1, b: 2 }] }),
  );
  expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  expect(canonicalJson({ a: "1" })).not.toBe(canonicalJson({ a: 1 }));
  expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
});
it("bounds idempotency keys and rejects whitespace/control/unicode keys", () => {
  expect(() => validateIdempotencyKey("a".repeat(128))).not.toThrow();
  for (const value of ["", "a".repeat(129), "a b", "a\nb", "☃"])
    expect(() => validateIdempotencyKey(value)).toThrow();
});
