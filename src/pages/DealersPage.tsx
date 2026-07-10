import { Link } from 'react-router-dom';
import { MapPin, Phone, Mail, Clock, ExternalLink, Factory } from 'lucide-react';
import { dealers } from '@/data/models';
import SEO from '@/components/SEO';
import DealerMiniMap from '@/components/DealerMiniMap';

export default function DealersPage() {
  const partners = dealers.filter((d) => d.type === 'partner');
  const mainDealers = dealers.filter((d) => d.type !== 'partner');

  const groupedDealers = mainDealers.reduce((acc, dealer) => {
    if (!acc[dealer.region]) {
      acc[dealer.region] = [];
    }
    acc[dealer.region].push(dealer);
    return acc;
  }, {} as Record<string, typeof dealers>);

  return (
    <main className="pt-24 pb-16">
      <SEO
        title="Дилеры вездеходов Росомаха по всей России"
        description="Официальные дилеры снегоболотоходов Росомаха. Найдите ближайшего дилера в вашем регионе для покупки и обслуживания вездехода."
        canonical="/dealers"
        breadcrumbs={[
          { name: "Главная", url: "/" },
          { name: "Дилерам", url: "/dealers" },
        ]}
      />
      <div className="container">
        {/* Breadcrumbs */}
        <nav className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-muted-foreground">
            <li>
              <Link to="/" className="hover:text-foreground transition-colors">
                Главная
              </Link>
            </li>
            <li>/</li>
            <li className="text-foreground">Дилеры</li>
          </ol>
        </nav>

        {/* Header */}
        <div className="mb-12">
          <h1 className="section-title mb-4">Дилерская сеть</h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Официальные дилеры снегоболотоходов «Росомаха» в регионах России.
            Найдите ближайший центр продаж и обслуживания.
          </p>
        </div>

        {/* Dealers by Region */}
        <div className="space-y-12">
          {Object.entries(groupedDealers).map(([region, regionDealers]) => (
            <section key={region}>
              <h2 className="font-display text-2xl uppercase tracking-wider mb-6 text-primary">
                {region}
              </h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {regionDealers.map((dealer) => (
                  <div
                    key={dealer.id}
                    className={`card-premium p-6 flex flex-col ${dealer.type === 'factory' ? 'border-primary/40 ring-1 ring-primary/20' : ''}`}
                  >
                    {dealer.type === 'factory' && (
                      <div className="flex items-center gap-2 mb-3">
                        <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full border border-primary/30">
                          <Factory className="w-3.5 h-3.5" />
                          Производитель
                        </span>
                      </div>
                    )}

                    <div className="flex items-start gap-3 mb-4">
                      <MapPin className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                      <div>
                        <h3 className="font-display uppercase tracking-wider mb-1">
                          {dealer.city}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {dealer.address}
                        </p>
                      </div>
                    </div>

                    <div className="mb-4">
                      <DealerMiniMap
                        lat={dealer.coordinates.lat}
                        lng={dealer.coordinates.lng}
                        title={`${dealer.city} — Росомаха`}
                        address={dealer.address}
                      />
                    </div>

                    <div className="space-y-3 flex-1">
                      <div className="flex items-center gap-3">
                        <Phone className="w-4 h-4 text-muted-foreground" />
                        <a
                          href={`tel:${dealer.phone.replace(/[^\d+]/g, '')}`}
                          className="hover:text-primary transition-colors"
                        >
                          {dealer.phone}
                        </a>
                      </div>

                      {dealer.phone2 && (
                        <div className="flex items-center gap-3">
                          <Phone className="w-4 h-4 text-muted-foreground" />
                          <a
                            href={`tel:${dealer.phone2.replace(/[^\d+]/g, '')}`}
                            className="hover:text-primary transition-colors"
                          >
                            {dealer.phone2}
                          </a>
                        </div>
                      )}

                      {dealer.email && (
                        <div className="flex items-center gap-3">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                          <a
                            href={`mailto:${dealer.email}`}
                            className="hover:text-primary transition-colors text-sm"
                          >
                            {dealer.email}
                          </a>
                        </div>
                      )}

                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {dealer.workHours}
                        </span>
                      </div>

                      {dealer.website && (
                        <a
                          href={dealer.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-primary hover:underline text-sm mt-4"
                        >
                          <ExternalLink className="w-4 h-4" />
                          Перейти на сайт
                        </a>
                      )}
                    </div>

                    {dealer.type === 'factory' && (
                      <div className="mt-5 pt-4 border-t border-border">
                        <Link to="/contacts" className="btn-primary w-full text-center block">
                          Заказать напрямую
                        </Link>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Partners section */}
        {partners.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-2xl uppercase tracking-wider mb-2 text-muted-foreground">
              Клубы и партнёры
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Независимые клубы и сервисные партнёры, работающие с техникой Росомаха.
            </p>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {partners.map((dealer) => (
                <div
                  key={dealer.id}
                  className="card-premium p-6 flex flex-col opacity-80"
                >
                  <div className="flex items-start gap-3 mb-4">
                    <MapPin className="w-5 h-5 text-muted-foreground mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-display uppercase tracking-wider mb-1">
                        {dealer.city}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {dealer.address}
                      </p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <DealerMiniMap
                      lat={dealer.coordinates.lat}
                      lng={dealer.coordinates.lng}
                      title={`${dealer.city} — Росомаха`}
                      address={dealer.address}
                    />
                  </div>

                  <div className="space-y-3 flex-1">
                    <div className="flex items-center gap-3">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <a
                        href={`tel:${dealer.phone.replace(/[^\d+]/g, '')}`}
                        className="hover:text-primary transition-colors"
                      >
                        {dealer.phone}
                      </a>
                    </div>

                    {dealer.email && (
                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <a
                          href={`mailto:${dealer.email}`}
                          className="hover:text-primary transition-colors text-sm"
                        >
                          {dealer.email}
                        </a>
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {dealer.workHours}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <div className="mt-16 text-center bg-card p-12 rounded-lg border border-border">
          <h3 className="font-display text-2xl uppercase tracking-wider mb-4">
            Хотите стать дилером?
          </h3>
          <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
            Мы открыты для сотрудничества и развития дилерской сети
            в новых регионах России.
          </p>
          <Link to="/contacts" className="btn-primary">
            Связаться с нами
          </Link>
        </div>
      </div>
    </main>
  );
}
