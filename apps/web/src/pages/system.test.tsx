import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCan, useMe } from "@/hooks/use-auth";
import { SystemPage } from "./system";

const useSearch = vi.fn();
const navigate = vi.fn();

vi.mock("@/hooks/use-auth", () => ({ useCan: vi.fn(), useMe: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => useSearch() }),
  useNavigate: () => navigate,
}));

vi.mock("@/components/system/system-settings-form", () => ({
  SystemSettingsForm: () => <div data-testid="system-settings-form" />,
}));

vi.mock("@/components/system/secrets-panel", () => ({
  SecretsPanel: () => <div data-testid="secrets-panel" />,
}));

function mockCan(...extraCaps: string[]) {
  const granted = new Set(["system:read", ...extraCaps]);
  vi.mocked(useCan).mockReturnValue((cap: string) => granted.has(cap));
}

describe("SystemPage", () => {
  beforeEach(() => {
    useSearch.mockReturnValue({ tab: undefined });
    navigate.mockReset();
    vi.mocked(useMe).mockReturnValue({ isLoading: false } as ReturnType<typeof useMe>);
  });

  it("hides the Secrets tab entirely without secrets:read", () => {
    mockCan();
    render(<SystemPage />);

    expect(screen.getByTestId("system-settings-form")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /secrets/i })).not.toBeInTheDocument();
  });

  it("defaults to the Integrations tab even with secrets:read, when there's no ?tab=secrets", () => {
    mockCan("secrets:read");
    render(<SystemPage />);

    expect(screen.getByTestId("system-settings-form")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /secrets/i })).toBeInTheDocument();
  });

  it("shows the Secrets tab as active when ?tab=secrets and the user has secrets:read", () => {
    mockCan("secrets:read");
    useSearch.mockReturnValue({ tab: "secrets" });
    render(<SystemPage />);

    expect(screen.getByTestId("secrets-panel")).toBeInTheDocument();
  });

  it("falls back to Integrations for ?tab=secrets when the user lacks secrets:read", () => {
    mockCan();
    useSearch.mockReturnValue({ tab: "secrets" });
    render(<SystemPage />);

    expect(screen.getByTestId("system-settings-form")).toBeInTheDocument();
  });

  it("clicking the Secrets tab navigates with ?tab=secrets", async () => {
    mockCan("secrets:read");
    render(<SystemPage />);

    await userEvent.click(screen.getByRole("tab", { name: /secrets/i }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/system",
      search: { tab: "secrets" },
      replace: true,
    });
  });

  it("clicking the Integrations tab navigates with tab cleared", async () => {
    mockCan("secrets:read");
    useSearch.mockReturnValue({ tab: "secrets" });
    render(<SystemPage />);

    await userEvent.click(screen.getByRole("tab", { name: /integrations/i }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/system",
      search: { tab: undefined },
      replace: true,
    });
  });
});
