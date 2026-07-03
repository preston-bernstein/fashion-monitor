import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useCan, useMe } from "@/hooks/use-auth";
import { PageHeader, LoadingPage, RequireCapability } from "./common";

vi.mock("@/hooks/use-auth", () => ({
  useCan: vi.fn(),
  useMe: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

describe("PageHeader", () => {
  it("renders the title and optional description", () => {
    render(<PageHeader title="Monitors" description="Your saved searches." />);
    expect(screen.getByRole("heading", { name: "Monitors" })).toBeInTheDocument();
    expect(screen.getByText("Your saved searches.")).toBeInTheDocument();
  });

  it("omits the description when none is given", () => {
    render(<PageHeader title="Monitors" />);
    expect(screen.getByRole("heading", { name: "Monitors" })).toBeInTheDocument();
  });

  it("renders action elements when provided", () => {
    render(<PageHeader title="Monitors" actions={<button>Add</button>} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});

describe("LoadingPage", () => {
  it("renders without throwing", () => {
    const { container } = render(<LoadingPage />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe("RequireCapability", () => {
  it("renders children when the user has the capability", () => {
    vi.mocked(useMe).mockReturnValue({ isLoading: false } as ReturnType<typeof useMe>);
    vi.mocked(useCan).mockReturnValue(() => true);

    render(
      <RequireCapability capability="monitors:read">
        <div>Protected content</div>
      </RequireCapability>,
    );
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("shows a forbidden card naming the missing capability when the user lacks it", () => {
    vi.mocked(useMe).mockReturnValue({
      isLoading: false,
      data: { user: { role: "viewer" } },
    } as unknown as ReturnType<typeof useMe>);
    vi.mocked(useCan).mockReturnValue(() => false);

    render(
      <RequireCapability capability="monitors:write">
        <div>Protected content</div>
      </RequireCapability>,
    );
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.getByText("Not allowed")).toBeInTheDocument();
    expect(screen.getByText("monitors:write")).toBeInTheDocument();
  });

  it("shows a loading page instead of gating while the auth check is in flight", () => {
    vi.mocked(useMe).mockReturnValue({ isLoading: true } as ReturnType<typeof useMe>);
    vi.mocked(useCan).mockReturnValue(() => false);

    render(
      <RequireCapability capability="monitors:write">
        <div>Protected content</div>
      </RequireCapability>,
    );
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.queryByText("Not allowed")).not.toBeInTheDocument();
  });
});
