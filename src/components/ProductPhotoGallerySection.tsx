import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ImageIcon } from "lucide-react";

import { resolveMediaUrls } from "@/lib/media";

type ProductPhotoGallerySectionProps = {
  images: string[];
  productName: string;
};

export default function ProductPhotoGallerySection({ images, productName }: ProductPhotoGallerySectionProps) {
  const galleryImages = useMemo(() => {
    const resolved = resolveMediaUrls(images);
    return Array.from(new Set(resolved));
  }, [images]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [galleryImages]);

  if (!galleryImages.length) {
    return null;
  }

  const activeImage = galleryImages[activeIndex] || galleryImages[0];
  const goPrev = () => setActiveIndex((prev) => (prev > 0 ? prev - 1 : galleryImages.length - 1));
  const goNext = () => setActiveIndex((prev) => (prev < galleryImages.length - 1 ? prev + 1 : 0));

  return (
    <section className="rounded-[28px] border border-border bg-card/80 p-6 md:p-8">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary">Фотоархив модели</p>
          <h3 className="mt-2 font-display text-2xl font-bold uppercase tracking-[0.08em]">Фотогалерея</h3>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/30 px-3 py-1.5">
            <ImageIcon className="h-4 w-4 text-primary" />
            {galleryImages.length} фото
          </span>
          <span className="font-medium text-foreground">
            {activeIndex + 1}/{galleryImages.length}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-border/70 bg-secondary/20">
        <div className="relative aspect-[16/10] bg-gradient-to-br from-secondary/60 via-background to-secondary/20">
          <img src={activeImage} alt={productName} className="h-full w-full object-cover" />

          {galleryImages.length > 1 && (
            <>
              <button
                type="button"
                onClick={goPrev}
                className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white transition-colors hover:bg-black/60"
                aria-label="Предыдущее фото"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={goNext}
                className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white transition-colors hover:bg-black/60"
                aria-label="Следующее фото"
              >
                <ArrowRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 p-3 md:grid-cols-6">
          {galleryImages.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`group overflow-hidden rounded-2xl border transition-all ${
                index === activeIndex
                  ? "border-primary shadow-[0_0_0_1px_rgba(249,115,22,0.35)]"
                  : "border-border/70 hover:border-primary/50"
              }`}
            >
              <img
                src={image}
                alt={`${productName} — фото ${index + 1}`}
                className="aspect-square h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
