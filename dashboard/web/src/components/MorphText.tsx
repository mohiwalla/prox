import { useEffect, useRef } from "react";
import { TextMorph } from "torph";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function MorphText({
  text,
  className,
}: {
  text: string | number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const morphRef = useRef<{ text: string; instance: TextMorph } | null>(null);
  const str = String(text);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      morphRef.current = null;
      if (el.textContent !== str) el.textContent = str;
      return;
    }
    if (!morphRef.current) {
      const instance = new TextMorph({
        element: el,
        duration: 400,
        ease: "cubic-bezier(0.19, 1, 0.22, 1)",
      });
      morphRef.current = { text: str, instance };
      instance.update(str);
      return;
    }
    if (morphRef.current.text !== str) {
      morphRef.current.text = str;
      morphRef.current.instance.update(str);
    }
  }, [str]);

  return (
    <span ref={ref} data-morph="" className={className}>
      {str}
    </span>
  );
}
