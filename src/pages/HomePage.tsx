import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Shield, Truck, Clock, Wrench } from 'lucide-react';
import heroImage from '@/assets/hero-atv.jpg';
import modelStandard from '@/assets/model-standard.jpg';
import modelExtreme from '@/assets/model-extreme.jpg';
import modelPickup from '@/assets/model-pickup.jpg';
import model6x6 from '@/assets/model-6x6.jpg';
import { models } from '@/data/models';
import ModelCard from '@/components/ModelCard';

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
  const featuredModels = models.slice(0, 6);

  return (
    <main>
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <img
            src={heroImage}
            alt="Снегоболотоход Росомаха"
            className="w-full h-full object-cover"
          />
          <div className="hero-overlay absolute inset-0" />
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

      {/* Capabilities Section */}
      <section className="py-24 bg-card relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <img
            src={model6x6}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
        <div className="container relative z-10">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="section-title mb-6">
                Передвигайтесь там,{' '}
                <span className="text-gradient">где другие застревают</span>
              </h2>
              <p className="text-muted-foreground text-lg mb-8">
                Снегоболотоходы «Росомаха» позволяют передвигаться в условиях 
                полного бездорожья. Наша техника преодолевает водные преграды 
                без какой-либо подготовки.
              </p>
              <ul className="space-y-4 mb-8">
                {capabilities.map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="w-2 h-2 bg-primary rounded-full" />
                    <span className="text-lg">{item}</span>
                  </li>
                ))}
              </ul>
              <Link to="/company" className="btn-primary">
                О компании
                <ArrowRight className="ml-2 w-5 h-5" />
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="relative"
            >
              <img
                src={modelExtreme}
                alt="Росомаха в действии"
                className="rounded-lg glow-orange"
              />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Applications Section */}
      <section className="py-24">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="section-title">Применение техники</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Снегоболотоход эффективен для различных профессиональных задач
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                title: 'Снабжение полевых лагерей',
                description: 'Оперативная доставка без использования вертолётов на удалении до 200-300 км от населённых пунктов.',
                image: modelPickup,
              },
              {
                title: 'Обслуживание ЛЭП',
                description: 'Для обслуживания магистральных и местных линий электропередач ЛЭП 500, 220 и 110 КВ.',
                image: modelExtreme,
              },
              {
                title: 'Ремонт трубопроводов',
                description: 'Для обслуживания и ремонта трубопроводов различного назначения в труднодоступных местах.',
                image: modelStandard,
              },
              {
                title: 'Перевозка людей',
                description: 'Для перевозки людей и продуктов питания в труднодоступные районы.',
                image: model6x6,
              },
            ].map((item, index) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="card-premium group"
              >
                <div className="relative aspect-video overflow-hidden">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
                </div>
                <div className="p-6">
                  <h3 className="font-display text-xl uppercase tracking-wider mb-3">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

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
