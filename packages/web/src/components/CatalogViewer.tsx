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
      <div className="viewer-controls">
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
                  alt={`Page ${page.number}`}
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
