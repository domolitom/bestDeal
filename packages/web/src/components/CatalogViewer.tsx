"use client";

import { useState, useEffect, useCallback } from "react";
import type { CatalogPage } from "@bestdeal/shared";

interface CatalogViewerProps {
  pages: CatalogPage[];
  catalogId: string;
}

export function CatalogViewer({ pages, catalogId }: CatalogViewerProps) {
  const [mode, setMode] = useState<"scroll" | "single">("scroll");
  const [currentPage, setCurrentPage] = useState(0);

  const goNext = useCallback(() => {
    setCurrentPage((p) => Math.min(p + 1, pages.length - 1));
  }, [pages.length]);

  const goPrev = useCallback(() => {
    setCurrentPage((p) => Math.max(p - 1, 0));
  }, []);

  // Keyboard navigation in single-page mode
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

  return (
    <div className="viewer-container">
      {/* Mode toggle */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 8,
          marginBottom: 20,
        }}
      >
        <button
          className={`store-pill ${mode === "scroll" ? "store-pill-active" : ""}`}
          onClick={() => setMode("scroll")}
        >
          Scroll View
        </button>
        <button
          className={`store-pill ${mode === "single" ? "store-pill-active" : ""}`}
          onClick={() => setMode("single")}
        >
          Single Page
        </button>
      </div>

      {mode === "scroll" ? (
        // Scroll mode: show all pages vertically
        pages.map((page, i) => (
          <div key={page.number} className="viewer-page">
            <img
              src={page.imageUrl}
              alt={`Page ${page.number}`}
              loading={i < 3 ? "eager" : "lazy"}
            />
            <div className="viewer-page-number">
              Page {page.number} of {pages.length}
            </div>
          </div>
        ))
      ) : (
        // Single page mode
        <div>
          {pages[currentPage] && (
            <div className="viewer-page">
              <img
                src={pages[currentPage].imageUrl}
                alt={`Page ${pages[currentPage].number}`}
              />
              <div className="viewer-page-number">
                Page {pages[currentPage].number} of {pages.length}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 12,
              marginTop: 16,
            }}
          >
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

          {/* Thumbnail strip */}
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              padding: "16px 0",
              marginTop: 16,
            }}
          >
            {pages.map((page, i) => (
              <button
                key={page.number}
                onClick={() => setCurrentPage(i)}
                style={{
                  flexShrink: 0,
                  width: 60,
                  height: 80,
                  border:
                    i === currentPage
                      ? "2px solid var(--accent)"
                      : "1px solid var(--border)",
                  borderRadius: 4,
                  overflow: "hidden",
                  cursor: "pointer",
                  padding: 0,
                  background: "none",
                }}
              >
                <img
                  src={page.imageUrl}
                  alt={`Page ${page.number}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
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
