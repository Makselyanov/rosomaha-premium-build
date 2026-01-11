import { ProductColor } from '@/data/products';

interface ColorSelectorProps {
  colors: ProductColor[];
  selectedColor: string;
  onColorChange: (colorId: string) => void;
}

export default function ColorSelector({ colors, selectedColor, onColorChange }: ColorSelectorProps) {
  const selected = colors.find(c => c.id === selectedColor);

  // Проверяем, является ли цвет светлым (для добавления видимой рамки)
  const isLightColor = (hex: string) => {
    if (!hex || hex.length < 7) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.7; // Снижен порог для лучшего определения белого цвета
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Цвет кузова:</span>
        <span className="text-sm font-medium">{selected?.ral} {selected?.name}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {colors.map((color) => {
          const needsBorder = isLightColor(color.hex);
          return (
            <button
              key={color.id}
              onClick={() => onColorChange(color.id)}
              title={`${color.ral} ${color.name}`}
              className={`w-8 h-8 rounded-full transition-all ${
                selectedColor === color.id
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  : 'hover:ring-2 hover:ring-primary/50 hover:ring-offset-1 hover:ring-offset-background'
              } ${needsBorder ? 'border-2 border-border' : 'border-2 border-transparent'}`}
              style={{ backgroundColor: color.hex }}
            />
          );
        })}
      </div>
    </div>
  );
}
