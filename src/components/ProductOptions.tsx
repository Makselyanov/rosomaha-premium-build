import { Plus, Check, ShoppingCart } from 'lucide-react';
import { ProductOption, Product, ProductVariant, ProductColor } from '@/data/products';
import { useCartStore } from '@/store/cartStore';
import { useToast } from '@/hooks/use-toast';

interface ProductOptionsProps {
  options: ProductOption[];
  selectedOptions: string[];
  onToggleOption: (optionId: string) => void;
  // Дополнительные пропсы для добавления опции в корзину
  product?: Product;
  variant?: ProductVariant;
  color?: ProductColor;
}

export default function ProductOptions({
  options,
  selectedOptions,
  onToggleOption,
  product,
  variant,
  color
}: ProductOptionsProps) {
  const { addItem, toggleCart } = useCartStore();
  const { toast } = useToast();

  if (!options.length) return null;

  // Функция для добавления опции напрямую в корзину
  const handleAddOptionToCart = (option: ProductOption) => {
    if (!product || !variant || !color) {
      // Если контекст товара не передан, просто переключаем выбор
      onToggleOption(option.id);
      return;
    }

    // Добавляем товар в корзину только с этой опцией
    addItem({
      product,
      variant,
      color,
      options: [option],
    });

    toast({
      title: 'Опция добавлена в корзину',
      description: `${option.name} — ${option.priceFormatted}`,
    });

    toggleCart();
  };

  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg uppercase tracking-wider">Дополнительные опции</h3>
      <div className="grid gap-3">
        {options.map((option) => {
          const isSelected = selectedOptions.includes(option.id);
          return (
            <div
              key={option.id}
              className={`flex items-center gap-4 p-4 rounded-lg border transition-all ${isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                }`}
            >
              {option.image ? (
                <img
                  src={option.image}
                  alt={option.name}
                  className="w-16 h-16 object-cover rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/placeholder.svg';
                  }}
                />
              ) : (
                <div className="w-16 h-16 bg-secondary rounded flex items-center justify-center">
                  <span className="text-2xl text-muted-foreground">🔧</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{option.name}</p>
                {option.specs && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {Object.entries(option.specs).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                  </p>
                )}
              </div>
              <div className="text-right flex flex-col gap-2">
                <p className="font-bold text-primary">{option.priceFormatted}</p>
                <div className="flex gap-2">
                  {/* Кнопка выбора опции (для включения в конфигурацию) */}
                  <button
                    onClick={() => onToggleOption(option.id)}
                    className={`px-3 py-1.5 text-sm rounded transition-all flex items-center gap-1 ${isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary hover:bg-secondary/80'
                      }`}
                    title={isSelected ? 'Убрать из конфигурации' : 'Добавить в конфигурацию'}
                  >
                    {isSelected ? (
                      <>
                        <Check className="w-4 h-4" />
                        Выбрано
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Выбрать
                      </>
                    )}
                  </button>
                  {/* Кнопка добавления в корзину */}
                  {product && variant && color && (
                    <button
                      onClick={() => handleAddOptionToCart(option)}
                      className="px-3 py-1.5 text-sm rounded bg-green-600 hover:bg-green-700 text-white transition-all flex items-center gap-1"
                      title="Добавить в корзину"
                    >
                      <ShoppingCart className="w-4 h-4" />
                      В корзину
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
