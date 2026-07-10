import { Link } from "react-router-dom";
import { CircleHelp, CreditCard, FileText, MapPin, Phone, ShoppingBag, Truck } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { officePhone, primaryPhone } from "@/data/contactInfo";
import { productDeliveryOptions, productFaqs, productHowToBuySteps, productPaymentOptions } from "@/data/product-detail-content";

type ProductDetailTabsProps = {
  productName: string;
};

export default function ProductDetailTabs({ productName }: ProductDetailTabsProps) {
  return (
    <section className="rounded-[28px] border border-border bg-card/80 p-6 md:p-8">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary">Покупка и сопровождение</p>
          <h3 className="mt-2 font-display text-2xl font-bold uppercase tracking-[0.08em]">
            Что важно знать перед заказом {productName}
          </h3>
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          Сохранили полезный блок из старых карточек товара: ответы на частые вопросы, порядок оформления,
          способы оплаты и доставку по России.
        </p>
      </div>

      <Tabs defaultValue="faq" className="space-y-6">
        <TabsList className="h-auto flex-wrap justify-start gap-2 rounded-none bg-transparent p-0">
          <TabsTrigger value="faq" className="rounded-full border border-border bg-secondary/40 px-4 py-2 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <CircleHelp className="mr-2 h-4 w-4" />
            Вопросы и ответы
          </TabsTrigger>
          <TabsTrigger value="buy" className="rounded-full border border-border bg-secondary/40 px-4 py-2 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <ShoppingBag className="mr-2 h-4 w-4" />
            Как купить
          </TabsTrigger>
          <TabsTrigger value="payment" className="rounded-full border border-border bg-secondary/40 px-4 py-2 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <CreditCard className="mr-2 h-4 w-4" />
            Оплата
          </TabsTrigger>
          <TabsTrigger value="delivery" className="rounded-full border border-border bg-secondary/40 px-4 py-2 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Truck className="mr-2 h-4 w-4" />
            Доставка
          </TabsTrigger>
        </TabsList>

        <TabsContent value="faq" className="mt-0 rounded-[24px] border border-border bg-secondary/20 p-5 md:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <CircleHelp className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-display text-xl font-bold uppercase tracking-[0.08em]">Вопросы и ответы</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Короткий блок с тем, что чаще всего спрашивают перед покупкой техники.
              </p>
            </div>
          </div>

          <Accordion type="single" collapsible className="rounded-2xl border border-border/70 bg-background/40 px-4 md:px-5">
            {productFaqs.map((faq, index) => (
              <AccordionItem key={faq.question} value={`faq-${index}`} className="border-border/70">
                <AccordionTrigger className="gap-4 text-left text-base font-semibold hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </TabsContent>

        <TabsContent value="buy" className="mt-0 rounded-[24px] border border-border bg-secondary/20 p-5 md:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-display text-xl font-bold uppercase tracking-[0.08em]">Как купить</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Самый быстрый путь: оставить заявку по модели, а дальше менеджер уже ведет заказ до передачи техники.
              </p>
            </div>
          </div>

          <ol className="space-y-3">
            {productHowToBuySteps.map((step, index) => (
              <li key={step} className="flex gap-4 rounded-2xl border border-border/70 bg-background/40 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <span className="pt-1 text-sm leading-relaxed text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary/8 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-primary">{primaryPhone.label}</p>
                <a href={primaryPhone.href} className="font-semibold hover:text-primary">
                  {primaryPhone.display}
                </a>
                <a href={officePhone.href} className="block text-sm text-muted-foreground hover:text-primary">
                  {officePhone.label}: {officePhone.display}
                </a>
              </div>
            </div>
            <Link to="/order" className="btn-primary w-full px-4 py-3 text-sm whitespace-normal sm:w-auto sm:px-8 sm:py-4 sm:text-lg sm:whitespace-nowrap">
              Оставить заявку
            </Link>
          </div>
        </TabsContent>

        <TabsContent value="payment" className="mt-0 rounded-[24px] border border-border bg-secondary/20 p-5 md:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-display text-xl font-bold uppercase tracking-[0.08em]">Оплата</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Работаем и с частными клиентами, и с компаниями. Формат оплаты подбираем под ваш сценарий заказа.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {productPaymentOptions.map((option) => (
              <div key={option} className="rounded-2xl border border-border/70 bg-background/40 p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{option}</p>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="delivery" className="mt-0 rounded-[24px] border border-border bg-secondary/20 p-5 md:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-display text-xl font-bold uppercase tracking-[0.08em]">Доставка</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Отправляем технику по России и отдельно помогаем с расчетом логистики под ваш адрес.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {productDeliveryOptions.map((option) => (
              <div key={option} className="rounded-2xl border border-border/70 bg-background/40 p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Truck className="h-5 w-5" />
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{option}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/40 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-primary">Самовывоз с производства</p>
                <p className="text-sm text-muted-foreground">Тюменская область, п. Московский, ул. Бурлаки, 29В</p>
              </div>
            </div>
            <Link to="/delivery" className="btn-secondary w-full px-4 py-3 text-sm whitespace-normal sm:w-auto sm:px-8 sm:py-4 sm:text-lg sm:whitespace-nowrap">
              Подробнее о доставке
            </Link>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
