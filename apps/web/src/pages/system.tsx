import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useCan } from "@/hooks/use-auth";
import { PageHeader, RequireCapability } from "@/components/common";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SystemSettingsForm } from "@/components/system/system-settings-form";
import { SecretsPanel } from "@/components/system/secrets-panel";

export function SystemPage() {
  return (
    <RequireCapability capability="system:read">
      <SystemPageContent />
    </RequireCapability>
  );
}

function SystemPageContent() {
  const can = useCan();
  const navigate = useNavigate();
  const showSecrets = can("secrets:read");
  const search = Route.useSearch();
  const activeTab = search.tab === "secrets" && showSecrets ? "secrets" : "settings";

  return (
    <>
      <PageHeader
        title="System"
        description="LLM provider, alert delivery, platform toggles, and encrypted secrets."
      />
      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          navigate({
            to: "/system",
            search: { tab: tab === "secrets" ? "secrets" : undefined },
            replace: true,
          });
        }}
      >
        <TabsList>
          <TabsTrigger value="settings">Integrations</TabsTrigger>
          {showSecrets ? <TabsTrigger value="secrets">Secrets &amp; health</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="settings">
          <SystemSettingsForm />
        </TabsContent>
        {showSecrets ? (
          <TabsContent value="secrets">
            <SecretsPanel />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}

const Route = getRouteApi("/app/system");
