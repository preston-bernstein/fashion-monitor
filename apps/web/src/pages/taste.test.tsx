import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TasteResponse } from "@fm/shared/dto.js";
import { useCan, useMe } from "@/hooks/use-auth";
import { TastePage } from "./taste";

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

vi.mock("@/hooks/use-auth", () => ({ useCan: vi.fn(), useMe: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

function tasteResponse(overrides: Partial<TasteResponse> = {}): TasteResponse {
  return {
    taste: {
      aesthetic_prompt: "Dark academic aesthetic.",
      hard_no: ["slim fit", "skinny jeans"],
      positive_signals: { strong: ["corduroy"], weak: ["earth tones"] },
      price_ceiling: { tops: 300, pants: 250, outerwear: 500, default: 300 },
      measurements: { typical_size: "XXL", chest_in: "50", height: "6'2\"", pants_size: "38x32" },
    },
    canWrite: true,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <TastePage />
    </QueryClientProvider>,
  );
}

describe("TastePage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
    vi.mocked(useMe).mockReturnValue({ isLoading: false } as ReturnType<typeof useMe>);
    vi.mocked(useCan).mockReturnValue(() => true);
  });

  it("prefills the form with newline-joined lists and stringified prices/measurements", async () => {
    apiGet.mockResolvedValue(tasteResponse());
    renderPage();

    expect(await screen.findByLabelText("Aesthetic prompt")).toHaveValue("Dark academic aesthetic.");
    expect(screen.getByLabelText("Hard no")).toHaveValue("slim fit\nskinny jeans");
    expect(screen.getByLabelText("Strong positive signals")).toHaveValue("corduroy");
    expect(screen.getByLabelText("Weak positive signals")).toHaveValue("earth tones");
    expect(screen.getByLabelText("Tops")).toHaveValue(300);
    expect(screen.getByLabelText("Default")).toHaveValue(300);
    expect(screen.getByLabelText("Typical size")).toHaveValue("XXL");
  });

  it("disables every field and hides the save button when canWrite is false", async () => {
    apiGet.mockResolvedValue(tasteResponse({ canWrite: false }));
    renderPage();

    expect(await screen.findByText("Read-only for your role.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save taste" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Aesthetic prompt")).toBeDisabled();
    expect(screen.getByLabelText("Tops")).toBeDisabled();
  });

  it("submits newline-separated textareas as trimmed arrays, dropping blank lines", async () => {
    apiGet.mockResolvedValue(tasteResponse());
    apiPut.mockResolvedValue({ ok: true });
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Hard no")).toHaveValue("slim fit\nskinny jeans"));
    const hardNo = screen.getByLabelText("Hard no");
    await userEvent.clear(hardNo);
    await userEvent.type(hardNo, "slim fit\n\n  skinny jeans  \n");

    await userEvent.click(screen.getByRole("button", { name: "Save taste" }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [url, body] = apiPut.mock.calls[0];
    expect(url).toBe("/api/taste");
    expect(body.hard_no).toEqual(["slim fit", "skinny jeans"]);
  });

  it("submits price fields coerced to numbers, with blank optional prices omitted", async () => {
    apiGet.mockResolvedValue(tasteResponse());
    apiPut.mockResolvedValue({ ok: true });
    renderPage();

    // useForm({ values }) re-renders (and replaces the input's DOM node) as
    // the query result settles, so a reference grabbed too early goes stale -
    // re-query inside waitFor instead of holding one from findByLabelText.
    await waitFor(() => expect(screen.getByLabelText("Outerwear")).toHaveValue(500));
    const outerwear = screen.getByLabelText("Outerwear");
    await userEvent.clear(outerwear);

    await userEvent.click(screen.getByRole("button", { name: "Save taste" }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [, body] = apiPut.mock.calls[0];
    expect(body.price_ceiling).toEqual({
      tops: 300,
      pants: 250,
      outerwear: undefined,
      default: 300,
    });
  });

  it("submits blank optional measurement fields as undefined, not empty strings", async () => {
    apiGet.mockResolvedValue(tasteResponse());
    apiPut.mockResolvedValue({ ok: true });
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Chest (in)")).toHaveValue("50"));
    const chest = screen.getByLabelText("Chest (in)");
    await userEvent.clear(chest);

    await userEvent.click(screen.getByRole("button", { name: "Save taste" }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [, body] = apiPut.mock.calls[0];
    expect(body.measurements.chest_in).toBeUndefined();
    expect(body.measurements.typical_size).toBe("XXL");
  });

  it("blocks submission when the required aesthetic prompt is cleared", async () => {
    apiGet.mockResolvedValue(tasteResponse());
    renderPage();

    await waitFor(() =>
      expect(screen.getByLabelText("Aesthetic prompt")).toHaveValue("Dark academic aesthetic."),
    );
    const prompt = screen.getByLabelText("Aesthetic prompt");
    await userEvent.clear(prompt);
    await userEvent.click(screen.getByRole("button", { name: "Save taste" }));

    expect(await screen.findByText("Aesthetic prompt is required")).toBeInTheDocument();
    expect(apiPut).not.toHaveBeenCalled();
  });

  it("shows a forbidden card instead of the form when the user lacks taste:read", async () => {
    vi.mocked(useCan).mockReturnValue(() => false);
    vi.mocked(useMe).mockReturnValue({
      isLoading: false,
      data: { user: { role: "viewer" } },
    } as unknown as ReturnType<typeof useMe>);

    renderPage();

    expect(await screen.findByText("Not allowed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Aesthetic prompt")).not.toBeInTheDocument();
  });
});
