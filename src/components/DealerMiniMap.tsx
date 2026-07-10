import { ExternalLink, MapPinned, Route } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface DealerMiniMapProps {
  lat: number;
  lng: number;
  title: string;
  address: string;
  zoom?: number;
}

export default function DealerMiniMap({
  lat,
  lng,
  title,
  address,
  zoom = 15,
}: DealerMiniMapProps) {
  const yandexPoint = `${lng},${lat}`;
  const marker = `${yandexPoint},pm2rdm`;
  const miniMapUrl = `https://yandex.ru/map-widget/v1/?ll=${encodeURIComponent(yandexPoint)}&pt=${encodeURIComponent(marker)}&z=${zoom}`;
  const fullMapUrl = `https://yandex.ru/map-widget/v1/?ll=${encodeURIComponent(yandexPoint)}&pt=${encodeURIComponent(marker)}&z=16`;
  const yandexMapUrl = `https://yandex.ru/maps/?ll=${encodeURIComponent(yandexPoint)}&pt=${encodeURIComponent(marker)}&z=16`;
  const yandexRouteUrl = `https://yandex.ru/maps/?rtext=~${encodeURIComponent(`${lat},${lng}`)}&rtt=auto`;

  return (
    <Dialog>
      <div className="relative h-56 w-full overflow-hidden rounded-md border border-border bg-secondary">
        <iframe
          src={miniMapUrl}
          title={`Яндекс Карта: ${title}`}
          className="h-full w-full border-0"
          loading="lazy"
          aria-label={`Карта: ${title}, ${address}`}
        />
        <DialogTrigger asChild>
          <button
            type="button"
            className="absolute inset-0 flex items-end justify-start bg-gradient-to-t from-background/75 via-transparent to-transparent p-3 text-left transition-colors hover:from-background/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
            aria-label={`Открыть большую карту: ${title}, ${address}`}
          >
            <span className="inline-flex items-center gap-2 rounded bg-background/90 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-foreground shadow-lg backdrop-blur">
              <MapPinned className="h-4 w-4 text-primary" />
              Открыть карту
            </span>
          </button>
        </DialogTrigger>
      </div>

      <DialogContent className="h-[min(760px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-6xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-background px-5 py-4 pr-14 text-left">
          <DialogTitle className="font-display text-xl uppercase tracking-wider">
            {title}
          </DialogTitle>
          <DialogDescription>{address}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 bg-secondary">
          <iframe
            src={fullMapUrl}
            title={`Большая Яндекс Карта: ${title}`}
            className="h-full min-h-[420px] w-full border-0"
            loading="lazy"
            allowFullScreen
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Используйте масштаб и перемещение на карте, чтобы посмотреть улицы и подъезд к точке.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={yandexMapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded border border-border px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors hover:border-primary hover:text-primary"
            >
              <ExternalLink className="h-4 w-4" />
              Яндекс.Карты
            </a>
            <a
              href={yandexRouteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold uppercase tracking-wider text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              <Route className="h-4 w-4" />
              Маршрут
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
