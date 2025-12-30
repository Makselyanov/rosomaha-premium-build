import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye } from 'lucide-react';
import { VehicleModel } from '@/data/models';

interface ModelCardProps {
  model: VehicleModel;
  index?: number;
}

export default function ModelCard({ model, index = 0 }: ModelCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
    >
      <Link to={`/catalog/${model.slug}`} className="block group">
        <div className="card-premium">
          {/* Badge */}
          {model.badge && (
            <div className="absolute top-4 left-4 z-10">
              {model.badge === 'new' && <span className="badge-new">Новинка</span>}
              {model.badge === 'hit' && <span className="badge-hit">Хит</span>}
              {model.badge === 'recommended' && (
                <span className="inline-flex items-center px-3 py-1 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white font-display">
                  Рекомендуем
                </span>
              )}
            </div>
          )}

          {/* Image */}
          <div className="relative aspect-[4/3] overflow-hidden">
            <img
              src={model.image}
              alt={model.name}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-60" />

            {/* Quick Actions */}
            <div className="absolute bottom-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <span className="p-3 bg-primary text-primary-foreground rounded-lg">
                <Eye className="w-5 h-5" />
              </span>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            <p className="text-xs uppercase tracking-wider text-primary mb-2 font-display">
              {model.categoryName}
            </p>
            <h3 className="text-lg font-display uppercase tracking-wider mb-3 group-hover:text-primary transition-colors">
              {model.name}
            </h3>

            {/* Specs */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="text-xs px-2 py-1 bg-secondary rounded text-muted-foreground">
                {model.specs.engine}
              </span>
              <span className="text-xs px-2 py-1 bg-secondary rounded text-muted-foreground">
                {model.specs.axles}
              </span>
            </div>

            {/* Price & Availability */}
            <div className="flex items-center justify-between">
              <div>
                {model.available && (
                  <span className="badge-available text-xs mb-1">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    В наличии
                  </span>
                )}
                <p className="price-tag text-2xl">{model.priceFormatted}</p>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
