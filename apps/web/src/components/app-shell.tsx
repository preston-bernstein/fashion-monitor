import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, ShirtIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, ApiError } from "@/lib/api";
import { useCan, useMe, ME_QUERY_KEY } from "@/hooks/use-auth";
import { prefetchMonitors } from "@/lib/monitors-query";
import { NAV_SECTIONS } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

function navItemActive(pathname: string, to: string, search?: Record<string, string>): boolean {
  if (to === "/") return pathname === "/";
  if (search?.tab) {
    const params = new URLSearchParams(window.location.search);
    return pathname.startsWith(to) && params.get("tab") === search.tab;
  }
  if (to === "/system" && !search) {
    const params = new URLSearchParams(window.location.search);
    return pathname.startsWith("/system") && params.get("tab") !== "secrets";
  }
  return pathname.startsWith(to);
}

export function AppShell() {
  const { data, isLoading, error } = useMe();
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const logout = useMutation({
    mutationFn: () => apiPost("/api/logout"),
    onSettled: async () => {
      await queryClient.resetQueries({ queryKey: ME_QUERY_KEY });
      navigate({ to: "/login" });
    },
  });

  // Not authenticated → bounce to the login screen.
  if (error instanceof ApiError && error.status === 401) {
    navigate({ to: "/login" });
    return null;
  }

  if (isLoading || !data) {
    return (
      <div className="min-h-dvh">
        <div className="border-b">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
            <Skeleton className="h-6 w-40" />
          </div>
        </div>
        <div className="mx-auto max-w-6xl space-y-4 p-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => can(item.cap)),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <div className="flex shrink-0 items-center gap-2 font-semibold">
            <ShirtIcon className="size-5 text-muted-foreground" />
            <span className="hidden sm:inline">Fashion Monitor</span>
          </div>
          <nav className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto text-sm">
            {visibleSections.map((section, sectionIdx) => (
              <div key={section.label} className="flex items-center gap-1">
                {sectionIdx > 0 ? (
                  <span className="mx-1 hidden h-4 w-px bg-border lg:block" aria-hidden />
                ) : null}
                <span className="hidden px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground lg:inline">
                  {section.label}
                </span>
                {section.items.map((item) => {
                  const active = navItemActive(pathname, item.to, item.search);
                  return (
                    <Link
                      key={`${item.to}-${item.label}`}
                      to={item.to}
                      search={
                        item.search
                          ? { tab: item.search.tab }
                          : item.to === "/system"
                            ? { tab: undefined }
                            : undefined
                      }
                      onMouseEnter={
                        item.to === "/monitors" && can(item.cap)
                          ? () => prefetchMonitors(queryClient)
                          : undefined
                      }
                      className={cn(
                        "whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent lg:px-3",
                        active
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
              <span>{data.user.email}</span>
              <Badge variant="outline" className="capitalize">
                {data.user.role}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                toast.info("Signing out…");
                logout.mutate();
              }}
              disabled={logout.isPending}
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
