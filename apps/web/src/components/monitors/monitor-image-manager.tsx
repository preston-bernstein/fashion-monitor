import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { SearchGroupImageDto, SearchGroupImagesResponse } from "@fm/shared/dto.js";
import { apiPost, apiDelete, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/mutation-toast";
import { monitorImagesQueryKey } from "@/lib/monitor-images-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LazyImage } from "@/components/common/lazy-image";

export function MonitorImageManager({
  groupId,
  gallery,
}: {
  groupId: string;
  gallery: SearchGroupImagesResponse;
}) {
  const queryClient = useQueryClient();
  const [urlInput, setUrlInput] = useState("");
  const queryKey = monitorImagesQueryKey(groupId);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const addFromListing = useMutation({
    mutationFn: (candidate: { platform: string; listing_id: string }) =>
      apiPost(`/api/monitors/${encodeURIComponent(groupId)}/images`, {
        source: "listing",
        platform: candidate.platform,
        listing_id: candidate.listing_id,
      }),
    onSuccess: () => {
      toast.success("Added to gallery");
      invalidate();
    },
    onError: (e: ApiError) => toastApiError(e, "Add image"),
  });

  const addFromUrl = useMutation({
    mutationFn: (url: string) =>
      apiPost(`/api/monitors/${encodeURIComponent(groupId)}/images`, { source: "url", url }),
    onSuccess: () => {
      toast.success("Added to gallery");
      setUrlInput("");
      invalidate();
    },
    onError: (e: ApiError) => toastApiError(e, "Add image"),
  });

  const remove = useMutation({
    mutationFn: (imageId: number) =>
      apiDelete(`/api/monitors/${encodeURIComponent(groupId)}/images/${imageId}`),
    onSuccess: () => {
      toast.success("Removed from gallery");
      invalidate();
    },
    onError: (e: ApiError) => toastApiError(e, "Remove image"),
  });

  const curatedListingKeys = new Set(
    gallery.curated
      .filter((img) => img.source === "listing")
      .map((img) => `${img.listing_platform}:${img.listing_id}`),
  );
  const pickable = gallery.fallback.filter(
    (candidate) => !curatedListingKeys.has(`${candidate.platform}:${candidate.listing_id}`),
  );

  return (
    <div className="space-y-3 py-2">
      {gallery.curated.length > 0 ? (
        <div>
          <span className="text-xs text-muted-foreground">Gallery</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {gallery.curated.map((img: SearchGroupImageDto) => (
              <div key={img.id} className="group relative">
                <LazyImage src={img.url} alt="Curated" className="size-16" />
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={() => remove.mutate(img.id)}
                  disabled={remove.isPending}
                  className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {pickable.length > 0 ? (
        <div>
          <span className="text-xs text-muted-foreground">
            Pick from recent good matches
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            {pickable.map((candidate) => (
              <button
                key={`${candidate.platform}:${candidate.listing_id}`}
                type="button"
                onClick={() => addFromListing.mutate(candidate)}
                disabled={addFromListing.isPending}
                className="group relative"
                title="Add to gallery"
              >
                <LazyImage src={candidate.url} alt="Recent match" className="size-16" />
                <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Plus className="size-5 text-white" />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (urlInput.trim()) addFromUrl.mutate(urlInput.trim());
        }}
      >
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste an image URL"
          className="h-8 max-w-xs text-xs"
        />
        <Button type="submit" size="sm" variant="outline" disabled={addFromUrl.isPending}>
          Add
        </Button>
      </form>
    </div>
  );
}
