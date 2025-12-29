import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ShoppingCart, Check, Phone } from 'lucide-react';
import { models } from '@/data/models';
import { useCartStore } from '@/store/cartStore';
import { useToast } from '@/hooks/use-toast';
import ModelCard from '@/components/ModelCard';

export default function ModelDetailPage() {
  const { slug } = useParams();
  const model = models.find((m) => m.slug === slug);
  const { addItem } = useCartStore();
  const { toast } = useToast();

  if (!model) {
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

  const handleAddToCart = () => {
    addItem(model);
    toast({
      title: 'Добавлено в корзину',
      description: model.name,
    });
  };

  const similarModels = models
    .filter((m) => m.category === model.category && m.id !== model.id)
    .slice(0, 3);

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
            <li className="text-foreground">{model.name}</li>
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
            <div className="relative aspect-[4/3] rounded-lg overflow-hidden mb-4">
              {model.badge && (
                <div className="absolute top-4 left-4 z-10">
                  {model.badge === 'new' && <span className="badge-new">Новинка</span>}
                  {model.badge === 'hit' && <span className="badge-hit">Хит</span>}
                  {model.badge === 'recommended' && (
                    <span className="inline-flex items-center px-3 py-1 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white font-display">
                      Рекомендуем
                    </span>
                  )}
                </div>
              )}
              <img
                src={model.image}
                alt={model.name}
                className="w-full h-full object-cover"
              />
            </div>
          </motion.div>

          {/* Info */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <p className="text-sm uppercase tracking-wider text-primary font-display mb-2">
              {model.categoryName}
            </p>
            <h1 className="text-3xl md:text-4xl font-display font-bold uppercase tracking-wider mb-6">
              {model.name}
            </h1>

            {/* Availability */}
            {model.available && (
              <div className="flex items-center gap-2 text-green-500 mb-6">
                <Check className="w-5 h-5" />
                <span className="font-medium">В наличии</span>
              </div>
            )}

            {/* Price */}
            <div className="mb-8">
              <p className="text-4xl md:text-5xl font-display font-bold text-gradient">
                {model.priceFormatted}
              </p>
            </div>

            {/* Description */}
            <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
              {model.description}
            </p>

            {/* Specs */}
            <div className="bg-secondary/50 rounded-lg p-6 mb-8">
              <h3 className="font-display text-lg uppercase tracking-wider mb-4">
                Характеристики
              </h3>
              <dl className="space-y-3">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Двигатель</dt>
                  <dd className="font-medium">{model.specs.engine}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Мощность</dt>
                  <dd className="font-medium">{model.specs.power}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Мосты</dt>
                  <dd className="font-medium">{model.specs.axles}</dd>
                </div>
              </dl>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4">
              <button onClick={handleAddToCart} className="btn-primary flex-1">
                <ShoppingCart className="mr-2 w-5 h-5" />
                В корзину
              </button>
              <Link to="/order" className="btn-secondary flex-1 text-center">
                Запросить расчёт
              </Link>
            </div>

            {/* Contact */}
            <div className="mt-8 p-6 bg-card border border-border rounded-lg">
              <p className="text-sm text-muted-foreground mb-3">
                Есть вопросы по модели?
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

        {/* Similar Models */}
        {similarModels.length > 0 && (
          <section className="mt-24">
            <h2 className="section-title text-3xl mb-8">Похожие модели</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {similarModels.map((m, index) => (
                <ModelCard key={m.id} model={m} index={index} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
