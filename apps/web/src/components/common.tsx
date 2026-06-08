import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import type { Capability } from "@fm/shared/dto.js";
import { useCan, useMe } from "@/hooks/use-auth";
import { homePathForRole } from "@/lib/landing";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function ForbiddenCard({ capability }: { capability?: Capability }) {
  const { data } = useMe();
  const home = data ? homePathForRole(data.user.role) : "/";

  return (
    <Card className="mx-auto mt-12 max-w-md">
      <CardHeader className="items-center text-center">
        <ShieldAlert className="size-8 text-muted-foreground" />
        <CardTitle>Not allowed</CardTitle>
        <CardDescription>
          {capability ? (
            <>
              You lack the <code className="font-mono">{capability}</code> capability.
            </>
          ) : (
            "Your role does not grant access to this page."
          )}{" "}
          <Link to={home} className="underline">
            Back to home
          </Link>
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

export function LoadingPage() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * Page-level capability gate. The server is the source of truth; this only
 * prevents rendering a screen the user can't read (and shows a clear message).
 */
export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const { isLoading } = useMe();
  const can = useCan();
  if (isLoading) return <LoadingPage />;
  if (!can(capability)) return <ForbiddenCard capability={capability} />;
  return <>{children}</>;
}
