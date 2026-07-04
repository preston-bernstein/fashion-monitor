import { describe, expect, it, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { toastApiError } from "./mutation-toast";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("toastApiError", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockReset();
  });

  it("uses the first zod issue's message when present", () => {
    const error = new ApiError(400, "invalid_input", "Invalid input", [
      { path: ["email"], message: "Enter a valid email" },
      { path: ["password"], message: "Too short" },
    ]);
    toastApiError(error);
    expect(toast.error).toHaveBeenCalledWith("Enter a valid email");
  });

  it("falls back to the error's own message when there are no issues", () => {
    const error = new ApiError(500, "server_error", "Something broke");
    toastApiError(error);
    expect(toast.error).toHaveBeenCalledWith("Something broke");
  });

  it("prefixes the message when a prefix is given", () => {
    const error = new ApiError(500, "server_error", "Something broke");
    toastApiError(error, "Save failed");
    expect(toast.error).toHaveBeenCalledWith("Save failed: Something broke");
  });
});
