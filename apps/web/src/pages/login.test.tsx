import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Me } from "@fm/shared/dto.js";
import { useMe } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { LoginPage } from "./login";

const apiPost = vi.fn();
const navigate = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiPost: (...args: unknown[]) => apiPost(...args) };
});

vi.mock("@/hooks/use-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-auth")>();
  return { ...actual, useMe: vi.fn() };
});

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

function meResponse(overrides: Partial<Me> = {}): Me {
  return { user: { id: 1, email: "owner@example.com", role: "owner" }, capabilities: [], ...overrides };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("LoginPage", () => {
  beforeEach(() => {
    apiPost.mockReset();
    navigate.mockReset();
  });

  it("shows the form when the user is not already signed in", () => {
    vi.mocked(useMe).mockReturnValue({ data: undefined } as ReturnType<typeof useMe>);
    renderPage();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects an already-signed-in user to their role's landing page", () => {
    vi.mocked(useMe).mockReturnValue({ data: meResponse({ user: { id: 1, email: "x", role: "operator" } }) } as ReturnType<typeof useMe>);
    renderPage();

    expect(navigate).toHaveBeenCalledWith({ to: "/system" });
  });

  it("does not submit for a malformed email", async () => {
    // <input type="email"> applies the browser's own native email-format
    // constraint validation, which blocks the submit event before it ever
    // reaches react-hook-form/zod - same as system-settings-form's
    // batch_size min/max. The zod "Enter a valid email" message is
    // unreachable in a real browser for this field; what's testable (and
    // what matters) is that submission doesn't happen.
    vi.mocked(useMe).mockReturnValue({ data: undefined } as ReturnType<typeof useMe>);
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("requires a password", async () => {
    vi.mocked(useMe).mockReturnValue({ data: undefined } as ReturnType<typeof useMe>);
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Password is required")).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("on success, caches the user and navigates to their role's landing page", async () => {
    vi.mocked(useMe).mockReturnValue({ data: undefined } as ReturnType<typeof useMe>);
    apiPost.mockResolvedValue(meResponse({ user: { id: 1, email: "owner@example.com", role: "curator" } }));
    const queryClient = renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/monitors" }));
    expect(queryClient.getQueryData(["me"])).toMatchObject({ user: { role: "curator" } });
  });

  it("shows 'Invalid email or password' on a 401, not the raw API message", async () => {
    vi.mocked(useMe).mockReturnValue({ data: undefined } as ReturnType<typeof useMe>);
    apiPost.mockRejectedValue(new ApiError(401, "unauthorized", "some internal detail"));
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
  });

  it("shows the API's own message for a non-401 error", async () => {
    vi.mocked(useMe).mockReturnValue({ data: undefined } as ReturnType<typeof useMe>);
    apiPost.mockRejectedValue(new ApiError(500, "server_error", "Something went wrong"));
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });
});
