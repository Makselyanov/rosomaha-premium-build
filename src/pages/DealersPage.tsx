import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { MapPin, Phone, Mail, Clock, ExternalLink } from 'lucide-react';
import { dealers } from '@/data/models';

export default function DealersPage() {
  const groupedDealers = dealers.reduce((acc, dealer) => {
    if (!acc[dealer.region]) {
      acc[dealer.region] = [];
    }
    acc[dealer.region].push(dealer);
    return acc;
  }, {} as Record<string, typeof dealers>);

  return (
    <main className="pt-24 pb-16">
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
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <h1 className="section-title mb-4">Дилерская сеть</h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Официальные дилеры снегоболотоходов «Росомаха» в регионах России. 
            Найдите ближайший центр продаж и обслуживания.
          </p>
        </motion.div>

        {/* Map Placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-12 bg-secondary/50 rounded-lg border border-border aspect-[21/9] flex items-center justify-center"
        >
          <div className="text-center">
            <MapPin className="w-16 h-16 text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">
              Карта дилерской сети
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              (Подключите Mapbox для интерактивной карты)
            </p>
          </div>
        </motion.div>

        {/* Dealers by Region */}
        <div className="space-y-12">
          {Object.entries(groupedDealers).map(([region, regionDealers], regionIndex) => (
            <motion.section
              key={region}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: regionIndex * 0.05 }}
            >
              <h2 className="font-display text-2xl uppercase tracking-wider mb-6 text-primary">
                {region}
              </h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {regionDealers.map((dealer) => (
                  <div
                    key={dealer.id}
                    className="card-premium p-6"
                  >
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

                    <div className="space-y-3">
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
                  </div>
                ))}
              </div>
            </motion.section>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 text-center bg-card p-12 rounded-lg border border-border"
        >
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
        </motion.div>
      </div>
    </main>
  );
}
