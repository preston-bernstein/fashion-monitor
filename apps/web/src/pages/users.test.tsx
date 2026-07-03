import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UsersResponse } from "@fm/shared/dto.js";
import { useCan, useMe } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { UsersPage } from "./users";

const apiGet = vi.fn();
const apiPatch = vi.fn();
const apiPost = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPatch: (...args: unknown[]) => apiPatch(...args),
    apiPost: (...args: unknown[]) => apiPost(...args),
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@/hooks/use-auth", () => ({ useCan: vi.fn(), useMe: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "curator", label: "Curator" },
  { value: "operator", label: "Operator" },
  { value: "viewer", label: "Viewer" },
] as UsersResponse["roles"];

function usersResponse(overrides: Partial<UsersResponse> = {}): UsersResponse {
  return {
    users: [{ id: 1, email: "owner@example.com", status: "active", role: "owner" }],
    roles: ROLES,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <UsersPage />
    </QueryClientProvider>,
  );
}

describe("UsersPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPost.mockReset();
    vi.mocked(useMe).mockReturnValue({ isLoading: false } as ReturnType<typeof useMe>);
    vi.mocked(useCan).mockReturnValue(() => true);
  });

  it("renders a row per user with email and status", async () => {
    apiGet.mockResolvedValue(
      usersResponse({
        users: [
          { id: 1, email: "owner@example.com", status: "active", role: "owner" },
          { id: 2, email: "disabled@example.com", status: "disabled", role: "viewer" },
        ],
      }),
    );
    renderPage();

    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("disabled@example.com")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("the status button reads 'Disable' for an active user and 'Enable' for a disabled one", async () => {
    apiGet.mockResolvedValue(
      usersResponse({
        users: [
          { id: 1, email: "owner@example.com", status: "active", role: "owner" },
          { id: 2, email: "disabled@example.com", status: "disabled", role: "viewer" },
        ],
      }),
    );
    renderPage();

    await screen.findByText("owner@example.com");
    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("clicking the status button flips status via apiPatch", async () => {
    apiGet.mockResolvedValue(usersResponse());
    apiPatch.mockResolvedValue({ ok: true });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Disable" }));

    expect(apiPatch).toHaveBeenCalledWith("/api/users/1/status", { status: "disabled" });
  });

  it("changing the role select calls apiPatch with the new role", async () => {
    apiGet.mockResolvedValue(usersResponse());
    apiPatch.mockResolvedValue({ ok: true });
    renderPage();

    await screen.findByText("owner@example.com");
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Curator" }));

    expect(apiPatch).toHaveBeenCalledWith("/api/users/1/role", { role: "curator" });
  });

  it("opening 'Add user' shows the create-user dialog", async () => {
    apiGet.mockResolvedValue(usersResponse());
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add user/i }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("rejects a password under 8 characters and does not submit", async () => {
    apiGet.mockResolvedValue(usersResponse());
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add user/i }));
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(await screen.findByText("At least 8 characters")).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("submits a valid new user and closes the dialog on success", async () => {
    apiGet.mockResolvedValue(usersResponse());
    apiPost.mockResolvedValue({ user: { id: 2, email: "new@example.com" } });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add user/i }));
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "longenoughpassword");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/users", {
        email: "new@example.com",
        password: "longenoughpassword",
        role: "viewer",
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Email")).not.toBeInTheDocument());
  });

  it("a duplicate-email error lands on the email field, not a toast", async () => {
    apiGet.mockResolvedValue(usersResponse());
    apiPost.mockRejectedValue(new ApiError(409, "duplicate", "That email is already registered"));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add user/i }));
    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "longenoughpassword");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(await screen.findByText("That email is already registered")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("cancel closes the dialog without submitting", async () => {
    apiGet.mockResolvedValue(usersResponse());
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add user/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByLabelText("Email")).not.toBeInTheDocument());
    expect(apiPost).not.toHaveBeenCalled();
  });
});
