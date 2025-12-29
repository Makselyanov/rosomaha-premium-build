import { ProductColor } from '@/data/products';

interface ColorSelectorProps {
  colors: ProductColor[];
  selectedColor: string;
  onColorChange: (colorId: string) => void;
}

export default function ColorSelector({ colors, selectedColor, onColorChange }: ColorSelectorProps) {
  const selected = colors.find(c => c.id === selectedColor);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Цвет кузова:</span>
        <span className="text-sm font-medium">{selected?.ral} {selected?.name}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {colors.map((color) => (
          <button
            key={color.id}
            onClick={() => onColorChange(color.id)}
            title={`${color.ral} ${color.name}`}
            className={`w-8 h-8 rounded-full border-2 transition-all ${
              selectedColor === color.id
                ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background'
                : 'border-transparent hover:border-primary/50'
            }`}
            style={{ backgroundColor: color.hex }}
          />
        ))}
      </div>
    </div>
  );
}
