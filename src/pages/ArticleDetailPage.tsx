import { useParams, Link, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, ChevronRight, ArrowLeft, Share2, Clock } from 'lucide-react';
import { articles } from '@/data/articles';

export default function ArticleDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const article = articles.find(a => a.slug === slug);

  if (!article) {
    return <Navigate to="/articles" replace />;
  }

  // Get related articles
  const relatedArticles = articles
    .filter(a => a.category === article.category && a.id !== article.id)
    .slice(0, 3);

  // Estimate reading time (roughly 200 words per minute)
  const wordCount = article.content.split(/\s+/).length;
  const readingTime = Math.ceil(wordCount / 200);

  // Convert markdown-like content to HTML sections
  const renderContent = (content: string) => {
    const sections = content.split('\n\n');
    return sections.map((section, index) => {
      if (section.startsWith('## ')) {
        return (
          <h2 key={index} className="text-2xl font-display font-bold mt-10 mb-4">
            {section.replace('## ', '')}
          </h2>
        );
      }
      if (section.startsWith('### ')) {
        return (
          <h3 key={index} className="text-xl font-display font-semibold mt-8 mb-3">
            {section.replace('### ', '')}
          </h3>
        );
      }
      if (section.startsWith('- ')) {
        const items = section.split('\n');
        return (
          <ul key={index} className="list-disc list-inside space-y-2 my-4 text-muted-foreground">
            {items.map((item, i) => (
              <li key={i}>{item.replace('- ', '')}</li>
            ))}
          </ul>
        );
      }
      return (
        <p key={index} className="text-muted-foreground leading-relaxed my-4">
          {section}
        </p>
      );
    });
  };

  return (
    <main className="min-h-screen pt-20">
      {/* Breadcrumbs */}
      <div className="bg-secondary/50 border-b border-border">
        <div className="container py-4">
          <nav className="flex items-center gap-2 text-sm flex-wrap">
            <Link to="/" className="text-muted-foreground hover:text-primary transition-colors">
              Главная
            </Link>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
            <Link to="/articles" className="text-muted-foreground hover:text-primary transition-colors">
              Статьи
            </Link>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
            <span className="text-foreground line-clamp-1">{article.title}</span>
          </nav>
        </div>
      </div>

      {/* Article Header */}
      <section className="py-12 bg-gradient-to-b from-secondary/30 to-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-4xl mx-auto"
          >
            <Link 
              to="/articles"
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              Назад к статьям
            </Link>

            <div className="flex items-center gap-4 mb-6">
              <span className="px-3 py-1 bg-primary/10 text-primary text-sm font-medium rounded-full">
                {article.category}
              </span>
              <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
                <Calendar className="w-4 h-4" />
                {article.date}
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
                <Clock className="w-4 h-4" />
                {readingTime} мин чтения
              </div>
            </div>

            <h1 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold mb-6">
              {article.title}
            </h1>

            <p className="text-xl text-muted-foreground">
              {article.excerpt}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Featured Image */}
      <section className="py-8">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="aspect-[21/9] rounded-2xl overflow-hidden"
            >
              <img
                src={article.image}
                alt={article.title}
                className="w-full h-full object-cover"
              />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Article Content */}
      <section className="py-8 pb-16">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <motion.article
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="prose prose-invert prose-lg max-w-none"
            >
              {renderContent(article.content)}
            </motion.article>

            {/* Share */}
            <div className="mt-12 pt-8 border-t border-border">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">Поделиться:</span>
                  <button className="p-2 bg-secondary hover:bg-primary/20 rounded-lg transition-colors">
                    <Share2 className="w-5 h-5" />
                  </button>
                </div>
                <Link 
                  to="/articles"
                  className="text-primary hover:underline flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Все статьи
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Related Articles */}
      {relatedArticles.length > 0 && (
        <section className="py-16 bg-secondary/50">
          <div className="container">
            <h2 className="text-2xl font-display font-bold mb-8">
              Похожие статьи
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {relatedArticles.map((related) => (
                <Link
                  key={related.id}
                  to={`/articles/${related.slug}`}
                  className="group bg-card rounded-xl overflow-hidden border border-border hover:border-primary/50 transition-all"
                >
                  <div className="aspect-[16/10] overflow-hidden">
                    <img
                      src={related.image}
                      alt={related.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <Calendar className="w-3.5 h-3.5" />
                      {related.date}
                    </div>
                    <h3 className="font-display font-semibold group-hover:text-primary transition-colors line-clamp-2">
                      {related.title}
                    </h3>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-16">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-display font-bold mb-4">
              Готовы выбрать свой вездеход?
            </h2>
            <p className="text-muted-foreground mb-8">
              Ознакомьтесь с нашим каталогом или свяжитесь с нами для консультации
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/catalog" className="btn-primary">
                Смотреть каталог
              </Link>
              <Link to="/contacts" className="btn-outline">
                Связаться с нами
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
