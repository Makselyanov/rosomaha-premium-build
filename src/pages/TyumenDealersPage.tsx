import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock, Factory, Mail, MapPin, Phone, Wrench } from 'lucide-react';

import DealerMiniMap from '@/components/DealerMiniMap';
import { dealers } from '@/data/models';

const tyumenLocations = dealers.filter((dealer) => dealer.region === 'Тюменская область');

export default function TyumenDealersPage() {
  return (
    <main className="pt-24 pb-20">
      <div className="container">
        <nav className="mb-8">
          <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <li><Link to="/" className="hover:text-foreground">Главная</Link></li>
            <li>/</li>
            <li><Link to="/dealers" className="hover:text-foreground">Дилеры</Link></li>
            <li>/</li>
            <li className="text-foreground">Тюмень</li>
          </ol>
        </nav>

        <section className="relative overflow-hidden rounded-[2rem] border border-border bg-card p-8 md:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,114,32,0.2),transparent_45%)]" />
          <div className="relative max-w-4xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-primary">Производство и подбор в Тюменской области</p>
            <h1 className="mb-6 text-4xl font-display font-bold leading-tight md:text-6xl">
              Снегоболотоходы «Росомаха» в Тюмени
            </h1>
            <p className="max-w-3xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              В Тюменской области можно обратиться напрямую к производителю в посёлке Московский или к независимому
              партнёру Rosomaha Club в Тюмени. Здесь собраны проверенные адреса, телефоны и понятный порядок подбора
              техники под маршрут.
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Link to="/catalog" className="btn-primary">Сравнить модели <ArrowRight className="ml-2 h-5 w-5" /></Link>
              <Link to="/order" className="btn-secondary">Получить расчёт</Link>
            </div>
          </div>
        </section>

        <section className="mt-12 grid gap-6 lg:grid-cols-2">
          {tyumenLocations.map((dealer) => (
            <article key={dealer.id} className="card-premium flex flex-col p-6 md:p-8">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  {dealer.type === 'factory' ? <Factory className="h-6 w-6" /> : <Wrench className="h-6 w-6" />}
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                    {dealer.type === 'factory' ? 'Производитель' : 'Клуб и партнёр'}
                  </p>
                  <h2 className="text-2xl font-display font-bold">{dealer.city}</h2>
                </div>
              </div>

              <DealerMiniMap
                lat={dealer.coordinates.lat}
                lng={dealer.coordinates.lng}
                title={`${dealer.city} — Росомаха`}
                address={dealer.address}
              />

              <div className="mt-6 space-y-3 text-sm">
                <p className="flex items-start gap-3"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{dealer.address}</p>
                <a className="flex items-center gap-3 hover:text-primary" href={`tel:${dealer.phone.replace(/[^\d+]/g, '')}`}>
                  <Phone className="h-4 w-4 text-primary" />{dealer.phone}
                </a>
                {dealer.phone2 && (
                  <a className="flex items-center gap-3 hover:text-primary" href={`tel:${dealer.phone2.replace(/[^\d+]/g, '')}`}>
                    <Phone className="h-4 w-4 text-primary" />{dealer.phone2}
                  </a>
                )}
                {dealer.email && (
                  <a className="flex items-center gap-3 hover:text-primary" href={`mailto:${dealer.email}`}>
                    <Mail className="h-4 w-4 text-primary" />{dealer.email}
                  </a>
                )}
                <p className="flex items-center gap-3 text-muted-foreground"><Clock className="h-4 w-4 text-primary" />{dealer.workHours}</p>
              </div>

              <p className="mt-6 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
                {dealer.type === 'factory'
                  ? 'Обращайтесь сюда по вопросам актуальных комплектаций, заказа у производителя, документов и готовности техники.'
                  : 'Партнёрская точка помогает познакомиться с техникой и обсудить эксплуатацию. Наличие конкретной модели уточняйте заранее по телефону.'}
              </p>
            </article>
          ))}
        </section>

        <section className="mt-12 rounded-[2rem] border border-border bg-card p-7 md:p-10">
          <div className="grid gap-10 lg:grid-cols-[0.9fr,1.1fr]">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">Как подготовиться к обращению</p>
              <h2 className="mb-4 text-3xl font-display font-bold md:text-4xl">Подбор начинается с маршрута</h2>
              <p className="leading-relaxed text-muted-foreground">
                Чтобы менеджер предложил подходящую версию, сообщите район эксплуатации, тип покрытия, число людей,
                примерный груз и необходимость грузовой площадки или прицепа. Это полезнее, чем начинать разговор с одной характеристики.
              </p>
            </div>
            <ol className="grid gap-4 sm:grid-cols-2">
              {[
                'Сравните классы техники и отметьте подходящие модели.',
                'Опишите маршрут, сезон, пассажиров и груз.',
                'Уточните актуальную комплектацию, цену и срок готовности.',
                'Согласуйте осмотр, документы, оплату и доставку.',
              ].map((item, index) => (
                <li key={item} className="flex gap-3 rounded-2xl border border-border bg-secondary/20 p-5">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span><strong className="mr-2">{index + 1}.</strong>{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mt-12 text-center">
          <h2 className="mb-4 text-3xl font-display font-bold">Нужна «Росомаха» для Тюмени или Севера?</h2>
          <p className="mx-auto mb-7 max-w-2xl text-muted-foreground">
            Оставьте одну заявку с описанием условий. Она попадёт в CRM производителя вместе со страницей обращения и источником перехода.
          </p>
          <Link to="/order" className="btn-primary">Описать задачу и получить расчёт</Link>
        </section>
      </div>
    </main>
  );
}
