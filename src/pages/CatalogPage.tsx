import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Compass, MessagesSquare, SlidersHorizontal } from 'lucide-react';

import ModelCard from '@/components/ModelCard';
import {
  catalogCategories,
  catalogCategoryShowcase,
  catalogFaqs,
  catalogModels,
  catalogUseCases,
  type CatalogCategoryId,
} from '@/data/catalog';

type SortMode = 'catalog-order' | 'price-asc' | 'price-desc' | 'name';

export default function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortBy, setSortBy] = useState<SortMode>('catalog-order');

  const activeCategory = (searchParams.get('category') as CatalogCategoryId | null) || 'all';
  const activeCategoryMeta = catalogCategories.find((category) => category.id === activeCategory) || catalogCategories[0];

  const filteredModels = useMemo(() => {
    const result = [...catalogModels];
    const categoryFiltered =
      activeCategory === 'all' ? result : result.filter((model) => model.category === activeCategory);

    switch (sortBy) {
      case 'price-asc':
        return categoryFiltered.sort((a, b) => a.price - b.price);
      case 'price-desc':
        return categoryFiltered.sort((a, b) => b.price - a.price);
      case 'name':
        return categoryFiltered.sort((a, b) => a.name.localeCompare(b.name));
      case 'catalog-order':
      default:
        return categoryFiltered;
    }
  }, [activeCategory, sortBy]);

  const categoryCounts = useMemo(
    () =>
      catalogCategories.reduce<Record<CatalogCategoryId, number>>(
        (counts, category) => {
          counts[category.id] =
            category.id === 'all'
              ? catalogModels.length
              : catalogModels.filter((model) => model.category === category.id).length;
          return counts;
        },
        { all: 0, classic: 0, pickup: 0, sixwheel: 0, trailer: 0 },
      ),
    [],
  );

  const showcaseSections = useMemo(
    () =>
      catalogCategoryShowcase.map((section) => ({
        ...section,
        models: section.modelSlugs
          .map((slug) => catalogModels.find((model) => model.slug === slug))
          .filter((model): model is (typeof catalogModels)[number] => Boolean(model)),
      })),
    [],
  );

  const handleCategoryChange = (category: CatalogCategoryId) => {
    const nextParams = new URLSearchParams(searchParams);

    if (category === 'all') {
      nextParams.delete('category');
    } else {
      nextParams.set('category', category);
    }

    setSearchParams(nextParams);
  };

  return (
    <main className="pt-24 pb-20">
      <div className="container">
        <nav className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
            <li>
              <Link to="/" className="hover:text-foreground transition-colors">
                Главная
              </Link>
            </li>
            <li>/</li>
            <li className="text-foreground">Каталог</li>
          </ol>
        </nav>

        <section className="relative overflow-hidden rounded-[2rem] border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,114,32,0.18),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_36%)]" />
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(135deg,transparent,rgba(255,114,32,0.08))]" />

          <div className="relative grid xl:grid-cols-[1.35fr,0.85fr] gap-10 p-8 md:p-10 lg:p-12">
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
              <div className="flex flex-wrap gap-3 mb-6">
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                  Квадроциклы-вездеходы с завода
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Охота, рыбалка, вахта, экспедиции
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl xl:text-6xl font-display font-bold leading-[0.98] tracking-tight mb-6">
                Квадроциклы-вездеходы «Росомаха»: модели и цены
              </h1>

              <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mb-8">
                Официальный каталог завода: подбирайте технику под реальные маршруты, полезную нагрузку и сезон эксплуатации.
                Здесь собраны квадроциклы-вездеходы, снегоболотоходы, пикапы, шестиколёсники и плавающий прицеп для
                тяжёлых задач и уверенной работы вне дорог.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <a href="#catalog-grid" className="btn-primary">
                  Смотреть модели
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
                <Link to="/order" className="btn-secondary">
                  Получить расчёт под задачу
                </Link>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"
            >
              <div className="rounded-[1.5rem] border border-border/80 bg-background/70 p-6 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary mb-3">Быстрый ориентир</p>
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Моделей в каталоге</span>
                    <strong className="text-2xl font-display">{catalogModels.length}</strong>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Категорий техники</span>
                    <strong className="text-2xl font-display">4</strong>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Подбор под маршрут</span>
                    <strong className="text-lg font-display">Да</strong>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-border/80 bg-background/70 p-6 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary mb-3">Для кого каталог</p>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary shrink-0" />
                    Тем, кому нужна одна машина под охоту, рыбалку, экспедиции и хозяйственные задачи.
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary shrink-0" />
                    Бригадам и сервису, которым важны грузовая платформа, запас хода и проходимость.
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary shrink-0" />
                    Тем, кто хочет сравнить линейку до разговора с менеджером и не переплатить за лишнее.
                  </li>
                </ul>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="mt-10 rounded-[2rem] border border-primary/20 bg-primary/5 p-6 md:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.1fr,0.9fr] lg:items-center">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">Покупка без неопределённости</p>
              <h2 className="mb-4 text-3xl font-display font-bold md:text-4xl">Модель, актуальная цена и комплектация — в одном расчёте</h2>
              <p className="leading-relaxed text-muted-foreground">
                Цены в карточках помогают сравнить линейку, но итог зависит от двигателя, мостов, кузова и выбранных опций.
                Отправьте задачу — менеджер зафиксирует конкретную комплектацию, стоимость, срок готовности и вариант доставки.
              </p>
            </div>
            <div className="grid gap-3">
              <Link to="/order" className="btn-primary justify-center">Получить расчёт комплектации</Link>
              <Link to="/dealers/tyumen" className="btn-secondary justify-center">Производство и подбор в Тюмени</Link>
              <Link to="/delivery" className="text-center text-sm font-semibold text-primary hover:underline">Условия доставки по России</Link>
            </div>
          </div>
        </section>

        <section className="mt-10 grid lg:grid-cols-4 gap-4">
          {catalogUseCases.map((useCase, index) => (
            <motion.div
              key={useCase.id}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.05 }}
            >
              <Link
                to={useCase.href}
                className="group flex h-full flex-col rounded-[1.5rem] border border-border bg-secondary/25 p-5 transition-all duration-300 hover:border-primary/30 hover:bg-secondary/45"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary mb-3">{useCase.label}</span>
                <h2 className="text-xl font-display uppercase tracking-wide mb-3 group-hover:text-primary transition-colors">
                  {useCase.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-6 flex-grow">{useCase.description}</p>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
                  Перейти к сценарию
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </motion.div>
          ))}
        </section>

        <section id="catalog-grid" className="mt-16 rounded-[2rem] border border-border bg-card p-6 md:p-8 lg:p-10">
          <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-8 mb-10">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary mb-3">Выбор по задаче</p>
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Подберите конфигурацию без лишних компромиссов</h2>
              <p className="text-muted-foreground leading-relaxed">
                Сейчас выбрана категория: <span className="text-foreground font-medium">{activeCategoryMeta.name}</span>.
                {' '}
                {activeCategoryMeta.summary}
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-border/70 bg-background/70 px-5 py-4 text-sm text-muted-foreground">
              Найдено моделей: <span className="text-foreground font-semibold">{filteredModels.length}</span>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-border/70 bg-background/55 p-5 md:p-6 mb-8">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-primary mb-5">
              <SlidersHorizontal className="h-4 w-4" />
              Фильтры каталога
            </div>

            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap gap-2">
                {catalogCategories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => handleCategoryChange(category.id)}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
                      activeCategory === category.id
                        ? 'border-primary bg-primary text-primary-foreground shadow-[0_10px_30px_rgba(255,114,32,0.25)]'
                        : 'border-border bg-secondary/20 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    }`}
                  >
                    {category.name}
                    <span className="ml-2 text-xs opacity-80">{categoryCounts[category.id]}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <label className="text-sm text-muted-foreground">Сортировка</label>
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortMode)}
                  className="w-full max-w-sm rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm focus:outline-none focus:border-primary"
                >
                  <option value="catalog-order">По порядку каталога</option>
                  <option value="price-asc">Цена: по возрастанию</option>
                  <option value="price-desc">Цена: по убыванию</option>
                  <option value="name">По названию</option>
                </select>
              </div>
            </div>
          </div>

          {filteredModels.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredModels.map((model, index) => (
                <ModelCard key={model.id} model={model} index={index} />
              ))}
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-border/70 bg-background/50 p-10 text-center">
              <p className="text-lg text-muted-foreground mb-4">В этой категории пока нет моделей для показа.</p>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <button onClick={() => handleCategoryChange('all')} className="btn-secondary">
                  Показать весь каталог
                </button>
                <Link to="/order" className="btn-primary">
                  Описать задачу менеджеру
                </Link>
              </div>
            </div>
          )}
        </section>

        <section className="mt-16">
          <div className="max-w-3xl mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary mb-3">Как выбрать модель</p>
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Короткая навигация по линейке</h2>
            <p className="text-muted-foreground leading-relaxed">
              Ниже собраны основные классы техники и быстрые ориентиры, с чего начинать выбор, если вы только
              заходите в линейку «Росомаха».
            </p>
          </div>

          <div className="grid xl:grid-cols-2 gap-6">
            {showcaseSections.map((section, index) => (
              <motion.div
                key={section.id}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.06 }}
                className="rounded-[1.75rem] border border-border bg-card p-6 md:p-8"
              >
                <div className="flex items-start justify-between gap-6 mb-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary mb-3">{section.title}</p>
                    <h3 className="text-2xl font-display font-bold mb-3">{section.buyerHint}</h3>
                    <p className="text-muted-foreground leading-relaxed">{section.summary}</p>
                  </div>
                  <div className="hidden md:flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Compass className="h-5 w-5" />
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  {section.models.map((model) => (
                    <Link
                      key={model.slug}
                      to={`/catalog/${model.slug}`}
                      className="rounded-full border border-border bg-secondary/25 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      {model.name}
                    </Link>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mt-16 rounded-[2rem] border border-border bg-card p-6 md:p-8 lg:p-10">
          <div className="grid xl:grid-cols-[0.9fr,1.1fr] gap-8 items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary mb-3">Частые вопросы</p>
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Что важно узнать до покупки</h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Эти вопросы помогают быстрее отсечь неподходящие варианты и выйти на технику, которая действительно
                закроет маршрут, сезон и объём работ.
              </p>

              <Link to="/order" className="inline-flex items-center gap-2 text-primary font-semibold">
                Нужен подбор под ваш сценарий
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="space-y-4">
              {catalogFaqs.map((faq, index) => (
                <motion.div
                  key={faq.question}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className="rounded-[1.5rem] border border-border bg-secondary/20 p-6"
                >
                  <div className="flex items-start gap-4">
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <MessagesSquare className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold mb-3">{faq.question}</h3>
                      <p className="text-muted-foreground leading-relaxed">{faq.answer}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
