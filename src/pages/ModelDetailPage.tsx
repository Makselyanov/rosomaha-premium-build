import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ShoppingCart, Check, Phone, Printer, ArrowRight, Compass, Newspaper } from 'lucide-react';
import { applications } from '@/data/applications';
import { articles } from '@/data/articles';
import { products, productColors } from '@/data/products';
import { useCartStore } from '@/store/cartStore';
import { useToast } from '@/hooks/use-toast';
import ProductGallery from '@/components/ProductGallery';
import ProductPhotoGallerySection from '@/components/ProductPhotoGallerySection';
import ProductDetailTabs from '@/components/ProductDetailTabs';
import ColorSelector from '@/components/ColorSelector';
import VariantSelector from '@/components/VariantSelector';
import ProductOptions from '@/components/ProductOptions';
import { officePhone, primaryPhone } from '@/data/contactInfo';
import { trackAddToCart, trackPhoneClick } from '@/lib/metrika';

export default function ModelDetailPage() {
  const { slug } = useParams();
  const product = products.find((p) => p.slug === slug);
  const { addItem, toggleCart } = useCartStore();
  const { toast } = useToast();

  // State - выбираем вариант, соответствующий данному товару, или первый если не найден
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

  // Галерея изображений с учетом выбранного цвета
  // Изображение цвета добавляется ТОЛЬКО если оно принадлежит данному товару (есть в gallery или thumbnails)
  const galleryImages = useMemo(() => {
    if (currentColor?.image) {
      const colorImage = currentColor.image;
      // Проверяем, принадлежит ли изображение цвета данному товару
      const productOwnImages = [...(product?.gallery || []), ...(product?.thumbnails || [])];
      const isOwnImage = productOwnImages.some(img => img === colorImage || img.includes(colorImage) || colorImage.includes(img.split('/').pop() || ''));

      if (isOwnImage) {
        // Изображение принадлежит товару — ставим в начало
        const otherImages = product?.gallery.filter(img => img !== colorImage) || [];
        return [colorImage, ...otherImages];
      }
    }
    // Если изображение цвета НЕ принадлежит товару — оставляем галерею как есть
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

  const relatedApplications = useMemo(() => {
    if (!product) {
      return [];
    }

    return applications
      .filter((application) =>
        application.recommendedConfigurations.some((configuration) => configuration.modelSlug === product.slug)
      )
      .slice(0, 3);
  }, [product]);

  const relatedArticles = useMemo(() => {
    const articleSlugs = new Set(relatedApplications.flatMap((application) => application.relatedArticles));

    return Array.from(articleSlugs)
      .map((articleSlug) => articles.find((article) => article.slug === articleSlug))
      .filter((article): article is (typeof articles)[number] => Boolean(article))
      .slice(0, 3);
  }, [relatedApplications]);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('ru-RU').format(price) + ' ₽';

  if (!product) {
    return (
      <main className="pt-24 pb-16">
        <div className="container text-center py-16">
          <h1 className="section-title mb-4">Модель не найдена</h1>
          <Link to="/catalog" className="text-primary hover:underline">
            Вернуться в каталог
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

    trackAddToCart({
      product: product.slug,
      variant: currentVariant.id,
      options_count: selectedOptionsData.length,
      value: totalPrice,
    });

    toast({
      title: 'Добавлено в корзину',
      description: `${product.name} — ${currentVariant.name}`,
    });

    toggleCart();
  };

  const handlePrint = () => {
    const printContent = `
      <html>
        <head>
          <title>Конфигурация — ${product.name}</title>
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
          <h1>Росомаха</h1>
          <h2>${product.name}</h2>
          
          <div class="section">
            <div class="section-title">Комплектация</div>
            <div class="row">
              <span class="label">Выбрано:</span>
              <span class="value">${currentVariant?.name}</span>
            </div>
            <div class="row">
              <span class="label">Базовая цена:</span>
              <span class="value">${currentVariant?.priceFormatted}</span>
            </div>
          </div>
          
          <div class="section">
            <div class="section-title">Цвет кузова</div>
            <div class="row">
              <span class="label">${currentColor.ral}</span>
              <span class="value">${currentColor.name}</span>
            </div>
          </div>
          
          ${selectedOptionsData.length > 0 ? `
          <div class="section">
            <div class="section-title">Дополнительные опции</div>
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
            <div class="section-title">Характеристики</div>
            ${product.specs.engine ? `<div class="row"><span class="label">Двигатель:</span><span class="value">${product.specs.engine}</span></div>` : ''}
            ${product.specs.power ? `<div class="row"><span class="label">Мощность:</span><span class="value">${product.specs.power} л.с.</span></div>` : ''}
            ${product.specs.axles ? `<div class="row"><span class="label">Мосты:</span><span class="value">${product.specs.axles}</span></div>` : ''}
            ${product.specs.speed ? `<div class="row"><span class="label">Макс. скорость:</span><span class="value">${product.specs.speed} км/ч</span></div>` : ''}
          </div>
          
          <div class="total row">
            <span>ИТОГО:</span>
            <span class="value">${formatPrice(totalPrice)}</span>
          </div>
          
          <p style="margin-top: 40px; color: #999; font-size: 12px;">
            Дата: ${new Date().toLocaleDateString('ru-RU')}<br/>
            Телефон / WhatsApp: ${primaryPhone.display}<br/>
            Офис: ${officePhone.display}<br/>
            xn--80aa8ahaki9a.site
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
                Главная
              </Link>
            </li>
            <li>/</li>
            <li>
              <Link to="/catalog" className="hover:text-foreground transition-colors">
                Каталог
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
          Назад в каталог
        </Link>

        <div className="grid lg:grid-cols-2 gap-12">
          {/* Gallery */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            {product.badge && (
              <div className="mb-4">
                {product.badge === 'new' && <span className="badge-new">Новинка</span>}
                {product.badge === 'hit' && <span className="badge-hit">Хит</span>}
                {product.badge === 'recommended' && (
                  <span className="inline-flex items-center px-3 py-1 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white font-display">
                    Рекомендуем
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
                <span className="font-medium">В наличии</span>
              </div>
            )}

            {/* Price Block */}
            <div className="bg-secondary/50 rounded-lg p-6 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Базовая цена:</span>
                <span className="text-xl font-bold">{currentVariant?.priceFormatted}</span>
              </div>
              {optionsTotal > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Опции:</span>
                  <span className="text-primary">+{formatPrice(optionsTotal)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-3 border-t border-border">
                <span className="font-medium">Итого:</span>
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
              currentProductId={product.id}
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
                В корзину
              </button>
              <button onClick={handlePrint} className="btn-secondary flex-1">
                <Printer className="mr-2 w-5 h-5" />
                Распечатать
              </button>
            </div>

            {/* Contact */}
            <div className="p-6 bg-card border border-border rounded-lg">
              <p className="text-sm text-muted-foreground mb-3">
                Есть вопросы по модели?
              </p>
              <a
                href={primaryPhone.href}
                onClick={() => trackPhoneClick('model_detail_primary')}
                className="flex items-center gap-2 text-lg font-medium hover:text-primary transition-colors"
              >
                <Phone className="w-5 h-5 text-primary" />
                {primaryPhone.display}
              </a>
              <p className="mt-1 text-sm text-muted-foreground">{primaryPhone.label}</p>
              <a
                href={officePhone.href}
                onClick={() => trackPhoneClick('model_detail_office')}
                className="mt-2 inline-flex text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                {officePhone.label}: {officePhone.display}
              </a>
            </div>
          </motion.div>
        </div>

        {/* Specs */}
        <section className="mt-16">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-secondary/50 rounded-lg p-6">
              <h3 className="font-display text-lg uppercase tracking-wider mb-4">
                Характеристики
              </h3>
              <dl className="space-y-3">
                {product.specs.length && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Длина, мм</dt>
                    <dd className="font-medium">{product.specs.length}</dd>
                  </div>
                )}
                {product.specs.width && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Ширина, мм</dt>
                    <dd className="font-medium">{product.specs.width}</dd>
                  </div>
                )}
                {product.specs.height && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Высота, мм</dt>
                    <dd className="font-medium">{product.specs.height}</dd>
                  </div>
                )}
                {product.specs.wheelDiameter && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Диаметр колёс, мм</dt>
                    <dd className="font-medium">{product.specs.wheelDiameter}</dd>
                  </div>
                )}
                {product.specs.clearance && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Клиренс, мм</dt>
                    <dd className="font-medium">{product.specs.clearance}</dd>
                  </div>
                )}
                {product.specs.weight && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Масса, кг</dt>
                    <dd className="font-medium">{product.specs.weight}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="bg-secondary/50 rounded-lg p-6">
              <h3 className="font-display text-lg uppercase tracking-wider mb-4">
                Двигатель и трансмиссия
              </h3>
              <dl className="space-y-3">
                {product.specs.engine && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Двигатель</dt>
                    <dd className="font-medium">{product.specs.engine}</dd>
                  </div>
                )}
                {product.specs.engineVolume && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Объём, см³</dt>
                    <dd className="font-medium">{product.specs.engineVolume}</dd>
                  </div>
                )}
                {product.specs.power && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Мощность, л.с.</dt>
                    <dd className="font-medium">{product.specs.power}</dd>
                  </div>
                )}
                {product.specs.axles && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Мосты</dt>
                    <dd className="font-medium">{product.specs.axles}</dd>
                  </div>
                )}
                {product.specs.speed && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Макс. скорость, км/ч</dt>
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
              Базовая комплектация
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
            product={product}
            variant={currentVariant}
            color={currentColor}
          />
        </section>

        {/* Description */}
        <section className="mt-12">
          <h3 className="font-display text-xl uppercase tracking-wider mb-4">
            Описание
          </h3>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-3xl">
            {product.description}
          </p>
        </section>

        <section className="mt-12">
          <ProductPhotoGallerySection images={galleryImages} productName={product.name} />
        </section>

        <section className="mt-12">
          <ProductDetailTabs productName={product.name} />
        </section>

        {(relatedApplications.length > 0 || relatedArticles.length > 0) && (
          <section className="mt-12 grid xl:grid-cols-2 gap-8">
            {relatedApplications.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Compass className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-primary font-bold">
                      Сферы применения
                    </p>
                    <h3 className="font-display text-xl uppercase tracking-wider">
                      Где эта модель раскрывается лучше всего
                    </h3>
                  </div>
                </div>

                <div className="space-y-4">
                  {relatedApplications.map((application) => (
                    <Link
                      key={application.slug}
                      to={`/applications/${application.slug}`}
                      className="group block rounded-xl border border-border/70 bg-secondary/20 p-5 transition-colors hover:border-primary/40 hover:bg-secondary/40"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">
                            {application.title}
                          </h4>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {application.tagline}
                          </p>
                        </div>
                        <ArrowRight className="w-5 h-5 text-primary shrink-0 transition-transform group-hover:translate-x-1" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {relatedArticles.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Newspaper className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-primary font-bold">
                      Полезные материалы
                    </p>
                    <h3 className="font-display text-xl uppercase tracking-wider">
                      Что почитать перед покупкой
                    </h3>
                  </div>
                </div>

                <div className="space-y-4">
                  {relatedArticles.map((article) => (
                    <Link
                      key={article.slug}
                      to={`/articles/${article.slug}`}
                      className="group block rounded-xl border border-border/70 bg-secondary/20 p-5 transition-colors hover:border-primary/40 hover:bg-secondary/40"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">
                            {article.title}
                          </h4>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {article.excerpt}
                          </p>
                        </div>
                        <ArrowRight className="w-5 h-5 text-primary shrink-0 transition-transform group-hover:translate-x-1" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
