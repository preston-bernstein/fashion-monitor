import { describe, expect, it } from "vitest";
import {
  SidecarError,
  SidecarResponseError,
  SidecarUnreachableError,
} from "../../../src/platforms/stealth-sidecar/errors.js";

describe("SidecarError", () => {
  it("sets name and message on the base class", () => {
    const err = new SidecarError("base failure", "unreachable");
    expect(err.name).toBe("SidecarError");
    expect(err.message).toBe("base failure");
    expect(err.type).toBe("unreachable");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("SidecarUnreachableError", () => {
  it("sets its own name, the 'unreachable' type discriminator, and message", () => {
    const err = new SidecarUnreachableError("connection refused");
    expect(err.name).toBe("SidecarUnreachableError");
    expect(err.type).toBe("unreachable");
    expect(err.message).toBe("connection refused");
    expect(err).toBeInstanceOf(SidecarError);
  });

  it("carries the underlying rejection as cause when one is provided", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new SidecarUnreachableError("connection refused", cause);
    expect(err.cause).toBe(cause);
  });

  it("leaves cause undefined when none is provided", () => {
    const err = new SidecarUnreachableError("connection refused");
    expect(err.cause).toBeUndefined();
  });
});

describe("SidecarResponseError", () => {
  it("sets its own name, the 'response' type discriminator, status, errorType, and message", () => {
    const err = new SidecarResponseError(404, "not_found", "context not found");
    expect(err.name).toBe("SidecarResponseError");
    expect(err.type).toBe("response");
    expect(err.status).toBe(404);
    expect(err.errorType).toBe("not_found");
    expect(err.message).toBe("context not found");
    expect(err).toBeInstanceOf(SidecarError);
  });
});
