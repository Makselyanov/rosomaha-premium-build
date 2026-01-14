import { useEffect } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    ArrowRight,
    CheckCircle2,
    AlertTriangle,
    HelpCircle,
    Map,
    Settings,
    Shield,
    Clock,
    Search,
    ChevronRight,
    Home,
    Anchor,
    Activity,
    Compass,
    Layers,
    Cpu,
    LifeBuoy,
    Weight,
    Zap,
    Truck
} from 'lucide-react';
import { applications } from '@/data/applications';

export default function ApplicationDetailPage() {
    const { slug } = useParams();
    const application = applications.find(app => app.slug === slug);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [slug]);

    if (!application) {
        return <Navigate to="/applications" replace />;
    }

    return (
        <main className="min-h-screen bg-background pt-20">
            {/* Breadcrumbs */}
            <div className="container py-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Link to="/" className="hover:text-primary transition-colors">
                        <Home className="w-4 h-4" />
                    </Link>
                    <ChevronRight className="w-4 h-4" />
                    <Link to="/applications" className="hover:text-primary transition-colors">
                        Сферы применения
                    </Link>
                    <ChevronRight className="w-4 h-4" />
                    <span className="text-foreground truncate">{application.shortTitle}</span>
                </div>
            </div>

            {/* Hero Section */}
            <section className="relative min-h-[70vh] flex items-center overflow-hidden">
                <div className="absolute inset-0 z-0">
                    <img
                        src={application.image || '/media/placeholder-hero.jpg'}
                        alt={application.heroTitle}
                        className="w-full h-full object-cover grayscale-[0.2] brightness-[0.4] contrast-[1.1]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
                    <div className="absolute inset-0 bg-background/20" />
                </div>

                <div className="container relative z-10 py-20">
                    <motion.div
                        initial={{ opacity: 0, x: -30 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="max-w-2xl"
                    >
                        <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-6 ${application.category === 'professional'
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            : 'bg-green-500/20 text-green-400 border border-green-500/30'
                            }`}>
                            {application.category === 'professional' ? 'Профессиональное решение' : 'Отдых и туризм'}
                        </div>

                        <h1 className="text-4xl md:text-5xl lg:text-7xl font-display font-bold mb-6 leading-[1.1] tracking-tight">
                            {application.heroTitle}
                        </h1>
                        <p className="text-xl md:text-2xl text-muted-foreground mb-8 leading-relaxed max-w-xl">
                            {application.heroDescription}
                        </p>

                        <div className="flex flex-col sm:flex-row gap-6">
                            <Link to="/catalog" className="btn-primary group">
                                Рассчитать стоимость
                                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <Link to="/contacts" className="btn-secondary">
                                Проконсультироваться
                            </Link>
                        </div>

                        {/* SEO Badges */}
                        <div className="mt-12 flex flex-wrap gap-6 text-white/50">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm">
                                <CheckCircle2 className="w-4 h-4 text-primary" />
                                <span className="text-xs font-bold uppercase tracking-widest">В наличии</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm">
                                <Shield className="w-4 h-4 text-primary" />
                                <span className="text-xs font-bold uppercase tracking-widest">Гарантия 5 лет</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm">
                                <Clock className="w-4 h-4 text-primary" />
                                <span className="text-xs font-bold uppercase tracking-widest">Быстрая доставка</span>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Decoration */}
                <div className="absolute top-0 right-0 w-1/3 h-full bg-[radial-gradient(circle_at_50%_50%,rgba(255,100,0,0.1),transparent)] pointer-events-none" />
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 text-white/40 pointer-events-none">
                    <span className="text-[10px] uppercase tracking-[0.3em] font-bold">Scroll to explore</span>
                    <div className="w-px h-16 bg-gradient-to-b from-primary/60 to-transparent" />
                </div>
            </section>

            {/* Pain vs Solution Block */}
            <section className="py-16 md:py-24 relative overflow-hidden bg-background">
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
                    style={{ backgroundImage: `radial-gradient(var(--primary) 1px, transparent 0)`, backgroundSize: '40px 40px' }} />

                <div className="container relative z-10">
                    <div className="grid md:grid-cols-2 gap-px bg-border overflow-hidden rounded-3xl border border-border shadow-2xl">
                        {/* Pain */}
                        <div className="p-8 md:p-12 bg-card relative group transition-colors hover:bg-muted/5">
                            <div className="absolute top-6 left-6 text-destructive/10 uppercase font-black text-3xl select-none group-hover:text-destructive/20 transition-colors">PROBLEM</div>
                            <div className="relative z-10">
                                <div className="w-12 h-12 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center mb-6 transition-transform group-hover:scale-110">
                                    <AlertTriangle className="w-6 h-6" />
                                </div>
                                <h3 className="text-lg font-bold mb-4 text-destructive/80 uppercase tracking-widest">Мнение большинства:</h3>
                                <p className="text-xl md:text-2xl text-muted-foreground leading-relaxed italic font-light">
                                    «{application.pain}»
                                </p>
                            </div>
                        </div>

                        {/* Solution */}
                        <div className="p-8 md:p-12 bg-card relative group transition-colors hover:bg-primary/5">
                            <div className="absolute top-6 left-6 text-primary/10 uppercase font-black text-3xl select-none group-hover:text-primary/20 transition-colors">SOLUTION</div>
                            <div className="relative z-10">
                                <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-6 transition-transform group-hover:scale-110 shadow-[0_0_20px_rgba(255,100,0,0.15)]">
                                    <CheckCircle2 className="w-6 h-6" />
                                </div>
                                <h3 className="text-lg font-bold mb-4 text-primary uppercase tracking-widest">Росомаха решает:</h3>
                                <p className="text-xl md:text-2xl text-foreground leading-relaxed font-bold">
                                    {application.solution}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Professional Expertise Section */}
            <section className="py-20 bg-background overflow-hidden">
                <div className="container">
                    <div className="flex flex-col md:flex-row gap-12 items-center">
                        <div className="flex-1 order-2 md:order-1">
                            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
                                {application.category === 'professional' ? 'Инженерное превосходство в деталях' : 'Ваш личный остров безопасности'}
                            </h2>
                            <div className="prose prose-invert max-w-none text-muted-foreground space-y-6">
                                {application.category === 'professional' ? (
                                    <>
                                        <p className="text-lg leading-relaxed">
                                            Доставка грузов и вахты в условиях полного отсутствия дорог требует не просто «проходимой» техники, а инженерного совершенства. Вездеходы Росомаха спроектированы так, чтобы минимизировать удельное давление на грунт до <strong>0.1 кг/см²</strong>, что позволяет им буквально «парить» над болотом.
                                        </p>
                                        <p className="text-lg leading-relaxed">
                                            Герметичный стальной корпус и огромные колеса делают вездеход непотопляемым. При случайном падении в полынью или необходимости форсировать реку, машина превращается в надежный катер, сохраняя экипаж и ценный груз в безопасности.
                                        </p>
                                        <p className="text-lg leading-relaxed border-l-4 border-primary/50 pl-6 italic">
                                            <strong>Агрегатная база Toyota</strong> — это наш осознанный выбор. В условиях, когда до ближайшего сервиса 500 км тайги, надежность — это единственный параметр, который имеет значение.
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-lg leading-relaxed">
                                            Трофейная рыбалка и семейный отдых в диких местах — это прежде всего уверенность. Росомаха прощает ошибки навигации и не боится тонкого льда или внезапного разлива рек. Там, где обычный джип утонет, а снегоход провалится — вы продолжите путь.
                                        </p>
                                        <p className="text-lg leading-relaxed">
                                            В отличие от открытой техники, Росомаха предлагает комфорт закрытой кабины с <strong>автономным отопителем</strong>. Здесь можно согреться, переодеться и полноценно выспаться в тепле, не опасаясь гнуса или диких животных.
                                        </p>
                                        <p className="text-lg leading-relaxed border-l-4 border-primary/50 pl-6 italic font-medium">
                                            Это не просто транспорт, это ваша автономная база, которая всегда рядом с уловистой точкой или живописной поляной.
                                        </p>
                                    </>
                                )}
                            </div>
                            <div className="mt-8">
                                <Link to="/catalog" className="btn-primary">
                                    Выбрать свою Росомаху
                                    <ArrowRight className="ml-2 w-5 h-5" />
                                </Link>
                            </div>
                        </div>
                        <div className="flex-1 order-1 md:order-2 relative">
                            <div className="relative z-10 rounded-3xl overflow-hidden shadow-2xl border border-white/10 aspect-video">
                                <img
                                    src={application.image}
                                    className="w-full h-full object-cover"
                                    alt="Technical Excellence"
                                />
                                <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent" />
                            </div>
                            <div className="absolute -top-6 -right-6 w-32 h-32 bg-primary/20 blur-3xl rounded-full" />
                            <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-primary/10 blur-3xl rounded-full" />
                        </div>
                    </div>
                </div>
            </section>

            {/* Situations */}
            <section id="situations" className="py-20">
                <div className="container">
                    <h2 className="section-title mb-12">Типичные ситуации</h2>
                    <div className={`grid md:grid-cols-2 ${application.situations.length % 3 === 0 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-8`}>
                        {application.situations.map((situation, idx) => (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: idx * 0.1 }}
                                key={idx}
                                className="group bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/30 transition-all duration-500 hover:shadow-2xl hover:shadow-primary/5"
                            >
                                {situation.image && (
                                    <div className="aspect-[16/10] overflow-hidden relative">
                                        <img
                                            src={situation.image}
                                            alt={situation.title}
                                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-card/80 via-transparent to-transparent opacity-80" />
                                        <div className="absolute bottom-4 left-4 right-4 text-white">
                                            <span className="text-xs font-bold uppercase tracking-widest opacity-70 mb-1 block">Кейс</span>
                                            <h3 className="text-lg font-bold leading-tight line-clamp-2">
                                                {situation.title}
                                            </h3>
                                        </div>
                                    </div>
                                )}
                                <div className="p-6">
                                    <p className="text-muted-foreground leading-relaxed text-sm">
                                        {situation.description}
                                    </p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Economic Comparison / SEO Power Section */}
            {(application.slug === 'dostavka-gruzov' || application.slug === 'spasraboty') && (
                <section className="py-20 bg-primary/5">
                    <div className="container">
                        <div className="grid lg:grid-cols-2 gap-12 items-center">
                            <div>
                                <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">Экономика вопроса: почему Росомаха выгоднее?</h2>
                                <p className="text-lg text-muted-foreground mb-8 leading-relaxed italic border-l-4 border-primary pl-6">
                                    "В условиях Крайнего Севера и бездорожья, цена ошибки — это не только деньги, но и сорванные сроки, а порой и жизни. Мы создали инструмент, который минимизирует риски."
                                </p>

                                <ul className="space-y-6">
                                    <li className="flex gap-4 p-4 rounded-xl bg-background/50 border border-border/50 hover:border-primary/30 transition-colors">
                                        <div className="w-10 h-10 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center shrink-0">
                                            <Zap className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h4 className="font-bold mb-1">Окупаемость за один сезон</h4>
                                            <p className="text-sm text-muted-foreground">Затраты на фрахт вертолета на 50 моточасов полностью покрывают стоимость нового вездехода.</p>
                                        </div>
                                    </li>
                                    <li className="flex gap-4 p-4 rounded-xl bg-background/50 border border-border/50 hover:border-primary/30 transition-colors">
                                        <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                                            <Weight className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h4 className="font-bold mb-1">Грузоподъемность без компромиссов</h4>
                                            <p className="text-sm text-muted-foreground">Везет до 1000 кг (с прицепом), потребляя при этом всего 15-20 литров бензина АИ-92 в час.</p>
                                        </div>
                                    </li>
                                </ul>
                            </div>

                            <div className="bg-card border border-border rounded-3xl p-8 shadow-inner">
                                <h3 className="text-xl font-bold mb-6 text-center">Сравнение стоимости доставки (1 тонна / 100 км)</h3>
                                <div className="space-y-8">
                                    <div>
                                        <div className="flex justify-between mb-2 text-sm font-bold uppercase tracking-wider">
                                            <span>Вертолет (Ми-8)</span>
                                            <span className="text-destructive">от 250 000 ₽</span>
                                        </div>
                                        <div className="w-full h-4 bg-surface rounded-full overflow-hidden">
                                            <div className="w-full h-full bg-destructive" />
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex justify-between mb-2 text-sm font-bold uppercase tracking-wider">
                                            <span>Гусеничный тягач</span>
                                            <span className="text-orange-500">от 45 000 ₽</span>
                                        </div>
                                        <div className="w-full h-4 bg-surface rounded-full overflow-hidden">
                                            <div className="w-[40%] h-full bg-orange-500" />
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex justify-between mb-2 text-sm font-bold uppercase tracking-wider">
                                            <span>Росомаха 6х6</span>
                                            <span className="text-primary">от 5 000 ₽</span>
                                        </div>
                                        <div className="w-full h-4 bg-surface rounded-full overflow-hidden">
                                            <div className="w-[10%] h-full bg-primary" />
                                        </div>
                                    </div>
                                </div>
                                <p className="mt-8 text-xs text-muted-foreground text-center">
                                    * Расчетные данные основаны на средней стоимости ГСМ и обслуживания при эксплуатации в условиях тяжелого бездорожья.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* Statistics / Confidence Bar */}
            <section className="py-16 bg-card border-y border-border relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,100,0,0.05),transparent)] pointer-events-none" />
                <div className="container relative z-10">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
                        <div className="flex flex-col items-center text-center group">
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-125 transition-transform duration-500">
                                <Weight className="w-6 h-6" />
                            </div>
                            <div className="text-4xl font-display font-bold text-primary mb-2">
                                {application.category === 'professional' ? '1200' : '1000'}+ кг
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Грузоподъемность</div>
                        </div>
                        <div className="flex flex-col items-center text-center group">
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-125 transition-transform duration-500">
                                <Compass className="w-6 h-6" />
                            </div>
                            <div className="text-4xl font-display font-bold text-primary mb-2">45°</div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Преодолимый уклон</div>
                        </div>
                        <div className="flex flex-col items-center text-center group">
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-125 transition-transform duration-500">
                                <Zap className="w-6 h-6" />
                            </div>
                            <div className="text-4xl font-display font-bold text-primary mb-2">-50°C</div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Температурный режим</div>
                        </div>
                        <div className="flex flex-col items-center text-center group">
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-125 transition-transform duration-500">
                                <Shield className="w-6 h-6" />
                            </div>
                            <div className="text-4xl font-display font-bold text-primary mb-2">5 лет</div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Гарантия на металл</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Advantages */}
            <section className="py-20 bg-surface relative overflow-hidden">
                <div className="container relative z-10">
                    <h2 className="section-title mb-12">Почему именно Росомаха?</h2>
                    <div className={`grid md:grid-cols-2 ${(application.rosomahaAdvantages.length + 1) % 3 === 0 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-6`}>
                        {application.rosomahaAdvantages.map((adv, idx) => {
                            const IconComponent = (() => {
                                switch (adv.icon) {
                                    case 'shield': return Shield;
                                    case 'anchor': return Anchor;
                                    case 'activity': return Activity;
                                    case 'compass': return Compass;
                                    case 'layers': return Layers;
                                    case 'cpu': return Cpu;
                                    case 'life-buoy': return LifeBuoy;
                                    case 'weight': return Weight;
                                    case 'zap': return Zap;
                                    case 'truck': return Truck;
                                    default: return Shield;
                                }
                            })();

                            return (
                                <div key={idx} className="bg-background/50 backdrop-blur-sm border border-border p-6 rounded-2xl hover:border-primary/50 transition-colors group">
                                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 text-primary group-hover:scale-110 transition-transform">
                                        <IconComponent className="w-6 h-6" />
                                    </div>
                                    <h3 className="text-lg font-bold mb-2 uppercase tracking-wide">{adv.title}</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed">{adv.description}</p>
                                </div>
                            );
                        })}
                        {/* Always show reliability */}
                        <div className="bg-background/50 backdrop-blur-sm border border-border p-6 rounded-2xl">
                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 text-primary">
                                <Clock className="w-6 h-6" />
                            </div>
                            <h3 className="text-lg font-bold mb-2">Надежность Toyota</h3>
                            <p className="text-sm text-muted-foreground">Двигатель и АКПП Toyota — миллионники. Простые и доступные запчасти.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Typical Route Timeline */}
            <section className="py-20">
                <div className="container">
                    <h2 className="section-title mb-12 text-center">Один день из жизни: {application.typicalRoute.title}</h2>
                    <div className="max-w-3xl mx-auto">
                        <div className="relative border-l-2 border-primary/30 ml-4 md:ml-8 space-y-12 pl-8 md:pl-12 py-4">
                            {application.typicalRoute.scenario.map((step, idx) => (
                                <div key={idx} className="relative">
                                    <div className="absolute -left-[41px] md:-left-[58px] top-1 w-5 h-5 md:w-6 md:h-6 rounded-full bg-background border-4 border-primary z-10" />
                                    <p className="text-lg text-foreground font-medium">{step}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* Cost of Mistake */}
            <section className="py-20 bg-destructive/5">
                <div className="container">
                    <div className="max-w-4xl mx-auto text-center">
                        <h2 className="text-3xl font-bold mb-8 text-destructive">Цена ошибки</h2>
                        <div className="grid md:grid-cols-2 gap-6 text-left">
                            {application.costOfMistake.map((cost, idx) => (
                                <div key={idx} className="bg-background border border-destructive/20 p-6 rounded-xl flex items-start gap-4 shadow-sm hover:border-destructive transition-colors">
                                    <div className="bg-destructive/10 p-2 rounded-lg text-destructive shrink-0">
                                        <AlertTriangle className="w-6 h-6" />
                                    </div>
                                    <p className="font-medium text-lg leading-snug">{cost}</p>
                                </div>
                            ))}
                        </div>
                        <p className="mt-8 text-muted-foreground font-medium">
                            Не рискуйте задачами и безопасностью. Выбирайте проверенную технику.
                        </p>
                    </div>
                </div>
            </section>

            {/* Recommended Configs */}
            <section className="py-20 bg-surface relative overflow-hidden">
                <div className="container relative z-10">
                    <h2 className="section-title mb-12">Рекомендуемые комплектации</h2>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {application.recommendedConfigurations.map((config, idx) => (
                            <div key={idx} className="bg-card border border-border rounded-xl p-6 flex flex-col hover:shadow-xl transition-shadow duration-300">
                                <h3 className="text-xl font-bold mb-2">{config.name}</h3>
                                <p className="text-sm text-muted-foreground mb-6">{config.description}</p>

                                <ul className="space-y-3 mb-8 flex-grow">
                                    {config.features.map((feature, fIdx) => (
                                        <li key={fIdx} className="flex items-center gap-2 text-sm">
                                            <CheckCircle2 className="w-4 h-4 text-primary" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <Link
                                    to={config.modelSlug ? `/catalog/${config.modelSlug}` : "/catalog"}
                                    className="btn-secondary w-full justify-center"
                                >
                                    Собрать такую
                                </Link>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* FAQ */}
            <section className="py-24 bg-background">
                <div className="container max-w-4xl">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-display font-bold mb-4">Отвечаем на вопросы</h2>
                        <p className="text-muted-foreground text-lg">Всё, что нужно знать об эксплуатации Росомахи для задачи: {application.title}</p>
                    </div>

                    <div className="grid gap-4">
                        {application.faqs.map((faq, idx) => (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: idx * 0.05 }}
                                key={idx}
                                className="group bg-surface/50 border border-border rounded-2xl p-6 md:p-8 hover:bg-surface hover:border-primary/20 transition-all duration-300"
                            >
                                <h3 className="text-xl font-bold mb-4 flex items-start gap-4 text-foreground group-hover:text-primary transition-colors">
                                    <div className="mt-1 bg-primary/10 p-1.5 rounded-lg text-primary shrink-0">
                                        <HelpCircle className="w-5 h-5" />
                                    </div>
                                    {faq.question}
                                </h3>
                                <div className="pl-12">
                                    <p className="text-muted-foreground text-lg leading-relaxed border-l-2 border-primary/10 pl-6">
                                        {faq.answer}
                                    </p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Bottom CTA */}
            <section className="py-32 relative overflow-hidden text-white">
                <div className="absolute inset-0 z-0">
                    <img
                        src={application.ctaBackground || application.image}
                        alt="Background"
                        className="w-full h-full object-cover grayscale brightness-[0.3] contrast-[1.2]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
                    <div className="absolute inset-0 bg-primary/20 mix-blend-multiply" />
                </div>

                <div className="container relative z-10 text-center">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                    >
                        <h2 className="text-4xl md:text-6xl font-display font-bold mb-8 tracking-tight">
                            Готовы покорять бездорожье?
                        </h2>
                        <p className="text-xl md:text-2xl text-white/80 mb-12 max-w-3xl mx-auto leading-relaxed">
                            Оставьте заявку сегодня, и мы поможем подобрать идеальную комплектацию, которая прослужит вам десятилетиями.
                        </p>
                        <div className="flex flex-col sm:flex-row justify-center gap-6">
                            <Link to="/catalog" className="btn-primary px-12 py-6 text-xl shadow-2xl shadow-primary/40">
                                Рассчитать стоимость
                                <ArrowRight className="ml-2 w-6 h-6" />
                            </Link>
                            <Link to="/contacts" className="btn-secondary px-12 py-6 text-xl">
                                Связаться с менеджером
                            </Link>
                        </div>
                    </motion.div>
                </div>
            </section>
        </main>
    );
}
