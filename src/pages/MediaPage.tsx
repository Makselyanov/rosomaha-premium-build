import { Link } from 'react-router-dom';
import { ExternalLink, MessageCircle, PlayCircle, Video, Youtube } from 'lucide-react';
import SEO from '@/components/SEO';

type ChannelLink = {
  label: string;
  href: string;
  kind: 'youtube' | 'telegram' | 'rutube';
};

type VideoItem = {
  title: string;
  embed: string;
  href: string;
};

const channelLinks: ChannelLink[] = [
  { label: 'YouTube', href: 'https://www.youtube.com/@Rosomaha_Club', kind: 'youtube' },
  { label: 'Telegram Club', href: 'https://t.me/rosomahaclub', kind: 'telegram' },
  { label: 'Telegram сайт', href: 'https://t.me/rosomaha_site', kind: 'telegram' },
  { label: 'RUTUBE', href: 'https://rutube.ru/channel/54061535/', kind: 'rutube' },
];

const youtubeVideos: VideoItem[] = [
  {
    title: 'Тест на воде / Кабинная Росомаха',
    embed: 'https://www.youtube-nocookie.com/embed/vxVESZUIcVw?rel=0',
    href: 'https://www.youtube.com/watch?v=vxVESZUIcVw',
  },
  {
    title: 'Росомаха Standard Plus',
    embed: 'https://www.youtube-nocookie.com/embed/BiqpxK9RJ_E?rel=0',
    href: 'https://www.youtube.com/watch?v=BiqpxK9RJ_E',
  },
  {
    title: 'Трофи рейд. Тюменская область',
    embed: 'https://www.youtube-nocookie.com/embed/JueDiJOyCDQ?rel=0',
    href: 'https://www.youtube.com/watch?v=JueDiJOyCDQ',
  },
  {
    title: 'Новый бизнес под ключ',
    embed: 'https://www.youtube-nocookie.com/embed/nRKL7Zxwua0?rel=0',
    href: 'https://www.youtube.com/watch?v=nRKL7Zxwua0',
  },
  {
    title: 'Росомаха модель Стандарт',
    embed: 'https://www.youtube-nocookie.com/embed/Gr4NH3zNvZI?rel=0',
    href: 'https://www.youtube.com/watch?v=Gr4NH3zNvZI',
  },
  {
    title: 'Росомаха Пикап Стандарт',
    embed: 'https://www.youtube-nocookie.com/embed/h7eFlDL3lj4?rel=0',
    href: 'https://www.youtube.com/watch?v=h7eFlDL3lj4',
  },
];

const rutubeVideo: VideoItem = {
  title: 'Росомаха клуб приглашает на прокат квадро-гигантов',
  embed: 'https://rutube.ru/play/embed/bb1cb230e279f5b6224d93ceb397033f/',
  href: 'https://rutube.ru/video/bb1cb230e279f5b6224d93ceb397033f/',
};

const linkIcon = {
  youtube: Youtube,
  telegram: MessageCircle,
  rutube: PlayCircle,
};

export default function MediaPage() {
  return (
    <main className="pt-24 pb-16">
      <SEO
        title="Видео и обзоры техники Росомаха"
        description="Видеообзоры, тест-драйвы и полевые материалы о вездеходах Росомаха: YouTube Rosomaha Club, Telegram и RUTUBE."
        canonical="/media"
        breadcrumbs={[
          { name: 'Главная', url: '/' },
          { name: 'Видео', url: '/media' },
        ]}
      />

      <div className="container">
        <nav className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-muted-foreground">
            <li>
              <Link to="/" className="hover:text-foreground transition-colors">
                Главная
              </Link>
            </li>
            <li>/</li>
            <li className="text-foreground">Видео</li>
          </ol>
        </nav>

        <section className="mb-12 max-w-4xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            <Video className="h-4 w-4" />
            Медиа
          </div>
          <h1 className="section-title mb-4">Видео и обзоры Росомаха</h1>
          <p className="text-lg text-muted-foreground">
            Собрали на одной странице YouTube Rosomaha Club, наши Telegram-каналы и RUTUBE. Видео можно смотреть прямо на сайте
            или открыть на площадке автора.
          </p>
        </section>

        <section className="border-t border-border pt-8">
          <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-primary">
                Ролики о технике Росомаха
              </p>
              <h2 className="font-display text-3xl uppercase tracking-wider">Rosomaha Club</h2>
              <p className="mt-3 text-muted-foreground">
                Обзоры, выезды, наличие техники, испытания на воде и реальные материалы по эксплуатации вездеходов Росомаха.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {channelLinks.map((link) => {
                const Icon = linkIcon[link.kind];

                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Icon className="h-4 w-4" />
                    {link.label}
                  </a>
                );
              })}
            </div>
          </div>

          <div className="mb-4 flex items-center justify-between gap-4">
            <h3 className="font-display text-xl uppercase tracking-wider">YouTube: подборка видео</h3>
            <a
              href="https://www.youtube.com/@Rosomaha_Club/videos"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden text-sm font-semibold uppercase tracking-wider text-primary hover:text-primary/80 md:inline-flex"
            >
              Все видео
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {youtubeVideos.map((video) => (
              <article key={video.embed} className="overflow-hidden rounded-lg border border-border bg-secondary">
                <div className="border-b border-border px-4 py-3">
                  <h4 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    {video.title}
                  </h4>
                </div>
                <div className="aspect-video bg-background">
                  <iframe
                    src={video.embed}
                    title={video.title}
                    className="h-full w-full border-0"
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
                <div className="border-t border-border px-4 py-3">
                  <a
                    href={video.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-sm font-semibold uppercase tracking-wider text-primary hover:text-primary/80"
                  >
                    Смотреть на YouTube
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12 border-t border-border pt-8">
          <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-primary">
                Канал ВЕЗДЕХОД РОСОМАХА
              </p>
              <h2 className="font-display text-3xl uppercase tracking-wider">RUTUBE</h2>
              <p className="mt-3 text-muted-foreground">
                Добавили найденный канал RUTUBE с роликами Росомаха, прокатом, тест-драйвами и обзорами техники.
              </p>
            </div>

            <a
              href="https://rutube.ru/channel/54061535/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <PlayCircle className="h-4 w-4" />
              Канал RUTUBE
            </a>
          </div>

          <article className="overflow-hidden rounded-lg border border-border bg-secondary">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {rutubeVideo.title}
              </h3>
            </div>
            <div className="aspect-video bg-background">
              <iframe
                src={rutubeVideo.embed}
                title={rutubeVideo.title}
                className="h-full w-full border-0"
                loading="lazy"
                allow="clipboard-write; autoplay"
                allowFullScreen
              />
            </div>
            <div className="border-t border-border px-4 py-3">
              <a
                href={rutubeVideo.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm font-semibold uppercase tracking-wider text-primary hover:text-primary/80"
              >
                Смотреть на RUTUBE
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </div>
          </article>
        </section>

        <section className="mt-16 border border-border bg-card p-6 md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl uppercase tracking-wider">Есть новый обзор?</h2>
              <p className="mt-2 text-muted-foreground">
                Пришлите ссылку менеджеру, и мы добавим ролик в подборку или отдельную статью на сайте.
              </p>
            </div>
            <Link to="/contacts" className="btn-primary whitespace-nowrap px-6 py-3 text-base">
              Связаться
              <ExternalLink className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
