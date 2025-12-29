import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams, Link } from 'react-router-dom';
import { Filter, Grid, List } from 'lucide-react';
import { models, vehicleCategories } from '@/data/models';
import ModelCard from '@/components/ModelCard';

export default function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortBy, setSortBy] = useState<'price-asc' | 'price-desc' | 'name'>('price-asc');

  const activeCategory = searchParams.get('category') || 'all';

  const filteredModels = useMemo(() => {
    let result = [...models];

    if (activeCategory !== 'all') {
      result = result.filter((m) => m.category === activeCategory);
    }

    switch (sortBy) {
      case 'price-asc':
        result.sort((a, b) => a.price - b.price);
        break;
      case 'price-desc':
        result.sort((a, b) => b.price - a.price);
        break;
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    return result;
  }, [activeCategory, sortBy]);

  const handleCategoryChange = (category: string) => {
    if (category === 'all') {
      searchParams.delete('category');
    } else {
      searchParams.set('category', category);
    }
    setSearchParams(searchParams);
  };

  return (
    <main className="pt-24 pb-16">
      <div className="container">
        {/* Breadcrumbs */}
        <nav className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-muted-foreground">
            <li>
              <Link to="/" className="hover:text-foreground transition-colors">
                Главная
              </Link>
            </li>
            <li>/</li>
            <li className="text-foreground">Каталог</li>
          </ol>
        </nav>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <h1 className="section-title mb-4">Каталог моделей</h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Снегоболотоходы «Росомаха» — российское производство с 2012 года. 
            Выберите технику под ваши задачи.
          </p>
        </motion.div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row gap-6 mb-12">
          {/* Categories */}
          <div className="flex flex-wrap gap-2">
            {vehicleCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategoryChange(cat.id)}
                className={`px-4 py-2 text-sm font-display uppercase tracking-wider rounded-lg transition-all ${
                  activeCategory === cat.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Sort */}
          <div className="lg:ml-auto flex items-center gap-4">
            <span className="text-sm text-muted-foreground">Сортировка:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="bg-secondary border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary"
            >
              <option value="price-asc">Цена: по возрастанию</option>
              <option value="price-desc">Цена: по убыванию</option>
              <option value="name">По названию</option>
            </select>
          </div>
        </div>

        {/* Results Count */}
        <p className="text-sm text-muted-foreground mb-8">
          Найдено моделей: {filteredModels.length}
        </p>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredModels.map((model, index) => (
            <ModelCard key={model.id} model={model} index={index} />
          ))}
        </div>

        {filteredModels.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg mb-4">
              В данной категории пока нет моделей
            </p>
            <button
              onClick={() => handleCategoryChange('all')}
              className="text-primary hover:underline"
            >
              Показать все модели
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
