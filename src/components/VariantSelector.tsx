import { Link } from 'react-router-dom';
import { ProductVariant } from '@/data/products';
import { products } from '@/data/products';

interface VariantSelectorProps {
  variants: ProductVariant[];
  selectedVariant: string;
  onVariantChange: (variantId: string) => void;
  currentProductId?: string;
}

export default function VariantSelector({ variants, selectedVariant, onVariantChange, currentProductId }: VariantSelectorProps) {
  if (!variants.length) return null;

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        Комплектация: <span className="text-foreground font-medium">
          {variants.find(v => v.id === selectedVariant)?.name}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {variants.map((variant) => {
          // Ищем товар по id варианта
          const linkedProduct = products.find(p => p.id === variant.id);
          const isSelected = selectedVariant === variant.id;

          // Если вариант совпадает с текущим товаром или товара нет - просто кнопка
          if (!linkedProduct || linkedProduct.id === currentProductId) {
            return (
              <button
                key={variant.id}
                onClick={() => onVariantChange(variant.id)}
                className={`px-4 py-2 text-sm rounded border transition-all ${isSelected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary/50 border-border hover:border-primary hover:bg-secondary'
                  }`}
              >
                {variant.name}
              </button>
            );
          }

          // Иначе - ссылка на страницу товара
          return (
            <Link
              key={variant.id}
              to={`/catalog/${linkedProduct.slug}`}
              className={`px-4 py-2 text-sm rounded border transition-all ${isSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary/50 border-border hover:border-primary hover:bg-secondary'
                }`}
            >
              {variant.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
