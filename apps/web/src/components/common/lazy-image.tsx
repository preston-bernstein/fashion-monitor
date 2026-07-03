import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function LazyImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  if (status === "error") {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn(
          "flex items-center justify-center rounded-md bg-muted text-muted-foreground",
          className,
        )}
      >
        <ImageOff className="size-1/3" />
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-md bg-muted", className)}>
      {status === "loading" ? <Skeleton className="absolute inset-0 rounded-md" /> : null}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={cn(
          "size-full rounded-md object-cover transition-opacity",
          status === "loading" ? "opacity-0" : "opacity-100",
        )}
      />
    </div>
  );
}
