"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Wraps the store filter pill row and toggles an `is-scrollable` class
 * only when the pills actually overflow the viewport width. The
 * right-edge fade (mask-image) in globals.css is gated on this class so
 * it never renders for lists that fit entirely on screen.
 */
export function StoreList({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const checkOverflow = () => {
      setIsScrollable(el.scrollWidth > el.clientWidth + 1);
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(el);
    window.addEventListener("resize", checkOverflow);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", checkOverflow);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`store-list${isScrollable ? " is-scrollable" : ""}`}
    >
      {children}
    </div>
  );
}
