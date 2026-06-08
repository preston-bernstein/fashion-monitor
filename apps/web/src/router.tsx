import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { LoginPage } from "@/pages/login";
import { AnalyticsPage } from "@/pages/analytics";
import { MonitorsPage } from "@/pages/monitors";
import { TastePage } from "@/pages/taste";
import { SystemPage } from "@/pages/system";
import { UsersPage } from "@/pages/users";
import { AuditPage } from "@/pages/audit";
import { QueryPerformancePage } from "@/pages/query-performance";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

// Pathless layout route: authenticated app shell wrapping every screen.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppShell,
});

const analyticsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  component: AnalyticsPage,
});

const monitorsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/monitors",
  validateSearch: (search: Record<string, unknown>): { edit: string | undefined } => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
  component: MonitorsPage,
});

const tasteRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/taste",
  component: TastePage,
});

const systemRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/system",
  validateSearch: (search: Record<string, unknown>): { tab: string | undefined } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: SystemPage,
});

const operationsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/operations",
  beforeLoad: () => {
    throw redirect({ to: "/system", search: { tab: undefined } });
  },
});

const auditRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/audit",
  component: AuditPage,
});

const queryPerformanceRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/query-performance",
  validateSearch: (search: Record<string, unknown>): { query: string | undefined } => ({
    query: typeof search.query === "string" ? search.query : undefined,
  }),
  component: QueryPerformancePage,
});

const usersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/users",
  component: UsersPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
    analyticsRoute,
    monitorsRoute,
    tasteRoute,
    systemRoute,
    operationsRoute,
    auditRoute,
    queryPerformanceRoute,
    usersRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
