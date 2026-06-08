import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ApiError } from "@/lib/api";
import { router } from "@/router";
import { Toaster } from "@/components/ui/sonner";
import "@/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 means "log in", not "retry"; other errors retry once.
      retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  </StrictMode>,
);
