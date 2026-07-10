import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, ArrowRight, ChevronRight, Loader2 } from 'lucide-react';

import '@/assets/css/articles.css';
import { useArticles } from '@/hooks/use-articles';
import { resolveMediaUrl } from '@/lib/media';

export default function ArticlesPage() {
  const { allCategory, categories, filterByCategory, loading } = useArticles();
  const [selectedCategory, setSelectedCategory] = useState(allCategory);

  const filteredArticles = filterByCategory(selectedCategory);

  return (
    <main className="min-h-screen pt-20">
      {/* Breadcrumbs */}
      <div className="bg-secondary/50 border-b border-border">
        <div className="container py-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-primary transition-colors">
              Главная
            </Link>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
            <span className="text-foreground">Статьи</span>
          </nav>
        </div>
      </div>

      {/* Hero */}
      <section className="py-16 bg-gradient-to-b from-secondary/30 to-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl"
          >
            <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
              Статьи и полезные материалы
            </h1>
            <p className="text-xl text-muted-foreground">
              Советы по эксплуатации, обслуживанию и выбору снегоболотоходов.
              Полезная информация для владельцев и тех, кто планирует покупку.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Categories */}
      <section className="border-b border-border sticky top-20 bg-background/95 backdrop-blur-md z-40">
        <div className="container">
          <div className="article-categories-track">
            <div className="article-categories-scroll">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`article-category-button shrink-0 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${selectedCategory === category
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary hover:bg-secondary/80 text-foreground'
                    }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Articles Grid */}
      <section className="py-16">
        <div className="container">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {loading && filteredArticles.length === 0 && (
              <div className="col-span-full flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                Загрузка статей...
              </div>
            )}
            {filteredArticles.map((article, index) => (
              <motion.article
                key={article.slug}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="group"
              >
                <Link to={`/articles/${article.slug}`}>
                  <div className="bg-card rounded-2xl overflow-hidden border border-border hover:border-primary/50 transition-all duration-300">
                    {/* Image */}
                    <div className="aspect-[16/10] overflow-hidden">
                      <img
                        src={resolveMediaUrl(article.coverImage || article.image) || '/media/placeholder-article.jpg'}
                        alt={article.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/media/placeholder-article.jpg';
                        }}
                      />
                    </div>

                    {/* Content */}
                    <div className="p-6">
                      {/* Category & Date */}
                      <div className="flex items-center gap-4 mb-4">
                        <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-medium rounded-full">
                          {article.category}
                        </span>
                        <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
                          <Calendar className="w-4 h-4" />
                          {article.date}
                        </div>
                      </div>

                      {/* Title */}
                      <h2 className="text-xl font-semibold mb-3 group-hover:text-primary transition-colors line-clamp-2">
                        {article.title}
                      </h2>

                      {/* Excerpt */}
                      <p className="text-muted-foreground text-sm line-clamp-3 mb-4">
                        {article.excerpt}
                      </p>

                      {/* Read More */}
                      <div className="flex items-center gap-2 text-primary font-medium text-sm group-hover:gap-3 transition-all">
                        Читать далее
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.article>
            ))}
          </div>

          {filteredArticles.length === 0 && !loading && (
            <div className="text-center py-16">
              <p className="text-muted-foreground text-lg">
                В этой категории пока нет статей
              </p>
            </div>
          )}
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-secondary/50">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-display font-bold mb-4">
              Остались вопросы?
            </h2>
            <p className="text-muted-foreground mb-8">
              Наши специалисты готовы проконсультировать вас по любым вопросам
              о снегоболотоходах РОСОМАХА
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/contacts" className="btn-primary">
                Связаться с нами
              </Link>
              <Link to="/catalog" className="btn-secondary">
                Смотреть каталог
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
