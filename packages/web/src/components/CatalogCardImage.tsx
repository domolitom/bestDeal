"use client";

interface CatalogCardImageProps {
  src: string;
  alt: string;
  storeName: string;
}

export function CatalogCardImage({ src, alt, storeName }: CatalogCardImageProps) {
  return (
    <div className="catalog-card-image-wrapper">
      <img
        className="catalog-card-image"
        src={src}
        alt={alt}
        loading="lazy"
        onError={(e) => {
          const img = e.currentTarget;
          img.style.display = "none";
          const wrapper = img.parentElement;
          if (wrapper) {
            wrapper.classList.add("catalog-card-image-placeholder");
            wrapper.setAttribute("data-store", storeName);
          }
        }}
      />
    </div>
  );
}
