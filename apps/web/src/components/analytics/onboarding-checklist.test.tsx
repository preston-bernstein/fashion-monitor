import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ConnectionsResponse,
  MonitorsResponse,
  OnboardingResponse,
  TasteResponse,
} from "@fm/shared/dto.js";
import { apiGet } from "@/lib/api";
import { useCan } from "@/hooks/use-auth";
import { OnboardingChecklist } from "./onboarding-checklist";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});

vi.mock("@/hooks/use-auth", () => ({
  useCan: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

function mockGet(overrides: {
  dismissed?: boolean;
  aestheticPrompt?: string;
  monitorCount?: number;
  ntfyStatus?: ConnectionsResponse["connections"][number]["status"];
} = {}) {
  const {
    dismissed = false,
    aestheticPrompt = "",
    monitorCount = 0,
    ntfyStatus = "not_connected",
  } = overrides;

  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === "/api/onboarding") return { dismissed } satisfies OnboardingResponse;
    if (path === "/api/taste") {
      return {
        taste: {
          aesthetic_prompt: aestheticPrompt,
          hard_no: [],
          positive_signals: { strong: [], weak: [] },
          price_ceiling: { default: 0 },
          measurements: {},
        },
        canWrite: true,
      } satisfies TasteResponse;
    }
    if (path === "/api/monitors") {
      return {
        groups: Array.from({ length: monitorCount }, (_, i) => ({ id: `${i}` })),
        platforms: [],
        statuses: [],
        canWrite: true,
      } as unknown as MonitorsResponse;
    }
    if (path === "/api/connections") {
      return {
        connections: [
          {
            platform: "ntfy",
            label: "ntfy",
            type: "api-key",
            dormant: false,
            automatic: false,
            configured: true,
            status: ntfyStatus,
            lastTestedAt: null,
            lastError: null,
          },
        ],
      } satisfies ConnectionsResponse;
    }
    throw new Error(`unexpected path ${path}`);
  });
}

function renderChecklist() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OnboardingChecklist />
    </QueryClientProvider>,
  );
}

describe("OnboardingChecklist", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows all steps as incomplete for a brand-new profile", async () => {
    vi.mocked(useCan).mockReturnValue(() => true);
    mockGet();
    renderChecklist();

    expect(await screen.findByText("Set your Taste")).toBeInTheDocument();
    expect(screen.getByText("Add your first Monitor")).toBeInTheDocument();
    expect(screen.getByText("Connect ntfy and test it")).toBeInTheDocument();
  });

  it("hides the ntfy step for a role without secrets:read", async () => {
    vi.mocked(useCan).mockReturnValue((cap: string) => cap !== "secrets:read");
    mockGet();
    renderChecklist();

    expect(await screen.findByText("Set your Taste")).toBeInTheDocument();
    expect(screen.queryByText("Connect ntfy and test it")).not.toBeInTheDocument();
    expect(screen.getByText(/ask an owner or admin/i)).toBeInTheDocument();
  });

  it("hides the whole card once every step is done", async () => {
    vi.mocked(useCan).mockReturnValue(() => true);
    mockGet({ aestheticPrompt: "grunge minimalist", monitorCount: 1, ntfyStatus: "ok" });
    renderChecklist();

    await waitFor(() => {
      expect(screen.queryByText("Get started")).not.toBeInTheDocument();
    });
  });

  it("hides the card once dismissed even if steps are incomplete", async () => {
    vi.mocked(useCan).mockReturnValue(() => true);
    mockGet({ dismissed: true });
    renderChecklist();

    await waitFor(() => {
      expect(screen.queryByText("Get started")).not.toBeInTheDocument();
    });
  });
});
