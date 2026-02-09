import { Link } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import { ArrowRight, Shield, Truck, Clock, Wrench, Snowflake, Trees, Waves, Droplets, Zap } from 'lucide-react';
import { useState, useRef, MouseEvent } from 'react';
import modelStandard from '@/assets/model-standard.jpg';
import modelExtreme from '@/assets/model-extreme.jpg';
import modelPickup from '@/assets/model-pickup.jpg';
import model6x6 from '@/assets/model-6x6.jpg';
import { models } from '@/data/models';
import ModelCard from '@/components/ModelCard';
import MagneticButton from '@/components/MagneticButton';
import ProductShowcase from '@/components/ProductShowcase';
import ApplicationsSection from '@/components/ApplicationsSection';

const stats = [
  { value: '1000+', label: 'Машин реализовано' },
  { value: '12', label: 'Лет на рынке' },
  { value: '100%', label: 'Гарантия качества' },
  { value: '24/7', label: 'Поддержка клиентов' },
];

const features = [
  {
    icon: Shield,
    title: 'Гарантия 6 месяцев',
    description: 'Гарантия 6 месяцев или 200 моточасов на всю технику.',
  },
  {
    icon: Truck,
    title: 'Доставка по всей России',
    description: 'Отправляем технику в любую точку РФ и стран таможенного союза.',
  },
  {
    icon: Clock,
    title: 'Быстрое производство',
    description: 'Изготовим вашу машину в кратчайшие сроки.',
  },
  {
    icon: Wrench,
    title: 'Индивидуальная сборка',
    description: 'Конфигуратор для выбора оптимальной комплектации.',
  },
];

const capabilities = [
  'Болота любой категории',
  'Заболоченная местность',
  'Снежная целина',
  'Грунтовые и лесные дороги',
  'Водные преграды',
];

export default function HomePage() {
  const featuredModels = models.slice(0, 12);

  return (
    <main>
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            className="absolute inset-0 w-full h-full object-cover"
          >
            <source src="/media/hero.mp4" type="video/mp4" />
          </video>
          <div className="hero-overlay absolute inset-0 z-[1]" />
        </div>

        <div className="container relative z-10 pt-20">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="max-w-4xl"
          >
            <h1 className="text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-display font-bold mb-6 leading-tight">
              Ваши возможности —{' '}
              <span className="text-gradient">безграничны!</span>
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-2xl">
              Квадроциклы-вездеходы РОСОМАХА. Российское производство,
              японская надёжность, проходимость без компромиссов.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-16">
              <Link to="/catalog" className="btn-primary">
                Смотреть каталог
                <ArrowRight className="ml-2 w-5 h-5" />
              </Link>
              <Link to="/order" className="btn-secondary">
                Заказать расчёт
              </Link>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {stats.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + index * 0.1, duration: 0.5 }}
                >
                  <p className="stats-number mb-2">{stat.value}</p>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Scroll Indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <div className="w-6 h-10 border-2 border-muted-foreground/30 rounded-full flex justify-center pt-2">
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-1.5 h-1.5 bg-primary rounded-full"
            />
          </div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-card">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="section-title">Почему выбирают нас</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Тюменский завод вездеходной техники — ваш надёжный партнёр с 2012 года
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="p-8 bg-secondary/30 rounded-lg border border-border/50 hover:border-primary/50 transition-colors"
              >
                <feature.icon className="w-12 h-12 text-primary mb-6" />
                <h3 className="font-display text-lg uppercase tracking-wider mb-3">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Models Section */}
      <section className="py-24">
        <div className="container">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-12">
            <div>
              <h2 className="section-title mb-2">Наши модели</h2>
              <p className="text-muted-foreground">
                Выберите вездеход под ваши задачи
              </p>
            </div>
            <Link
              to="/catalog"
              className="btn-secondary text-sm py-3 px-6"
            >
              Весь каталог
              <ArrowRight className="ml-2 w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {featuredModels.map((model, index) => (
              <ModelCard key={model.id} model={model} index={index} />
            ))}
          </div>
        </div>
      </section>

      {/* WOW Capabilities Section */}
      <CapabilitiesSection />

      {/* Applications Section */}
      <ApplicationsSection />

      {/* CTA Section */}
      <section className="py-24 bg-card">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto text-center"
          >
            <h2 className="section-title mb-6">
              Готовы обсудить <span className="text-gradient">ваш проект?</span>
            </h2>
            <p className="text-muted-foreground text-lg mb-8">
              Расскажите нам о ваших задачах — мы найдём оптимальное решение
              и подберём технику под ваши потребности.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/order" className="btn-primary">
                Оставить заявку
              </Link>
              <a href="tel:+73452564164" className="btn-secondary">
                +7 (3452) 564-164
              </a>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}

// WOW Capabilities Section Component
function CapabilitiesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.2 });

  const points = [
    {
      icon: Droplets,
      title: "Болота любой категории",
      desc: "Едет там, где «обычный» тонет"
    },
    {
      icon: Waves,
      title: "Заболоченная местность",
      desc: "Стабильный ход и контроль траектории"
    },
    {
      icon: Snowflake,
      title: "Снежная целина",
      desc: "Уверенное движение по рыхлому снегу"
    },
    {
      icon: Trees,
      title: "Грунтовые и лесные дороги",
      desc: "Тяга и проходимость на маршруте"
    },
    {
      icon: Zap,
      title: "Водные преграды",
      desc: "Заехали, прошли, выехали без подготовки"
    }
  ];

  return (
    <section
      ref={sectionRef}
      className="py-24 relative overflow-hidden bg-background"
    >
      {/* Background Decorative Elements */}
      <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-primary/5 blur-[120px] rounded-full" />
      <div className="absolute bottom-0 left-0 w-1/4 h-1/4 bg-primary/5 blur-[100px] rounded-full" />

      <div className="container relative z-10">
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-12 items-center">

          {/* Left: Video Showcase (60%) */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="lg:col-span-7 w-full relative group"
          >
            <div className="relative aspect-video rounded-[2rem] overflow-hidden shadow-2xl border border-white/10">
              <video
                src="/media/Robot.mp4"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                className="w-full h-full object-cover scale-105 group-hover:scale-100 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />

              {/* Overlaid Badges on Video */}
              <div className="absolute bottom-6 left-6 flex gap-3">
                <span className="bg-primary/90 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                  Проверено в деле
                </span>
                <span className="bg-white/20 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full border border-white/20">
                  Amphibious 100%
                </span>
              </div>
            </div>

            {/* Background Glow */}
            <div className="absolute -inset-4 bg-primary/10 blur-3xl -z-10 group-hover:bg-primary/20 transition-colors" />
          </motion.div>

          {/* Right: Content (40%) */}
          <div className="lg:col-span-5 w-full">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <div className="flex flex-wrap gap-2 mb-6">
                <span className="px-3 py-1 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest rounded-lg border border-primary/20">
                  Снег • Болото • Вода
                </span>
                <span className="px-3 py-1 bg-white/5 text-muted-foreground text-[10px] font-bold uppercase tracking-widest rounded-lg border border-white/10">
                  Без подготовки
                </span>
              </div>

              <h2 className="text-4xl md:text-5xl font-display font-bold mb-6 leading-[1.1]">
                Там, где другие встают — <br />
                <span className="text-gradient">«Росомаха» идёт</span>
              </h2>

              <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
                Снегоболотоходы «Росомаха» созданы для настоящего бездорожья:
                уверенно проходят рыхлый снег и топь, а водные преграды — без пауз
                и «ритуалов» перед входом в воду.
              </p>

              {/* Tiles Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
                {points.map((point, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={isInView ? { opacity: 1, scale: 1 } : {}}
                    transition={{ duration: 0.4, delay: 0.4 + idx * 0.1 }}
                    className={`p-4 rounded-xl border border-white/10 bg-surface/50 backdrop-blur-sm group hover:border-primary/30 hover:bg-surface transition-all duration-300 ${idx === 4 ? 'sm:col-span-2' : ''}`}
                  >
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                        <point.icon className="w-4 h-4" />
                      </div>
                      <h4 className="font-bold text-sm tracking-tight">{point.title}</h4>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-tight pl-11">
                      {point.desc}
                    </p>
                  </motion.div>
                ))}
              </div>

              {/* CTAs */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link to="/catalog" className="btn-primary py-4 px-8 text-base">
                    Получить КП
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Link>
                  <Link to="/contacts" className="btn-secondary py-4 px-8 text-base">
                    Тест-драйв
                  </Link>
                </div>
                <p className="text-[11px] text-muted-foreground/60 text-center sm:text-left">
                  Ответим и подберём конфигурацию 4×4 или 6×6 под вашу задачу
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
