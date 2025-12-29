import { ProductVariant } from '@/data/products';

interface VariantSelectorProps {
  variants: ProductVariant[];
  selectedVariant: string;
  onVariantChange: (variantId: string) => void;
}

export default function VariantSelector({ variants, selectedVariant, onVariantChange }: VariantSelectorProps) {
  if (!variants.length) return null;

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        Комплектация: <span className="text-foreground font-medium">
          {variants.find(v => v.id === selectedVariant)?.name}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {variants.map((variant) => (
          <button
            key={variant.id}
            onClick={() => onVariantChange(variant.id)}
            className={`px-4 py-2 text-sm rounded border transition-all ${
              selectedVariant === variant.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-secondary/50 border-border hover:border-primary hover:bg-secondary'
            }`}
          >
            {variant.name}
          </button>
        ))}
      </div>
    </div>
  );
}
