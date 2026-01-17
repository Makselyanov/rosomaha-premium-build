import { useParams, Link, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, ChevronRight, ArrowLeft, Share2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
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
  // Using ReactMarkdown instead of custom renderContent


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

      {/* Article Hero */}
      <section className="relative h-[50vh] min-h-[400px] flex items-end overflow-hidden">
        {/* Background Image with Overlay */}
        <div className="absolute inset-0">
          <img
            src={article.coverImage || article.image || '/media/placeholder-article.jpg'}
            alt={article.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        </div>

        <div className="container relative z-10 pb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-4xl"
          >
            <Link
              to="/articles"
              className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors mb-6 font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Назад к статьям
            </Link>

            <div className="flex flex-wrap items-center gap-4 mb-6">
              <span className="px-3 py-1 bg-primary text-primary-foreground text-sm font-medium rounded-full">
                {article.category}
              </span>
              <div className="flex items-center gap-1.5 text-foreground/80 text-sm">
                <Calendar className="w-4 h-4" />
                {article.date}
              </div>
              <div className="flex items-center gap-1.5 text-foreground/80 text-sm">
                <Clock className="w-4 h-4" />
                {readingTime} мин чтения
              </div>
            </div>

            <h1 className="text-3xl md:text-5xl lg:text-6xl font-display font-bold mb-6 text-foreground drop-shadow-sm">
              {article.title}
            </h1>

            <p className="text-xl text-muted-foreground max-w-2xl">
              {article.excerpt}
            </p>
          </motion.div>
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
              className="prose prose-invert max-w-none break-words"
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                  a: ({ node, href, children, ...props }) => {
                    let finalHref = href;
                    if (href) {
                      if (href === '../index.htm' || href === './index.htm' || href === 'index.htm' || href === '../') {
                        finalHref = '/articles';
                      } else if (href.startsWith('../') && href.endsWith('/index.htm')) {
                        const match = href.match(/\.\.\/(.*?)\/index\.htm/);
                        if (match) {
                          finalHref = `/articles/${match[1]}`;
                        }
                      } else if (href.startsWith('https://rosomaha-rus.ru')) {
                        finalHref = href.replace('https://rosomaha-rus.ru', 'https://xn--80aa8ahaki9a.site');
                      }
                    }

                    const isInternal = finalHref?.startsWith('/') || finalHref?.startsWith('#');

                    if (isInternal) {
                      return (
                        <Link to={finalHref || '#'} className="text-primary hover:underline" {...props}>
                          {children}
                        </Link>
                      );
                    }

                    return (
                      <a href={finalHref} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer" {...props}>
                        {children}
                      </a>
                    );
                  }
                }}
              >
                {article.content}
              </ReactMarkdown>
            </motion.article>

            {/* Share */}
            <div className="mt-12 pt-8 border-t border-border">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">Поделиться:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.href);
                      toast.success("Ссылка скопирована");
                    }}
                    className="p-2 bg-secondary hover:bg-primary/20 rounded-lg transition-colors"
                  >
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
                      src={related.coverImage || related.image || '/media/placeholder-article.jpg'}
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
