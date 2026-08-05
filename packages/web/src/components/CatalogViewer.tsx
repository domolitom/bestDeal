"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { CatalogPage } from "@bestdeal/shared";

interface CatalogViewerProps {
  pages: CatalogPage[];
  catalogId: string;
  storeName?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function CatalogViewer({
  pages,
  catalogId,
  storeName,
  dateFrom,
  dateTo,
}: CatalogViewerProps) {
  const [mode, setMode] = useState<"scroll" | "single">("scroll");
  const [currentPage, setCurrentPage] = useState(0);
  const [scrollPage, setScrollPage] = useState(1);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Measure the actual site header height and expose it as --header-height
  // so the sticky viewer bar always sits flush below the header on all viewports.
  useEffect(() => {
    if (typeof document === "undefined") return;

    const headerEl = document.querySelector(".header") as HTMLElement | null;
    if (!headerEl) return;

    function updateHeaderHeight() {
      const h = (headerEl as HTMLElement).offsetHeight;
      document.documentElement.style.setProperty("--header-height", `${h}px`);
    }

    updateHeaderHeight();

    const ro = new ResizeObserver(updateHeaderHeight);
    ro.observe(headerEl);

    return () => ro.disconnect();
  }, []);

  const goNext = useCallback(() => {
    setCurrentPage((p) => Math.min(p + 1, pages.length - 1));
  }, [pages.length]);

  const goPrev = useCallback(() => {
    setCurrentPage((p) => Math.max(p - 1, 0));
  }, []);

  // Keyboard navigation for single-page mode
  useEffect(() => {
    if (mode !== "single") return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, goNext, goPrev]);

  // Scroll-spy: track which page is most visible in the viewport
  useEffect(() => {
    if (mode !== "scroll") return;
    if (typeof IntersectionObserver === "undefined") return;

    const observers: IntersectionObserver[] = [];
    const visibilityMap = new Map<number, number>();

    pageRefs.current.forEach((el, i) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            visibilityMap.set(i, entry.intersectionRatio);
          }
          // Pick the page with the highest intersection ratio
          let best = 0;
          let bestRatio = -1;
          visibilityMap.forEach((ratio, idx) => {
            if (ratio > bestRatio) {
              bestRatio = ratio;
              best = idx;
            }
          });
          setScrollPage(best + 1);
        },
        { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] },
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => {
      observers.forEach((obs) => obs.disconnect());
    };
  }, [mode, pages.length]);

  function pageAlt(pageNumber: number): string {
    if (storeName && dateFrom && dateTo) {
      return `${storeName} catalog page ${pageNumber} — ${dateFrom} to ${dateTo}`;
    }
    return `Page ${pageNumber}`;
  }

  return (
    <div className="viewer-container">
      {/* Sticky control bar — sits below the sticky site header (z-index 100) */}
      <div className="viewer-controls-sticky">
        <div className="viewer-controls">
          <button
            className={`viewer-mode-btn ${mode === "scroll" ? "viewer-mode-btn--active" : ""}`}
            onClick={() => setMode("scroll")}
          >
            Scroll
          </button>
          <button
            className={`viewer-mode-btn ${mode === "single" ? "viewer-mode-btn--active" : ""}`}
            onClick={() => setMode("single")}
          >
            Single page
          </button>
          {mode === "scroll" && (
            <span className="viewer-scroll-counter" aria-live="polite">
              {scrollPage} / {pages.length}
            </span>
          )}
        </div>
      </div>

      {mode === "scroll" ? (
        <div className="viewer-scroll-pages">
          {pages.map((page, i) => (
            <div
              key={page.number}
              className="viewer-page"
              ref={(el) => { pageRefs.current[i] = el; }}
            >
              <img
                src={page.imageUrl}
                alt={pageAlt(page.number)}
                loading={i < 3 ? "eager" : "lazy"}
              />
              <div className="viewer-page-number">
                Page {page.number} of {pages.length}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          {pages[currentPage] && (
            <div className="viewer-page">
              <img
                src={pages[currentPage].imageUrl}
                alt={pageAlt(pages[currentPage].number)}
              />
              <div className="viewer-page-number">
                Page {pages[currentPage].number} of {pages.length}
              </div>
            </div>
          )}

          <div className="viewer-nav">
            <button
              className="store-pill"
              onClick={goPrev}
              disabled={currentPage === 0}
            >
              Previous
            </button>
            <button
              className="store-pill"
              onClick={goNext}
              disabled={currentPage === pages.length - 1}
            >
              Next
            </button>
          </div>

          <div className="viewer-thumbstrip">
            {pages.map((page, i) => (
              <button
                key={page.number}
                onClick={() => setCurrentPage(i)}
                className={`viewer-thumb ${i === currentPage ? "viewer-thumb-active" : ""}`}
              >
                <img
                  src={page.imageUrl}
                  alt={pageAlt(page.number)}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
