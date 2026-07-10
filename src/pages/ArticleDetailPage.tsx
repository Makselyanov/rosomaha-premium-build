import { useParams, Link, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, ChevronRight, ArrowLeft, Share2, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import '@/assets/css/articles.css';
import { useArticles } from '@/hooks/use-articles';
import { getArticleHeroImage } from '@/lib/article-media';
import { resolveMediaUrl } from '@/lib/media';

export default function ArticleDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { articles, findBySlug, loading } = useArticles();
  const article = findBySlug(slug);

  if (loading && !article) {
    return (
      <main className="min-h-screen pt-20">
        <div className="container flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-3 h-5 w-5 animate-spin" />
          Загрузка статьи...
        </div>
      </main>
    );
  }

  if (!article) {
    return <Navigate to="/articles" replace />;
  }

  const relatedArticles = articles
    .filter((candidate) => candidate.category === article.category && candidate.slug !== article.slug)
    .slice(0, 3);

  const wordCount = article.content.split(/\s+/).length;
  const readingTime = Math.ceil(wordCount / 200);
  const heroImage = resolveMediaUrl(getArticleHeroImage(article)) || '/media/placeholder-article.jpg';

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
      <section className="article-hero relative h-[50vh] min-h-[400px] flex items-end overflow-hidden">
        {/* Background Image with Overlay */}
        <div className="article-hero-media absolute inset-0">
          <img
            src={heroImage}
            alt={article.title}
            className="article-hero-image w-full h-full object-cover"
            decoding="async"
            fetchPriority="high"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/media/placeholder-article.jpg';
            }}
          />
          <div className="article-hero-scrim absolute inset-0" />
        </div>

        <div className="container relative z-10 pb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="article-hero-copy max-w-5xl"
          >
            <Link
              to="/articles"
              className="article-hero-back inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors mb-6 font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Назад к статьям
            </Link>

            <div className="article-hero-meta flex flex-wrap items-center gap-4 mb-6">
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

            <h1 className="article-hero-title text-3xl md:text-5xl lg:text-6xl font-display font-bold mb-6 text-foreground">
              {article.title}
            </h1>

            <p className="article-hero-excerpt text-xl text-muted-foreground max-w-3xl">
              {article.excerpt}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Article Content */}
      <section className="py-8 pb-16">
        <div className="article-container">
          {article.video && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-10"
            >
              <div className="rounded-[2rem] border border-border bg-card/80 p-4 shadow-sm backdrop-blur-sm md:p-6">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
                      Видео
                    </p>
                    <h2 className="mt-2 text-2xl font-display font-semibold text-foreground">
                      С выставочной площадки
                    </h2>
                  </div>
                  <span className="text-sm text-muted-foreground">{article.date}</span>
                </div>

                <div className={article.videoIsPortrait ? 'mx-auto w-full max-w-[420px]' : 'w-full'}>
                  <div
                    className="overflow-hidden rounded-[1.6rem] bg-black shadow-2xl"
                    style={{ aspectRatio: article.videoIsPortrait ? '9 / 16' : '16 / 9' }}
                  >
                    <video
                      controls
                      playsInline
                      preload="metadata"
                      poster={heroImage}
                      className="h-full w-full object-cover"
                    >
                      <source src={article.video} type="video/mp4" />
                    </video>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="article-content"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={{
                a: ({ href, children, ...props }) => {
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
                    toast.success('Ссылка скопирована');
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
      </section>

      {/* Related Articles */}
      {relatedArticles.length > 0 && (
        <section className="py-16 bg-secondary/50">
          <div className="article-container">
            <h2 className="text-2xl font-display font-bold mb-8">
              Похожие статьи
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {relatedArticles.map((related) => (
                <Link
                  key={related.slug}
                  to={`/articles/${related.slug}`}
                  className="group bg-card rounded-xl overflow-hidden border border-border hover:border-primary/50 transition-all"
                >
                  <div className="aspect-[16/10] overflow-hidden">
                    <img
                      src={resolveMediaUrl(related.coverImage || related.image) || '/media/placeholder-article.jpg'}
                      alt={related.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/media/placeholder-article.jpg';
                      }}
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
        <div className="article-container text-center">
          <h2 className="text-3xl font-display font-bold mb-4">
            Готовы выбрать свой вездеход?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
            Ознакомьтесь с нашим каталогом или свяжитесь с нами для консультации
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/catalog" className="btn-primary">
              Смотреть каталог
            </Link>
            <Link to="/contacts" className="btn-secondary">
              Связаться с нами
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
