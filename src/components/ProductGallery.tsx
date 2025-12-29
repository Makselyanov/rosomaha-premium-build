import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface ProductGalleryProps {
  images: string[];
  productName: string;
}

export default function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const handlePrev = () => {
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  if (!images.length) return null;

  return (
    <div className="flex gap-4">
      {/* Миниатюры слева */}
      <div className="hidden md:flex flex-col gap-2 w-20">
        <button
          onClick={handlePrev}
          className="w-full h-8 flex items-center justify-center bg-secondary/50 rounded hover:bg-secondary transition-colors"
        >
          <ChevronUp className="w-5 h-5" />
        </button>
        <div className="flex flex-col gap-2 overflow-hidden">
          {images.slice(0, 5).map((img, idx) => (
            <button
              key={idx}
              onClick={() => setActiveIndex(idx)}
              className={`w-full aspect-square rounded overflow-hidden border-2 transition-all ${
                idx === activeIndex ? 'border-primary' : 'border-transparent hover:border-primary/50'
              }`}
            >
              <img
                src={img}
                alt={`${productName} - ${idx + 1}`}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/placeholder.svg';
                }}
              />
            </button>
          ))}
        </div>
        <button
          onClick={handleNext}
          className="w-full h-8 flex items-center justify-center bg-secondary/50 rounded hover:bg-secondary transition-colors"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>

      {/* Основное изображение */}
      <div className="flex-1 relative aspect-[4/3] rounded-lg overflow-hidden bg-secondary/30">
        <img
          src={images[activeIndex]}
          alt={productName}
          className="w-full h-full object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/placeholder.svg';
          }}
        />
        
        {/* Мобильные точки */}
        <div className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {images.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setActiveIndex(idx)}
              className={`w-2 h-2 rounded-full transition-all ${
                idx === activeIndex ? 'bg-primary w-6' : 'bg-white/50'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
