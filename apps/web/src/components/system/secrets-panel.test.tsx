import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SecretsResponse } from "@fm/shared/dto.js";
import { SecretsPanel } from "./secrets-panel";

const apiGet = vi.fn();
const apiPut = vi.fn();
const apiPost = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPut: (...args: unknown[]) => apiPut(...args),
    apiPost: (...args: unknown[]) => apiPost(...args),
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function secretsResponse(overrides: Partial<SecretsResponse> = {}): SecretsResponse {
  return {
    storeEnabled: true,
    secrets: [],
    knownSecrets: ["ntfy_token", "anthropic_api_key"],
    uptime: [],
    failures: [],
    runRequestedAt: null,
    canWrite: true,
    canTrigger: true,
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <SecretsPanel />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("SecretsPanel", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
    apiPost.mockReset();
  });

  it("shows the disabled message and no form when the secret store is disabled", async () => {
    apiGet.mockResolvedValue(secretsResponse({ storeEnabled: false }));
    renderPanel();

    expect(await screen.findByText(/secret store is disabled/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Key")).not.toBeInTheDocument();
  });

  it("shows an empty-state message when there are no secrets yet", async () => {
    apiGet.mockResolvedValue(secretsResponse({ secrets: [] }));
    renderPanel();

    expect(await screen.findByText("No secrets stored yet.")).toBeInTheDocument();
  });

  it("lists existing secret keys without exposing values", async () => {
    apiGet.mockResolvedValue(
      secretsResponse({
        secrets: [{ key: "ntfy_token", updated_at: "2026-01-01T00:00:00.000Z" }],
      }),
    );
    renderPanel();

    expect(await screen.findByText("ntfy_token")).toBeInTheDocument();
  });

  it("hides the add-secret form when the caller can't write", async () => {
    apiGet.mockResolvedValue(secretsResponse({ canWrite: false }));
    renderPanel();

    await screen.findByText("Secrets");
    expect(screen.queryByLabelText("Key")).not.toBeInTheDocument();
  });

  it("submits a new secret via apiPut and resets the form on success", async () => {
    apiGet.mockResolvedValue(secretsResponse());
    apiPut.mockResolvedValue({ ok: true });
    renderPanel();

    await userEvent.type(await screen.findByLabelText("Key"), "ntfy_token");
    await userEvent.type(screen.getByLabelText("Value"), "super-secret-value");
    await userEvent.click(screen.getByRole("button", { name: "Save secret" }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith("/api/secrets", {
      key: "ntfy_token",
      value: "super-secret-value",
    }));
  });

  it("hides the trigger-run card when the caller can't trigger", async () => {
    apiGet.mockResolvedValue(secretsResponse({ canTrigger: false }));
    renderPanel();

    await screen.findByText("Secrets");
    expect(screen.queryByRole("button", { name: "Request pipeline run" })).not.toBeInTheDocument();
  });

  it("requests a pipeline run via apiPost when the trigger button is clicked", async () => {
    apiGet.mockResolvedValue(secretsResponse());
    apiPost.mockResolvedValue({ ok: true });
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "Request pipeline run" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/api/pipeline/trigger"));
  });

  it("shows when the run was last requested", async () => {
    apiGet.mockResolvedValue(secretsResponse({ runRequestedAt: "2026-01-01T12:00:00.000Z" }));
    renderPanel();

    expect(await screen.findByText(/last requested/i)).toBeInTheDocument();
  });
});
