import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ShoppingCart, Check, Phone, Printer } from 'lucide-react';
import { products, productColors } from '@/data/products';
import { useCartStore } from '@/store/cartStore';
import { useToast } from '@/hooks/use-toast';
import ProductGallery from '@/components/ProductGallery';
import ColorSelector from '@/components/ColorSelector';
import VariantSelector from '@/components/VariantSelector';
import ProductOptions from '@/components/ProductOptions';

export default function ModelDetailPage() {
  const { slug } = useParams();
  const product = products.find((p) => p.slug === slug);
  const { addItem, toggleCart } = useCartStore();
  const { toast } = useToast();

  // State - РІС‹Р±РёСЂР°РµРј РІР°СЂРёР°РЅС‚, СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓСЋС‰РёР№ РґР°РЅРЅРѕРјСѓ С‚РѕРІР°СЂСѓ, РёР»Рё РїРµСЂРІС‹Р№ РµСЃР»Рё РЅРµ РЅР°Р№РґРµРЅ
  const defaultVariant = product?.variants.find(v => v.id === product.id)?.id || product?.variants[0]?.id || '';
  const [selectedVariant, setSelectedVariant] = useState(defaultVariant);
  const [selectedColor, setSelectedColor] = useState(product?.colors[0]?.id || '');
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

  // Computed
  const currentVariant = useMemo(
    () => product?.variants.find((v) => v.id === selectedVariant),
    [product, selectedVariant]
  );

  const currentColor = useMemo(
    () => product?.colors.find((c) => c.id === selectedColor) || productColors[0],
    [product, selectedColor]
  );

  // Р“Р°Р»РµСЂРµСЏ РёР·РѕР±СЂР°Р¶РµРЅРёР№ СЃ СѓС‡РµС‚РѕРј РІС‹Р±СЂР°РЅРЅРѕРіРѕ С†РІРµС‚Р°
  const galleryImages = useMemo(() => {
    // Р•СЃР»Рё Сѓ РІС‹Р±СЂР°РЅРЅРѕРіРѕ С†РІРµС‚Р° РµСЃС‚СЊ РёР·РѕР±СЂР°Р¶РµРЅРёРµ, СЃС‚Р°РІРёРј РµРіРѕ РїРµСЂРІС‹Рј
    if (currentColor?.image) {
      const colorImage = currentColor.image;
      // РџСЂРѕРІРµСЂСЏРµРј, РµСЃС‚СЊ Р»Рё СЌС‚Рѕ РёР·РѕР±СЂР°Р¶РµРЅРёРµ СѓР¶Рµ РІ РіР°Р»РµСЂРµРµ
      const otherImages = product?.gallery.filter(img => img !== colorImage) || [];
      return [colorImage, ...otherImages];
    }
    return product?.gallery || [];
  }, [product, currentColor]);

  const selectedOptionsData = useMemo(
    () => product?.options.filter((o) => selectedOptions.includes(o.id)) || [],
    [product, selectedOptions]
  );

  const optionsTotal = useMemo(
    () => selectedOptionsData.reduce((sum, o) => sum + o.price, 0),
    [selectedOptionsData]
  );

  const totalPrice = useMemo(
    () => (currentVariant?.price || 0) + optionsTotal,
    [currentVariant, optionsTotal]
  );

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('ru-RU').format(price) + ' в‚Ѕ';

  if (!product) {
    return (
      <main className="pt-24 pb-16">
        <div className="container text-center py-16">
          <h1 className="section-title mb-4">РњРѕРґРµР»СЊ РЅРµ РЅР°Р№РґРµРЅР°</h1>
          <Link to="/catalog" className="text-primary hover:underline">
            Р’РµСЂРЅСѓС‚СЊСЃСЏ РІ РєР°С‚Р°Р»РѕРі
          </Link>
        </div>
      </main>
    );
  }

  const handleToggleOption = (optionId: string) => {
    setSelectedOptions((prev) =>
      prev.includes(optionId)
        ? prev.filter((id) => id !== optionId)
        : [...prev, optionId]
    );
  };

  const handleAddToCart = () => {
    if (!currentVariant || !currentColor) return;

    addItem({
      product,
      variant: currentVariant,
      color: currentColor,
      options: selectedOptionsData,
    });

    toast({
      title: 'Р”РѕР±Р°РІР»РµРЅРѕ РІ РєРѕСЂР·РёРЅСѓ',
      description: `${product.name} вЂ” ${currentVariant.name}`,
    });

    toggleCart();
  };

  const handlePrint = () => {
    const printContent = `
      <html>
        <head>
          <title>РљРѕРЅС„РёРіСѓСЂР°С†РёСЏ вЂ” ${product.name}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
            h1 { font-size: 24px; margin-bottom: 10px; }
            h2 { font-size: 18px; color: #666; margin-bottom: 30px; }
            .section { margin-bottom: 25px; }
            .section-title { font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
            .row { display: flex; justify-content: space-between; padding: 5px 0; }
            .label { color: #666; }
            .value { font-weight: bold; }
            .total { font-size: 20px; margin-top: 30px; padding-top: 20px; border-top: 2px solid #333; }
            .options-list { margin-left: 20px; }
            .option-item { padding: 3px 0; }
          </style>
        </head>
        <body>
          <h1>Р РѕСЃРѕРјР°С…Р°</h1>
          <h2>${product.name}</h2>
          
          <div class="section">
            <div class="section-title">РљРѕРјРїР»РµРєС‚Р°С†РёСЏ</div>
            <div class="row">
              <span class="label">Р’С‹Р±СЂР°РЅРѕ:</span>
              <span class="value">${currentVariant?.name}</span>
            </div>
            <div class="row">
              <span class="label">Р‘Р°Р·РѕРІР°СЏ С†РµРЅР°:</span>
              <span class="value">${currentVariant?.priceFormatted}</span>
            </div>
          </div>
          
          <div class="section">
            <div class="section-title">Р¦РІРµС‚ РєСѓР·РѕРІР°</div>
            <div class="row">
              <span class="label">${currentColor.ral}</span>
              <span class="value">${currentColor.name}</span>
            </div>
          </div>
          
          ${selectedOptionsData.length > 0 ? `
          <div class="section">
            <div class="section-title">Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Рµ РѕРїС†РёРё</div>
            <div class="options-list">
              ${selectedOptionsData.map(o => `
                <div class="option-item row">
                  <span>${o.name}</span>
                  <span class="value">${o.priceFormatted}</span>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
          
          <div class="section">
            <div class="section-title">РҐР°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё</div>
            ${product.specs.engine ? `<div class="row"><span class="label">Р”РІРёРіР°С‚РµР»СЊ:</span><span class="value">${product.specs.engine}</span></div>` : ''}
            ${product.specs.power ? `<div class="row"><span class="label">РњРѕС‰РЅРѕСЃС‚СЊ:</span><span class="value">${product.specs.power} Р».СЃ.</span></div>` : ''}
            ${product.specs.axles ? `<div class="row"><span class="label">РњРѕСЃС‚С‹:</span><span class="value">${product.specs.axles}</span></div>` : ''}
            ${product.specs.speed ? `<div class="row"><span class="label">РњР°РєСЃ. СЃРєРѕСЂРѕСЃС‚СЊ:</span><span class="value">${product.specs.speed} РєРј/С‡</span></div>` : ''}
          </div>
          
          <div class="total row">
            <span>РРўРћР“Рћ:</span>
            <span class="value">${formatPrice(totalPrice)}</span>
          </div>
          
          <p style="margin-top: 40px; color: #999; font-size: 12px;">
            Р”Р°С‚Р°: ${new Date().toLocaleDateString('ru-RU')}<br/>
            РўРµР»РµС„РѕРЅ: +7 (3452) 564-164<br/>
            
          </p>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
  };

  return (
    <main className="pt-24 pb-16">
      <div className="container">
        {/* Breadcrumbs */}
        <nav className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
            <li>
              <Link to="/" className="hover:text-foreground transition-colors">
                Р“Р»Р°РІРЅР°СЏ
              </Link>
            </li>
            <li>/</li>
            <li>
              <Link to="/catalog" className="hover:text-foreground transition-colors">
                РљР°С‚Р°Р»РѕРі
              </Link>
            </li>
            <li>/</li>
            <li className="text-foreground">{product.name}</li>
          </ol>
        </nav>

        {/* Back Link */}
        <Link
          to="/catalog"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          РќР°Р·Р°Рґ РІ РєР°С‚Р°Р»РѕРі
        </Link>

        <div className="grid lg:grid-cols-2 gap-12">
          {/* Gallery */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            {product.badge && (
              <div className="mb-4">
                {product.badge === 'new' && <span className="badge-new">РќРѕРІРёРЅРєР°</span>}
                {product.badge === 'hit' && <span className="badge-hit">РҐРёС‚</span>}
                {product.badge === 'recommended' && (
                  <span className="inline-flex items-center px-3 py-1 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white font-display">
                    Р РµРєРѕРјРµРЅРґСѓРµРј
                  </span>
                )}
              </div>
            )}
            <ProductGallery images={galleryImages} productName={product.name} key={selectedColor} />
          </motion.div>

          {/* Info */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            <div>
              <p className="text-sm uppercase tracking-wider text-primary font-display mb-2">
                {product.categoryName}
              </p>
              <h1 className="text-2xl md:text-3xl font-display font-bold uppercase tracking-wider">
                {product.name}
              </h1>
            </div>

            {/* Availability */}
            {product.available && (
              <div className="flex items-center gap-2 text-green-500">
                <Check className="w-5 h-5" />
                <span className="font-medium">Р’ РЅР°Р»РёС‡РёРё</span>
              </div>
            )}

            {/* Price Block */}
            <div className="bg-secondary/50 rounded-lg p-6 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Р‘Р°Р·РѕРІР°СЏ С†РµРЅР°:</span>
                <span className="text-xl font-bold">{currentVariant?.priceFormatted}</span>
              </div>
              {optionsTotal > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">РћРїС†РёРё:</span>
                  <span className="text-primary">+{formatPrice(optionsTotal)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-3 border-t border-border">
                <span className="font-medium">РС‚РѕРіРѕ:</span>
                <span className="text-2xl md:text-3xl font-display font-bold text-gradient">
                  {formatPrice(totalPrice)}
                </span>
              </div>
            </div>

            {/* Variant Selector */}
            <VariantSelector
              variants={product.variants}
              selectedVariant={selectedVariant}
              onVariantChange={setSelectedVariant}
            />

            {/* Color Selector */}
            <ColorSelector
              colors={product.colors}
              selectedColor={selectedColor}
              onColorChange={setSelectedColor}
            />

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button onClick={handleAddToCart} className="btn-primary flex-1">
                <ShoppingCart className="mr-2 w-5 h-5" />
                Р’ РєРѕСЂР·РёРЅСѓ
              </button>
              <button onClick={handlePrint} className="btn-secondary flex-1">
                <Printer className="mr-2 w-5 h-5" />
                Р Р°СЃРїРµС‡Р°С‚Р°С‚СЊ
              </button>
            </div>

            {/* Contact */}
            <div className="p-6 bg-card border border-border rounded-lg">
              <p className="text-sm text-muted-foreground mb-3">
                Р•СЃС‚СЊ РІРѕРїСЂРѕСЃС‹ РїРѕ РјРѕРґРµР»Рё?
              </p>
              <a
                href="tel:+73452564164"
                className="flex items-center gap-2 text-lg font-medium hover:text-primary transition-colors"
              >
                <Phone className="w-5 h-5 text-primary" />
                +7 (3452) 564-164
              </a>
            </div>
          </motion.div>
        </div>

        {/* Specs */}
        <section className="mt-16">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-secondary/50 rounded-lg p-6">
              <h3 className="font-display text-lg uppercase tracking-wider mb-4">
                РҐР°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё
              </h3>
              <dl className="space-y-3">
                {product.specs.length && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Р”Р»РёРЅР°, РјРј</dt>
                    <dd className="font-medium">{product.specs.length}</dd>
                  </div>
                )}
                {product.specs.width && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">РЁРёСЂРёРЅР°, РјРј</dt>
                    <dd className="font-medium">{product.specs.width}</dd>
                  </div>
                )}
                {product.specs.height && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Р’С‹СЃРѕС‚Р°, РјРј</dt>
                    <dd className="font-medium">{product.specs.height}</dd>
                  </div>
                )}
                {product.specs.wheelDiameter && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Р”РёР°РјРµС‚СЂ РєРѕР»С‘СЃ, РјРј</dt>
                    <dd className="font-medium">{product.specs.wheelDiameter}</dd>
                  </div>
                )}
                {product.specs.clearance && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">РљР»РёСЂРµРЅСЃ, РјРј</dt>
                    <dd className="font-medium">{product.specs.clearance}</dd>
                  </div>
                )}
                {product.specs.weight && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">РњР°СЃСЃР°, РєРі</dt>
                    <dd className="font-medium">{product.specs.weight}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="bg-secondary/50 rounded-lg p-6">
              <h3 className="font-display text-lg uppercase tracking-wider mb-4">
                Р”РІРёРіР°С‚РµР»СЊ Рё С‚СЂР°РЅСЃРјРёСЃСЃРёСЏ
              </h3>
              <dl className="space-y-3">
                {product.specs.engine && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Р”РІРёРіР°С‚РµР»СЊ</dt>
                    <dd className="font-medium">{product.specs.engine}</dd>
                  </div>
                )}
                {product.specs.engineVolume && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">РћР±СЉС‘Рј, СЃРјВі</dt>
                    <dd className="font-medium">{product.specs.engineVolume}</dd>
                  </div>
                )}
                {product.specs.power && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">РњРѕС‰РЅРѕСЃС‚СЊ, Р».СЃ.</dt>
                    <dd className="font-medium">{product.specs.power}</dd>
                  </div>
                )}
                {product.specs.axles && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">РњРѕСЃС‚С‹</dt>
                    <dd className="font-medium">{product.specs.axles}</dd>
                  </div>
                )}
                {product.specs.speed && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">РњР°РєСЃ. СЃРєРѕСЂРѕСЃС‚СЊ, РєРј/С‡</dt>
                    <dd className="font-medium">{product.specs.speed}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </section>

        {/* Base Equipment */}
        {product.baseEquipment.length > 0 && (
          <section className="mt-12">
            <h3 className="font-display text-xl uppercase tracking-wider mb-6">
              Р‘Р°Р·РѕРІР°СЏ РєРѕРјРїР»РµРєС‚Р°С†РёСЏ
            </h3>
            <div className="bg-secondary/30 rounded-lg p-6">
              <ul className="grid md:grid-cols-2 gap-x-8 gap-y-2">
                {product.baseEquipment.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-primary mt-1 flex-shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Additional Options */}
        <section className="mt-12">
          <ProductOptions
            options={product.options}
            selectedOptions={selectedOptions}
            onToggleOption={handleToggleOption}
          />
        </section>

        {/* Description */}
        <section className="mt-12">
          <h3 className="font-display text-xl uppercase tracking-wider mb-4">
            РћРїРёСЃР°РЅРёРµ
          </h3>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-3xl">
            {product.description}
          </p>
        </section>
      </div>
    </main>
  );
}
