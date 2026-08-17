import { useState } from 'react';
import { Plus, Check, ShoppingCart, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ProductOption, Product, ProductVariant, ProductColor } from '@/data/products';
import { useCartStore } from '@/store/cartStore';
import { useToast } from '@/hooks/use-toast';
import { resolveMediaUrl } from '@/lib/media';

interface ProductOptionsProps {
  options: ProductOption[];
  selectedOptions: string[];
  onToggleOption: (optionId: string) => void;
  product?: Product;
  variant?: ProductVariant;
  color?: ProductColor;
}

const LABELS = {
  heading: '\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u043e\u043f\u0446\u0438\u0438',
  selected: '\u0412\u044b\u0431\u0440\u0430\u043d\u043e',
  select: '\u0412\u044b\u0431\u0440\u0430\u0442\u044c',
  addToCart: '\u0412 \u043a\u043e\u0440\u0437\u0438\u043d\u0443',
  removeFromConfig: '\u0423\u0431\u0440\u0430\u0442\u044c \u0438\u0437 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438',
  addToConfig: '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u044e',
  addToCartTitle: '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432 \u043a\u043e\u0440\u0437\u0438\u043d\u0443',
  toastTitle: '\u041e\u043f\u0446\u0438\u044f \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0430 \u0432 \u043a\u043e\u0440\u0437\u0438\u043d\u0443',
  viewAll: '\u0412\u0441\u0435 \u043e\u043f\u0446\u0438\u0438',
  optionBadge: 'Option',
};

export default function ProductOptions({
  options,
  selectedOptions,
  onToggleOption,
  product,
  variant,
  color,
}: ProductOptionsProps) {
  const { addItem, toggleCart } = useCartStore();
  const { toast } = useToast();
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  if (!options.length) return null;

  const handleAddOptionToCart = (option: ProductOption) => {
    if (!product || !variant || !color) {
      onToggleOption(option.id);
      return;
    }

    addItem({
      product,
      variant,
      color,
      options: [option],
    });

    toast({
      title: LABELS.toastTitle,
      description: `${option.name} - ${option.priceFormatted}`,
    });

    toggleCart();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-display text-lg uppercase tracking-wider">{LABELS.heading}</h3>
        <Link to="/options" className="text-sm font-semibold text-primary transition-colors hover:text-primary/80">
          {LABELS.viewAll}
        </Link>
      </div>
      <div className="grid gap-3">
        {options.map((option) => {
          const isSelected = selectedOptions.includes(option.id);
          const optionImage = resolveMediaUrl(option.image);
          const useFallbackImage = !optionImage || brokenImages[option.id];

          return (
            <div
              key={option.id}
              className={`flex flex-col items-stretch gap-4 rounded-lg border p-4 transition-all sm:flex-row sm:items-center ${
                isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}
            >
              {!useFallbackImage ? (
                <img
                  src={optionImage}
                  alt={option.name}
                  width={option.imageWidth}
                  height={option.imageHeight}
                  className={`h-36 w-full shrink-0 rounded border border-border/60 bg-secondary/20 sm:h-16 sm:w-16 ${
                    option.imageFit === 'contain' ? 'object-contain' : 'object-cover'
                  }`}
                  loading="lazy"
                  onError={() => {
                    setBrokenImages((prev) => ({ ...prev, [option.id]: true }));
                  }}
                />
              ) : (
                <div className="relative flex h-24 w-full shrink-0 items-center justify-center overflow-hidden rounded border border-border/60 bg-gradient-to-br from-secondary via-secondary/80 to-background sm:h-16 sm:w-16">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.18),transparent_60%)]" />
                  <div className="relative flex flex-col items-center justify-center">
                    <Wrench className="h-6 w-6 text-primary/80" />
                    <span className="mt-1 text-[8px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {LABELS.optionBadge}
                    </span>
                  </div>
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug sm:truncate">{option.name}</p>
                {option.specs && (
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {Object.entries(option.specs)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(' | ')}
                  </p>
                )}
              </div>

              <div className="flex w-full flex-col gap-2 text-left sm:w-auto sm:text-right">
                <p className="font-bold text-primary">{option.priceFormatted}</p>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <button
                    onClick={() => onToggleOption(option.id)}
                    className={`flex min-w-0 items-center justify-center gap-1 rounded px-3 py-1.5 text-sm transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary hover:bg-secondary/80'
                    }`}
                    title={isSelected ? LABELS.removeFromConfig : LABELS.addToConfig}
                  >
                    {isSelected ? (
                      <>
                        <Check className="h-4 w-4" />
                        {LABELS.selected}
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        {LABELS.select}
                      </>
                    )}
                  </button>

                  {product && variant && color && (
                    <button
                      onClick={() => handleAddOptionToCart(option)}
                      className="flex min-w-0 items-center justify-center gap-1 rounded bg-green-600 px-3 py-1.5 text-sm text-white transition-all hover:bg-green-700"
                      title={LABELS.addToCartTitle}
                    >
                      <ShoppingCart className="h-4 w-4" />
                      {LABELS.addToCart}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
