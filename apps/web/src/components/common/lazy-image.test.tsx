import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LazyImage } from "./lazy-image";

describe("LazyImage", () => {
  it("shows a loading skeleton before the image loads, then hides it", () => {
    render(<LazyImage src="https://example.com/a.jpg" alt="A jacket" />);
    const img = screen.getByRole("img", { name: "A jacket" });
    expect(img.className).toContain("opacity-0");

    fireEvent.load(img);
    expect(img.className).toContain("opacity-100");
  });

  it("shows a fallback icon instead of a broken image on error", () => {
    render(<LazyImage src="https://example.com/broken.jpg" alt="A jacket" />);
    const img = screen.getByRole("img", { name: "A jacket" });
    expect(img.tagName).toBe("IMG");

    fireEvent.error(img);

    const fallback = screen.getByRole("img", { name: "A jacket" });
    expect(fallback.tagName).toBe("DIV");
  });
});
