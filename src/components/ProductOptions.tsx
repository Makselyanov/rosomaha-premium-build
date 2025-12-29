import { Plus, Check } from 'lucide-react';
import { ProductOption } from '@/data/products';

interface ProductOptionsProps {
  options: ProductOption[];
  selectedOptions: string[];
  onToggleOption: (optionId: string) => void;
}

export default function ProductOptions({ options, selectedOptions, onToggleOption }: ProductOptionsProps) {
  if (!options.length) return null;

  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg uppercase tracking-wider">Дополнительные опции</h3>
      <div className="grid gap-3">
        {options.map((option) => {
          const isSelected = selectedOptions.includes(option.id);
          return (
            <div
              key={option.id}
              className={`flex items-center gap-4 p-4 rounded-lg border transition-all ${
                isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
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
              <div className="text-right">
                <p className="font-bold text-primary">{option.priceFormatted}</p>
                <button
                  onClick={() => onToggleOption(option.id)}
                  className={`mt-2 px-4 py-1.5 text-sm rounded transition-all flex items-center gap-1 ${
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary hover:bg-secondary/80'
                  }`}
                >
                  {isSelected ? (
                    <>
                      <Check className="w-4 h-4" />
                      Добавлено
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Добавить
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
