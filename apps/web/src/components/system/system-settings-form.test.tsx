import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SystemResponse } from "@fm/shared/dto.js";
import { SystemSettingsForm } from "./system-settings-form";

const apiGet = vi.fn();
const apiPut = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPut: (...args: unknown[]) => apiPut(...args),
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function systemResponse(overrides: Partial<SystemResponse> = {}): SystemResponse {
  return {
    system: {
      platforms: { ebay: true, grailed: false },
      llm: {
        provider: "ollama",
        batch_size: 15,
        ollama_host: "",
        ollama_text_model: "qwen2.5:7b",
        ollama_vision_model: "",
        claude_model: "claude-haiku-4-5",
        vision_backend: "ollama",
      },
      alert_options: { mode: "immediate", notify_empty: false },
      scraper: { poshmark_profile_path: "data/poshmark-profile" },
    },
    options: {
      platforms: ["ebay", "grailed"],
      providers: ["ollama", "claude", "hybrid", "mock"],
      visionBackends: ["ollama", "claude"],
      alertModes: ["immediate", "digest"],
    },
    canWrite: true,
    ...overrides,
  };
}

function renderForm() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <SystemSettingsForm />
    </QueryClientProvider>,
  );
}

describe("SystemSettingsForm", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
  });

  it("renders platform checkboxes reflecting the current config", async () => {
    apiGet.mockResolvedValue(systemResponse());
    renderForm();

    expect(await screen.findByLabelText("ebay")).toBeChecked();
    expect(screen.getByLabelText("grailed")).not.toBeChecked();
  });

  it("shows the save button and enabled fields when canWrite is true", async () => {
    apiGet.mockResolvedValue(systemResponse({ canWrite: true }));
    renderForm();

    expect(await screen.findByRole("button", { name: "Save system" })).toBeEnabled();
    expect(screen.getByLabelText("ebay")).not.toBeDisabled();
  });

  it("disables every field and hides the save button when canWrite is false", async () => {
    apiGet.mockResolvedValue(systemResponse({ canWrite: false }));
    renderForm();

    expect(await screen.findByText("Read-only for your role.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save system" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("ebay")).toBeDisabled();
    expect(screen.getByLabelText("Ollama text model")).toBeDisabled();
  });

  it("submits the form via apiPut with numbers coerced and blank optional fields omitted", async () => {
    apiGet.mockResolvedValue(systemResponse());
    apiPut.mockResolvedValue({ ok: true });
    renderForm();

    await screen.findByLabelText("ebay");
    await userEvent.click(screen.getByRole("button", { name: "Save system" }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [url, body] = apiPut.mock.calls[0];
    expect(url).toBe("/api/system");
    expect(body).toMatchObject({
      platforms: { ebay: true, grailed: false },
      llm: {
        provider: "ollama",
        batch_size: 15,
        ollama_host: undefined,
        ollama_text_model: "qwen2.5:7b",
        ollama_vision_model: undefined,
        claude_model: "claude-haiku-4-5",
        vision_backend: "ollama",
      },
      alert_options: { mode: "immediate", notify_empty: false },
      scraper: { poshmark_profile_path: "data/poshmark-profile" },
    });
  });

  it("does not submit when batch size is out of range", async () => {
    // The <input type="number" min={1} max={30}> has no explicit step, so
    // the browser's own HTML5 constraint validation blocks the submit event
    // before it ever reaches react-hook-form/zod - the app's "1–30" message
    // is unreachable in a real browser for this field. What's actually
    // testable (and what matters) is that submission doesn't happen.
    apiGet.mockResolvedValue(systemResponse());
    renderForm();

    const batchSize = await screen.findByLabelText("Batch size");
    await userEvent.clear(batchSize);
    await userEvent.type(batchSize, "99");
    await userEvent.click(screen.getByRole("button", { name: "Save system" }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(apiPut).not.toHaveBeenCalled();
  });

  it("toggling a platform checkbox changes what gets submitted", async () => {
    apiGet.mockResolvedValue(systemResponse());
    apiPut.mockResolvedValue({ ok: true });
    renderForm();

    await userEvent.click(await screen.findByLabelText("grailed"));
    await userEvent.click(screen.getByRole("button", { name: "Save system" }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [, body] = apiPut.mock.calls[0];
    expect(body.platforms).toEqual({ ebay: true, grailed: true });
  });

  it("changing the provider select updates what gets submitted", async () => {
    apiGet.mockResolvedValue(systemResponse());
    apiPut.mockResolvedValue({ ok: true });
    renderForm();

    await screen.findByLabelText("ebay");
    const providerTrigger = screen.getAllByRole("combobox")[0];
    await userEvent.click(providerTrigger);
    await userEvent.click(await screen.findByRole("option", { name: "claude" }));

    await userEvent.click(screen.getByRole("button", { name: "Save system" }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [, body] = apiPut.mock.calls[0];
    expect(body.llm.provider).toBe("claude");
  });
});
