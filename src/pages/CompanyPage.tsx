import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Building2, Users, Award, Target } from 'lucide-react';
// Images now loaded from public/media


export default function CompanyPage() {
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
            <li className="text-foreground">О компании</li>
          </ol>
        </nav>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-16"
        >
          <h1 className="section-title mb-6">О компании «Росомаха»</h1>
          <p className="text-xl text-muted-foreground max-w-3xl">
            ТПК «Росомаха» — динамично развивающееся производство снегоболотоходов
            в различной комплектации. Мы основали компанию ООО «Тюменский завод
            вездеходной техники» в 2012 году.
          </p>
        </motion.div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-2 gap-16 mb-24">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <img
              src="/media/company/rosomaha-wheelie-snow.jpg"
              alt="Вездеход Росомаха в прыжке"
              className="rounded-lg w-full aspect-[4/5] object-cover shadow-2xl"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-2xl uppercase tracking-wider mb-6">
              Наше производство
            </h2>
            <div className="space-y-4 text-muted-foreground leading-relaxed">
              <p>
                Компания является заводом-изготовителем снегоболотохода «Росомаха»,
                представляющего собой мощный вездеход на шинах низкого давления
                повышенной проходимости.
              </p>
              <p>
                Мы используем надёжные японские двигатели Toyota (1NZ-FE, 1ZZ-FE)
                и проверенные временем мосты (УАЗ, Toyota, Suzuki Jimny), что
                гарантирует долговечность и ремонтопригодность техники.
              </p>
              <p>
                <strong className="text-foreground">Гарантия:</strong> 6 месяцев
                или 200 моточасов на всю технику.
              </p>
            </div>
          </motion.div>
        </div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-24"
        >
          {[
            { icon: Building2, value: '2012', label: 'Год основания' },
            { icon: Users, value: '1000+', label: 'Машин реализовано' },
            { icon: Award, value: '11', label: 'Регионов присутствия' },
            { icon: Target, value: '100%', label: 'Контроль качества' },
          ].map((stat, index) => (
            <div
              key={stat.label}
              className="text-center p-6 bg-secondary/30 rounded-lg border border-border/50"
            >
              <stat.icon className="w-10 h-10 text-primary mx-auto mb-4" />
              <p className="text-3xl md:text-4xl font-display font-bold text-gradient mb-2">
                {stat.value}
              </p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Applications */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-24"
        >
          <h2 className="section-title text-3xl mb-8">Применение техники</h2>
          <div className="bg-card p-8 rounded-lg border border-border">
            <p className="text-lg mb-6">
              Применение снегоболотохода эффективно при выполнении следующих видов работ:
            </p>
            <ul className="grid md:grid-cols-2 gap-4">
              {[
                'Оперативное снабжение полевых лагерей без использования вертолётов на удалении до 200-300 км',
                'Обслуживание магистральных и местных линий электропередач ЛЭП 500, 220 и 110 КВ',
                'Обслуживание и ремонт трубопроводов различного назначения',
                'Перевозка людей и продуктов питания в труднодоступные районы',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="w-2 h-2 bg-primary rounded-full mt-2 flex-shrink-0" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.section>

        {/* Capabilities */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-24"
        >
          <h2 className="section-title text-3xl mb-8">Проходимость</h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <p className="text-lg text-muted-foreground mb-6">
                На снегоболотоходах «Росомаха» вы сможете передвигаться в условиях
                полного бездорожья:
              </p>
              <ul className="space-y-3">
                {[
                  'Болота любой категории',
                  'Заболоченная местность',
                  'Снежная целина',
                  'Грунтовые, захламлённые лесные и размытые берега',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="w-2 h-2 bg-primary rounded-full" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-primary font-medium">
                Снегоболотоход «Росомаха» также сможет преодолевать водные преграды
                без какой-либо подготовки!
              </p>
            </div>
            <img
              src="/media/company/rosomaha-deep-mud.jpg"
              alt="Росомаха проходит сложную грязь"
              className="rounded-lg w-full aspect-[4/5] object-cover shadow-xl"
            />
          </div>
        </motion.section>

        {/* Requisites */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="section-title text-3xl mb-8">Реквизиты</h2>
          <div className="bg-card p-8 rounded-lg border border-border overflow-x-auto">
            <table className="w-full">
              <tbody className="divide-y divide-border">
                {[
                  { label: 'Полное наименование', value: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ ТЮМЕНСКАЯ ПРОИЗВОДСТВЕННАЯ КОМПАНИЯ "РОСОМАХА"' },
                  { label: 'Сокращённое наименование', value: 'ООО ТПК "РОСОМАХА"' },
                  { label: 'ИНН/КПП', value: '7224087219/722401001' },
                  { label: 'ОГРН', value: '1237200009133' },
                  { label: 'Юридический адрес', value: '625501, Тюменская область, М.Р-Н ТЮМЕНСКИЙ, С.П. МОСКОВСКОЕ, П МОСКОВСКИЙ, УЛ БУРЛАКИ, ЗД. 29В, ОФИС 3' },
                  { label: 'Телефон', value: '+7 (3452) 63-88-70' },
                ].map((row) => (
                  <tr key={row.label}>
                    <td className="py-4 pr-8 text-muted-foreground font-medium whitespace-nowrap">
                      {row.label}
                    </td>
                    <td className="py-4">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.section>
      </div>
    </main>
  );
}
