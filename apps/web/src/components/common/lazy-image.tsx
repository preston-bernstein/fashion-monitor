import { cn } from "@/lib/utils";

export function LazyImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn("rounded-md object-cover bg-muted", className)}
    />
  );
}
