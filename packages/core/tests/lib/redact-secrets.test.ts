import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/lib/logging.js";

describe("redactSecrets", () => {
  it("redacts sensitive key names at any depth", () => {
    const input = {
      email: "user@example.com",
      password: "secret-pass",
      nested: {
        api_key: "key-123",
        token: "tok",
        count: 3,
      },
      items: [{ session_cookie: "abc", id: 1 }],
    };
    const out = redactSecrets(input);
    expect(out.email).toBe("user@example.com");
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.api_key).toBe("[REDACTED]");
    expect(out.nested.token).toBe("[REDACTED]");
    expect(out.nested.count).toBe(3);
    expect(out.items[0].session_cookie).toBe("[REDACTED]");
    expect(out.items[0].id).toBe(1);
  });

  it("leaves primitives unchanged", () => {
    expect(redactSecrets("plain")).toBe("plain");
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
  });
});
