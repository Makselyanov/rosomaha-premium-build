import { useDeferredValue, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Gauge, PackageOpen, Search, ShieldCheck, SlidersHorizontal, Snowflake, Wrench } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { catalogModels } from '@/data/catalog';
import { allProductOptions, productOptions, products, type ProductOption } from '@/data/products';
import { resolveMediaUrl } from '@/lib/media';

type OptionsCategoryId = 'all' | 'traction' | 'cargo' | 'comfort' | 'expedition';
type SortMode = 'legacy' | 'price-asc' | 'price-desc' | 'name';

type OptionCategory = {
  id: OptionsCategoryId;
  name: string;
  summary: string;
  accent: string;
  icon: typeof Gauge;
};

const optionCategories: OptionCategory[] = [
  {
    id: 'all',
    name: 'Все опции',
    summary: 'Полный каталог дополнительного оснащения для снегоболотоходов «Росомаха».',
    accent: 'Основной каталог',
    icon: PackageOpen,
  },
  {
    id: 'traction',
    name: 'Тяга и проходимость',
    summary: 'Лебёдки, блокировки, защита и всё, что усиливает машину на тяжёлом маршруте.',
    accent: 'Тяжёлые условия',
    icon: Gauge,
  },
  {
    id: 'cargo',
    name: 'Кузов и груз',
    summary: 'Кофры, каркасы с тентом, сиденья и решения под инструмент, лагерь и полезную нагрузку.',
    accent: 'Груз и компоновка',
    icon: PackageOpen,
  },
  {
    id: 'comfort',
    name: 'Тепло и комфорт',
    summary: 'Подогрев, автономное тепло и подготовка техники под холодные выезды и долгую работу.',
    accent: 'Холод и сезон',
    icon: Snowflake,
  },
  {
    id: 'expedition',
    name: 'Экспедиция и сервис',
    summary: 'Свет, топливо, измерение давления, крепления и полезное оснащение для автономного маршрута.',
    accent: 'Маршрут и быт',
    icon: ShieldCheck,
  },
];

const optionCategoryById: Record<string, Exclude<OptionsCategoryId, 'all'>> = {
  trailer: 'cargo',
  'tires-avtoros': 'traction',
  'tire-bagira': 'traction',
  'kofr-side-improved': 'cargo',
  'kofr-side-standard': 'cargo',
  'kofr-front': 'cargo',
  'kofr-rear-fabric': 'cargo',
  'kofr-rear-plastic': 'cargo',
  'kofr-rear-triple': 'cargo',
  'kofr-rear-triple-extreme': 'cargo',
  'frame-tent': 'cargo',
  'winch-stationary': 'traction',
  'winch-removable': 'traction',
  'light-bar': 'expedition',
  'canister-double': 'expedition',
  'canister-single': 'expedition',
  'seat-heat-driver': 'comfort',
  'seat-heat-both': 'comfort',
  'radiator-mount': 'traction',
  'akpp-cooling': 'traction',
  'gur-cooling': 'traction',
  'pnevmo-lock-both': 'traction',
  'pnevmo-lock-one': 'traction',
  'electric-lock-both': 'traction',
  'electric-lock-rear': 'traction',
  'mech-lock-rear': 'traction',
  'tent-parking': 'expedition',
  zip: 'expedition',
  preheater: 'comfort',
  manometer: 'expedition',
  'gun-mount': 'expedition',
  mudguards: 'traction',
  'front-protection': 'traction',
  'frame-tent-trailer': 'cargo',
  'frame-tent-eger-cabin': 'cargo',
  'frame-tent-eger-bed': 'cargo',
  'frame-tent-pickup': 'cargo',
  'frame-tent-sixwheel': 'cargo',
  'winch-stationary-6000': 'traction',
  'winch-stationary-8000': 'traction',
  'winch-removable-6000': 'traction',
  'winch-removable-8000': 'traction',
  'radiator-double': 'traction',
  'mech-lock-front': 'traction',
  'autonomous-air-heater': 'comfort',
  'side-seats-wings': 'cargo',
  'rear-soft-seats-sleeper': 'cargo',
  'rear-soft-seats-bed': 'cargo',
  'folding-table': 'expedition',
};

const featuredOptionIds = ['winch-stationary-8000', 'radiator-mount', 'frame-tent-pickup'];
const featuredModelSlugs = ['rosomaha-pickup-uaz-timken', 'rosomaha-extrime-plus', 'rosomaha-6x6'];

const optionsFaqs = [
  {
    question: 'Как понять, какие опции действительно нужны под мой маршрут?',
    answer:
      'Сначала смотрят не на список допов, а на задачу: сколько груза везёте, нужен ли тент, предстоят ли броды, глубокий снег, ночная работа или зимняя эксплуатация. После этого уже добирают лебёдки, отопление, кофры и защиту.',
  },
  {
    question: 'Все опции подходят к любой модели «Росомаха»?',
    answer:
      'Не всегда. Часть позиций универсальна, а часть зависит от базы, мостов, кузова и выбранной конфигурации. Поэтому перед заказом мы всегда уточняем совместимость под конкретную модель.',
  },
  {
    question: 'Можно ли сразу запросить расчёт техники вместе с опциями?',
    answer:
      'Да. Самый быстрый вариант — оставить заявку на подбор. Мы собираем конфигурацию сразу под задачу, чтобы не переплачивать за лишнее и не упустить важное оснащение.',
  },
];

function getOptionCategory(optionId: string): Exclude<OptionsCategoryId, 'all'> {
  return optionCategoryById[optionId] || 'expedition';
}

function sortOptions(options: Array<ProductOption & { category: Exclude<OptionsCategoryId, 'all'> }>, sortBy: SortMode) {
  const result = [...options];

  switch (sortBy) {
    case 'price-asc':
      return result.sort((left, right) => left.price - right.price);
    case 'price-desc':
      return result.sort((left, right) => right.price - left.price);
    case 'name':
      return result.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    case 'legacy':
    default:
      return result;
  }
}

export default function OptionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [sortBy, setSortBy] = useState<SortMode>('legacy');

  const activeCategory = (searchParams.get('category') as OptionsCategoryId | null) || 'all';
  const normalizedQuery = deferredQuery.trim().toLowerCase();

  const options = useMemo(
    () =>
      allProductOptions.map((option) => ({
        ...option,
        category: getOptionCategory(option.id),
      })),
    [],
  );

  const categoryCounts = useMemo(
    () =>
      optionCategories.reduce<Record<OptionsCategoryId, number>>(
        (counts, category) => {
          counts[category.id] =
            category.id === 'all' ? options.length : options.filter((option) => option.category === category.id).length;
          return counts;
        },
        { all: 0, traction: 0, cargo: 0, comfort: 0, expedition: 0 },
      ),
    [options],
  );

  const filteredOptions = useMemo(() => {
    const categoryFiltered =
      activeCategory === 'all' ? options : options.filter((option) => option.category === activeCategory);

    const queryFiltered = normalizedQuery
      ? categoryFiltered.filter((option) => {
          const specsText = option.specs ? Object.entries(option.specs).flat().join(' ').toLowerCase() : '';
          return `${option.name} ${specsText}`.toLowerCase().includes(normalizedQuery);
        })
      : categoryFiltered;

    return sortOptions(queryFiltered, sortBy);
  }, [activeCategory, normalizedQuery, options, sortBy]);

  const featuredOptions = useMemo(
    () =>
      featuredOptionIds
        .map((id) => options.find((option) => option.id === id))
        .filter((option): option is (typeof options)[number] => Boolean(option)),
    [options],
  );

  const featuredModels = useMemo(
    () =>
      featuredModelSlugs
        .map((slug) => catalogModels.find((model) => model.slug === slug))
        .filter((model): model is (typeof catalogModels)[number] => Boolean(model)),
    [],
  );

  const optionsWithImagesCount = useMemo(
    () => options.filter((option) => Boolean(resolveMediaUrl(option.image))).length,
    [options],
  );

  const compatibleModelsCount = useMemo(
    () => products.filter((product) => productOptions.every((option) => product.options.includes(option))).length,
    [],
  );

  const priceRange = useMemo(() => {
    const prices = options.map((option) => option.price);

    return {
      min: Math.min(...prices).toLocaleString('ru-RU'),
      max: Math.max(...prices).toLocaleString('ru-RU'),
    };
  }, [options]);

  const activeCategoryMeta = optionCategories.find((category) => category.id === activeCategory) || optionCategories[0];

  const handleCategoryChange = (categoryId: OptionsCategoryId) => {
    const nextParams = new URLSearchParams(searchParams);

    if (categoryId === 'all') {
      nextParams.delete('category');
    } else {
      nextParams.set('category', categoryId);
    }

    setSearchParams(nextParams);
  };

  const jumpToCatalog = (categoryId: OptionsCategoryId) => {
    handleCategoryChange(categoryId);
    document.getElementById('options-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className="pt-24 pb-20">
      <div className="container">
        <nav className="mb-8">
          <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <li>
              <Link to="/" className="transition-colors hover:text-foreground">
                Главная
              </Link>
            </li>
            <li>/</li>
            <li className="text-foreground">Опции</li>
          </ol>
        </nav>

        <section className="relative overflow-hidden rounded-[2rem] border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.2)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,114,32,0.22),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_34%)]" />
          <div className="relative grid gap-8 p-8 md:p-10 xl:grid-cols-[1.05fr,0.95fr] xl:p-12">
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
              <div className="mb-6 flex flex-wrap gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                  Отдельный каталог опций
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Лебёдки, тенты, кофры, отопители
                </span>
              </div>

              <h1 className="mb-6 text-4xl font-display font-bold leading-[0.98] tracking-tight md:text-5xl xl:text-6xl">
                Дополнительные опции для снегоболотоходов «Росомаха»
              </h1>

              <p className="mb-8 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
                Здесь собран основной каталог оснащения, которое чаще всего добавляют к технике под охоту, рыбалку,
                снабжение, тяжёлые маршруты и зимнюю эксплуатацию. Совместимость финально уточняем под конкретную
                модель и задачу.
              </p>

              <div className="mb-10 flex flex-col gap-4 sm:flex-row">
                <a href="#options-grid" className="btn-primary w-full px-6 text-base sm:w-auto sm:px-8 sm:text-lg">
                  Смотреть каталог опций
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
                <Link to="/order" className="btn-secondary w-full px-6 text-base sm:w-auto sm:px-8 sm:text-lg">
                  Запросить расчёт под технику
                </Link>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-[1.5rem] border border-border/70 bg-background/60 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Позиций</p>
                  <p className="mt-3 text-3xl font-display font-bold">{options.length}</p>
                  <p className="mt-2 text-sm text-muted-foreground">Полный список основных допов из текущего каталога.</p>
                </div>
                <div className="rounded-[1.5rem] border border-border/70 bg-background/60 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Совместимость</p>
                  <p className="mt-3 text-3xl font-display font-bold">{compatibleModelsCount}</p>
                  <p className="mt-2 text-sm text-muted-foreground">Карточек моделей уже используют общий каталог опций.</p>
                </div>
                <div className="rounded-[1.5rem] border border-border/70 bg-background/60 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Диапазон цен</p>
                  <p className="mt-3 text-3xl font-display font-bold">
                    {priceRange.min}–{priceRange.max}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">От простых экспедиционных вещей до тяжёлого оснащения.</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="grid gap-4 md:grid-cols-[1.1fr,0.9fr] xl:grid-cols-[1.08fr,0.92fr]"
            >
              {featuredOptions[0] && (
                <div className="relative min-h-[420px] overflow-hidden rounded-[1.75rem] border border-border/70 bg-secondary/30">
                  <img
                    src={resolveMediaUrl(featuredOptions[0].image)}
                    alt={featuredOptions[0].name}
                    className="h-full w-full object-cover"
                    loading="eager"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/18 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Опция для тяги</p>
                    <h2 className="mt-3 text-2xl font-display font-bold">{featuredOptions[0].name}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Частый выбор для тяжёлого маршрута, работы с грузом и уверенного выхода из сложных участков.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid gap-4">
                {featuredOptions.slice(1).map((option) => (
                  <div key={option.id} className="relative min-h-[200px] overflow-hidden rounded-[1.75rem] border border-border/70 bg-secondary/30">
                    <img
                      src={resolveMediaUrl(option.image)}
                      alt={option.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/12 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Часто добавляют</p>
                      <h2 className="mt-2 text-xl font-display font-bold">{option.name}</h2>
                    </div>
                  </div>
                ))}

                <div className="rounded-[1.75rem] border border-border/70 bg-background/65 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Фотографии в каталоге</p>
                  <p className="mt-3 text-3xl font-display font-bold">{optionsWithImagesCount}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Там, где архивная фотография есть, показываем реальное изображение. Остальные позиции выводим как
                    аккуратные карточки без битых превью.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-4">
          {optionCategories
            .filter((category) => category.id !== 'all')
            .map((category, index) => {
              const Icon = category.icon;
              const isActive = activeCategory === category.id;

              return (
                <motion.button
                  type="button"
                  key={category.id}
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => jumpToCatalog(category.id)}
                  className={`group rounded-[1.5rem] border p-5 text-left transition-all duration-300 ${
                    isActive
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-border bg-secondary/25 hover:border-primary/30 hover:bg-secondary/45'
                  }`}
                >
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                      {categoryCounts[category.id]}
                    </span>
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">{category.accent}</p>
                  <h2 className="mt-3 text-2xl font-display font-bold transition-colors group-hover:text-primary">
                    {category.name}
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{category.summary}</p>
                </motion.button>
              );
            })}
        </section>

        <section id="options-grid" className="mt-16 rounded-[2rem] border border-border bg-card p-6 md:p-8 lg:p-10">
          <div className="mb-10 flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">Подбор по задаче</p>
              <h2 className="mb-4 text-3xl font-display font-bold md:text-4xl">Быстро найдите нужное оснащение без случайных допов</h2>
              <p className="leading-relaxed text-muted-foreground">
                Сейчас выбрана категория: <span className="font-medium text-foreground">{activeCategoryMeta.name}</span>.{' '}
                {activeCategoryMeta.summary}
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-border/70 bg-background/70 px-5 py-4 text-sm text-muted-foreground">
              Найдено позиций: <span className="font-semibold text-foreground">{filteredOptions.length}</span>
            </div>
          </div>

          <div className="mb-8 rounded-[1.5rem] border border-border/70 bg-background/55 p-5 md:p-6">
            <div className="mb-5 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-primary">
              <SlidersHorizontal className="h-4 w-4" />
              Фильтры каталога опций
            </div>

            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap gap-2">
                {optionCategories.map((category) => (
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

              <div className="grid gap-4 lg:grid-cols-[1fr,280px]">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="input-premium pl-11"
                    placeholder="Поиск по названию или характеристике"
                  />
                </label>

                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortMode)}
                  className="w-full rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="legacy">По порядку каталога</option>
                  <option value="price-asc">Цена: по возрастанию</option>
                  <option value="price-desc">Цена: по убыванию</option>
                  <option value="name">По названию</option>
                </select>
              </div>
            </div>
          </div>

          {filteredOptions.length > 0 ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {filteredOptions.map((option, index) => {
                const categoryMeta = optionCategories.find((category) => category.id === option.category);
                const imageUrl = resolveMediaUrl(option.image);
                const specs = option.specs ? Object.entries(option.specs).slice(0, 3) : [];

                return (
                  <motion.article
                    key={option.id}
                    initial={{ opacity: 0, y: 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.03 }}
                    className="group overflow-hidden rounded-[1.5rem] border border-border bg-secondary/18"
                  >
                    <div className="relative aspect-[4/3] overflow-hidden border-b border-border/70 bg-background">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={option.name}
                          width={option.imageWidth}
                          height={option.imageHeight}
                          className={`h-full w-full transition-transform duration-500 group-hover:scale-[1.03] ${
                            option.imageFit === 'contain' ? 'object-contain' : 'object-cover'
                          }`}
                          loading="lazy"
                        />
                      ) : (
                        <div className="relative flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.18),transparent_56%)]">
                          <div className="flex flex-col items-center justify-center">
                            <Wrench className="h-10 w-10 text-primary/75" />
                            <span className="mt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                              Option
                            </span>
                          </div>
                        </div>
                      )}

                      {categoryMeta && (
                        <span className="absolute left-4 top-4 rounded-full border border-primary/25 bg-background/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary backdrop-blur">
                          {categoryMeta.name}
                        </span>
                      )}
                    </div>

                    <div className="space-y-4 p-5">
                      <div className="flex items-start justify-between gap-4">
                        <h3 className="text-xl font-display font-bold leading-tight">{option.name}</h3>
                        <span className="shrink-0 text-lg font-display font-bold text-primary">{option.priceFormatted}</span>
                      </div>

                      {specs.length > 0 && (
                        <dl className="grid gap-2 rounded-2xl border border-border/60 bg-background/45 p-4 text-sm">
                          {specs.map(([label, value]) => (
                            <div key={label} className="flex items-start justify-between gap-4">
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="font-medium text-foreground">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}

                      <p className="text-sm leading-relaxed text-muted-foreground">
                        Совместимость и итоговую конфигурацию уточняем под модель, мосты, нагрузку и сценарий эксплуатации.
                      </p>

                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Link to={`/order?option=${encodeURIComponent(option.id)}`} className="btn-primary w-full px-5 py-3 text-sm">
                          Запросить расчёт
                        </Link>
                        <Link to="/catalog" className="btn-secondary w-full px-5 py-3 text-sm">
                          К моделям
                        </Link>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-border/70 bg-background/50 p-10 text-center">
              <p className="mb-4 text-lg text-muted-foreground">По текущему фильтру и поиску совпадений пока не найдено.</p>
              <div className="flex flex-col justify-center gap-4 sm:flex-row">
                <button
                  onClick={() => {
                    handleCategoryChange('all');
                    setQuery('');
                    setSortBy('legacy');
                  }}
                  className="btn-secondary"
                >
                  Сбросить фильтры
                </button>
                <Link to="/order" className="btn-primary">
                  Подобрать оснащение с менеджером
                </Link>
              </div>
            </div>
          )}
        </section>

        <section className="mt-16 grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
          <div className="rounded-[1.75rem] border border-border bg-card p-6 md:p-8">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">Чаще комплектуют так</p>
            <h2 className="mb-4 text-3xl font-display font-bold md:text-4xl">Базовый набор под тяжёлую эксплуатацию и выезды вдаль</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.5rem] border border-border/70 bg-background/50 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">Маршрут и тяга</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Лебёдка, вынос радиатора, защита и блокировки чаще всего ставятся туда, где есть болото, тяжёлый снег,
                  колея и постоянная нагрузка на технику.
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-border/70 bg-background/50 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">Лагерь и груз</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Кофры, тенты и дополнительные сиденья добирают, когда машина работает на снабжении, охоте, рыбалке или
                  вахтовом маршруте с большим объёмом вещей.
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-border/70 bg-background/50 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">Холодный сезон</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Подогрев и автономное тепло особенно важны там, где технику заводят зимой, используют на длинных
                  стоянках и не хотят зависеть от компромиссов по комфорту.
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-border/70 bg-background/50 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">Экспедиционная мелочёвка</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Свет, канистры, манометр, крепления и ЗИП не выглядят самыми громкими покупками, но именно они чаще
                  всего спасают время и нервы на маршруте.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-border bg-card p-6 md:p-8">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">С чем связать опции</p>
            <h2 className="mb-4 text-3xl font-display font-bold md:text-4xl">Популярные модели, с которыми чаще всего собирают оснащение</h2>
            <div className="space-y-4">
              {featuredModels.map((model) => (
                <Link
                  key={model.slug}
                  to={`/catalog/${model.slug}`}
                  className="group flex items-center gap-4 rounded-[1.5rem] border border-border/70 bg-background/45 p-4 transition-colors hover:border-primary/35"
                >
                  <img src={model.image} alt={model.name} className="h-20 w-28 rounded-xl object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">{model.categoryName}</p>
                    <h3 className="mt-1 text-xl font-display font-bold transition-colors group-hover:text-primary">{model.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{model.priceFormatted}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-1" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-16">
          <div className="mb-8 max-w-3xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">FAQ по опциям</p>
            <h2 className="mb-4 text-3xl font-display font-bold md:text-4xl">Что чаще всего спрашивают перед комплектацией</h2>
            <p className="leading-relaxed text-muted-foreground">
              Ниже коротко собрали базовые ориентиры. Если задача нестандартная, лучше сразу идти в расчёт, потому что набор
              опций всегда зависит от модели, маршрута и режима работы техники.
            </p>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            {optionsFaqs.map((faq, index) => (
              <motion.article
                key={faq.question}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.06 }}
                className="rounded-[1.5rem] border border-border bg-card p-6"
              >
                <h3 className="text-2xl font-display font-bold">{faq.question}</h3>
                <p className="mt-4 leading-relaxed text-muted-foreground">{faq.answer}</p>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="mt-16 overflow-hidden rounded-[2rem] border border-border bg-card">
          <div className="grid gap-6 p-8 md:p-10 xl:grid-cols-[1fr,auto] xl:items-center xl:p-12">
            <div className="max-w-3xl">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">Следующий шаг</p>
              <h2 className="mb-4 text-3xl font-display font-bold md:text-5xl">Соберём технику и опции в одну конфигурацию под вашу задачу</h2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                Если уже понимаете маршрут, сезон и полезную нагрузку, дальше лучше не гадать по списку. Подберём модель,
                совместимые опции и дадим расчёт без лишних позиций.
              </p>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row xl:flex-col">
              <Link to="/order" className="btn-primary w-full px-6 text-base whitespace-normal sm:w-auto sm:text-lg xl:w-full">
                Получить расчёт
              </Link>
              <Link to="/catalog" className="btn-secondary w-full px-6 text-base whitespace-normal sm:w-auto sm:text-lg xl:w-full">
                Вернуться в каталог
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
