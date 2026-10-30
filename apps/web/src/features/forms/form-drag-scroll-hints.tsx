import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// Motion's Reorder.Item owns scrolling and drag compensation. These cues expose
// its 50px viewport edge zones without introducing a second scrolling loop.
export function FormDragScrollHints() {
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const [active, setActive] = useState<"top" | "bottom" | null>(null);
  useEffect(() => {
    const update = () => {
      const max = Math.max(
        0,
        document.documentElement.scrollHeight - innerHeight,
      );
      const top = scrollY > 1;
      const bottom = scrollY < max - 1;
      setEdges((previous) =>
        previous.top === top && previous.bottom === bottom
          ? previous
          : { top, bottom },
      );
    };
    const pointer = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      setActive(
        event.clientY < 50
          ? "top"
          : event.clientY > innerHeight - 50
            ? "bottom"
            : null,
      );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.addEventListener("pointermove", pointer, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("pointermove", pointer);
    };
  }, []);
  return (
    <div aria-hidden="true" className="form-drag-scroll-hints">
      {edges.top && (
        <div
          className="form-drag-scroll-edge form-drag-scroll-top"
          data-active={active === "top" || undefined}
        >
          <span>
            <ChevronUp size={14} /> Hold here to scroll up
          </span>
        </div>
      )}
      {edges.bottom && (
        <div
          className="form-drag-scroll-edge form-drag-scroll-bottom"
          data-active={active === "bottom" || undefined}
        >
          <span>
            <ChevronDown size={14} /> Hold here to scroll down
          </span>
        </div>
      )}
    </div>
  );
}
