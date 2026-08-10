<?php

declare(strict_types=1);

require $_SERVER['DOCUMENT_ROOT'].'/bitrix/header.php';

$APPLICATION->SetTitle('Финансирование вездехода «Росомаха»');
$APPLICATION->SetPageProperty(
    'description',
    'Рассчитайте запрашиваемую сумму по цене модели, первоначальному взносу и сроку и отправьте заявку на отдельное рассмотрение.'
);
$APPLICATION->SetPageProperty('robots', 'index, follow');

$configPath = __DIR__.'/config/products.v1.json';
$config = is_file($configPath)
    ? json_decode((string) file_get_contents($configPath), true)
    : null;
if (! is_array($config) || ($config['contract'] ?? null) !== 'rosomaha-finance-products/v1') {
    $config = [
        'contract' => 'unavailable',
        'currency' => 'RUB',
        'price_semantics' => 'unavailable',
        'products' => [],
    ];
}
$configJson = json_encode(
    $config,
    JSON_UNESCAPED_UNICODE
        | JSON_UNESCAPED_SLASHES
        | JSON_HEX_TAG
        | JSON_HEX_AMP
        | JSON_HEX_APOS
        | JSON_HEX_QUOT
);
if (! is_string($configJson)) {
    $configJson = '{"contract":"unavailable","currency":"RUB","price_semantics":"unavailable","products":[]}';
}
?>
<link rel="stylesheet" href="/finansirovanie/assets/finance.css">

<main class="rf-page" data-rosomaha-finance>
    <section class="rf-hero" aria-labelledby="rf-page-title">
        <div class="rf-shell">
            <p class="rf-kicker">Финансирование техники</p>
            <h1 id="rf-page-title">Определите сумму заявки на вездеход «Росомаха»</h1>
            <p class="rf-lead">
                Выберите модель, укажите первоначальный взнос и желаемый срок. Калькулятор покажет только разницу между ценой и взносом — без ставки, графика платежей и обещания одобрения.
            </p>
        </div>
    </section>

    <section class="rf-shell rf-layout" aria-label="Калькулятор и заявка">
        <form class="rf-form" id="rosomaha-finance-form">
            <fieldset class="rf-fieldset" id="rosomaha-finance-fields" disabled>
                <legend class="rf-visually-hidden">Параметры финансирования и контактные данные</legend>

                <section class="rf-card rf-calculator" aria-labelledby="rf-calculator-title">
                    <div class="rf-card-heading">
                        <span class="rf-step">01</span>
                        <div>
                            <h2 id="rf-calculator-title">Параметры заявки</h2>
                            <p>Цены загружены из версионированного каталога комплектаций.</p>
                        </div>
                    </div>

                    <div class="rf-grid rf-grid--two">
                        <label class="rf-field rf-field--wide" for="rf-product">
                            <span>Модель</span>
                            <select id="rf-product" name="product" required></select>
                        </label>

                        <div class="rf-metric">
                            <span>Цена в каталоге</span>
                            <strong id="rf-price-output">—</strong>
                        </div>

                        <label class="rf-field" for="rf-down-payment">
                            <span>Первоначальный взнос, ₽</span>
                            <input id="rf-down-payment" name="down_payment" type="number" min="0" step="10000" value="300000" inputmode="numeric" required>
                        </label>

                        <label class="rf-field" for="rf-term">
                            <span>Желаемый срок</span>
                            <select id="rf-term" name="term" required>
                                <option value="12">12 месяцев</option>
                                <option value="24">24 месяца</option>
                                <option value="36" selected>36 месяцев</option>
                                <option value="48">48 месяцев</option>
                                <option value="60">60 месяцев</option>
                            </select>
                        </label>
                    </div>

                    <div class="rf-result" aria-live="polite">
                        <div>
                            <span>Запрашиваемая сумма</span>
                            <strong id="rf-principal-output">—</strong>
                        </div>
                        <div>
                            <span>Желаемый срок</span>
                            <strong id="rf-term-output">36 мес.</strong>
                        </div>
                    </div>

                    <p class="rf-disclaimer">
                        Результат — арифметическая разница между ценой и первоначальным взносом. Это не банковский расчёт, не предложение кредитора и не решение о выдаче финансирования. Условия определяются финансовой организацией отдельно.
                    </p>
                </section>

                <section class="rf-card" aria-labelledby="rf-contact-title">
                    <div class="rf-card-heading">
                        <span class="rf-step">02</span>
                        <div>
                            <h2 id="rf-contact-title">Контакты для уточнения заявки</h2>
                            <p>Не указывайте паспортные данные, реквизиты карт, логины или пароли.</p>
                        </div>
                    </div>

                    <div class="rf-grid rf-grid--two">
                        <label class="rf-field" for="rf-name">
                            <span>Имя</span>
                            <input id="rf-name" name="name" type="text" maxlength="255" autocomplete="name" required>
                        </label>

                        <label class="rf-field" for="rf-phone">
                            <span>Телефон</span>
                            <input id="rf-phone" name="phone" type="tel" maxlength="40" autocomplete="tel" aria-describedby="rf-phone-hint" required>
                            <small id="rf-phone-hint">Формат: +7 900 000-00-00</small>
                        </label>

                        <label class="rf-field" for="rf-email">
                            <span>Электронная почта <small>необязательно</small></span>
                            <input id="rf-email" name="email" type="email" maxlength="255" autocomplete="email">
                        </label>

                        <label class="rf-field" for="rf-city">
                            <span>Город <small>необязательно</small></span>
                            <input id="rf-city" name="city" type="text" maxlength="255" autocomplete="address-level2">
                        </label>

                        <label class="rf-field" for="rf-applicant">
                            <span>Кто подаёт заявку</span>
                            <select id="rf-applicant" name="applicant_type" required>
                                <option value="individual">Физическое лицо</option>
                                <option value="sole_proprietor">Индивидуальный предприниматель</option>
                                <option value="company">Организация</option>
                            </select>
                        </label>

                        <label class="rf-field" for="rf-financing-type">
                            <span>Предпочтительный вариант</span>
                            <select id="rf-financing-type" name="financing_type" required>
                                <option value="credit">Кредит</option>
                                <option value="leasing">Лизинг</option>
                                <option value="installment">Рассрочка</option>
                                <option value="unsure">Нужна консультация</option>
                            </select>
                        </label>

                        <label class="rf-field rf-field--wide" for="rf-comment">
                            <span>Комментарий <small>необязательно</small></span>
                            <textarea id="rf-comment" name="comment" maxlength="2000" rows="4" aria-describedby="rf-comment-hint"></textarea>
                            <small id="rf-comment-hint">Можно указать, когда планируете получить технику.</small>
                        </label>
                    </div>

                    <div class="rf-honeypot" aria-hidden="true">
                        <label for="rf-company-website">Сайт компании</label>
                        <input id="rf-company-website" name="company_website" type="text" tabindex="-1" autocomplete="off">
                    </div>

                    <label class="rf-consent" for="rf-privacy-accepted">
                        <input id="rf-privacy-accepted" name="privacy_accepted" type="checkbox" required>
                        <span>
                            Я прочитал(а) и принимаю
                            <a id="rf-privacy-link" href="#rf-privacy-document" aria-disabled="true">согласие на обработку персональных данных</a>
                            в указанной ниже действующей версии.
                        </span>
                    </label>
                </section>
            </fieldset>

            <div class="rf-actions">
                <button class="rf-button rf-button--primary" id="rf-submit" type="submit" disabled>Отправить заявку</button>
                <button class="rf-button rf-button--secondary" id="rf-reset-submission" type="button" hidden>Изменить данные и создать новую отправку</button>
                <button class="rf-button rf-button--secondary" id="rf-retry-legal" type="button" hidden>Повторить проверку документа</button>
            </div>
            <p class="rf-status" id="rf-status" role="status" aria-live="polite"></p>
        </form>

        <aside class="rf-card rf-privacy" id="rf-privacy-document" aria-labelledby="rf-privacy-title">
            <p class="rf-kicker">Действующий документ</p>
            <h2 id="rf-privacy-title">Документ загружается</h2>
            <p class="rf-privacy-meta" id="rf-privacy-meta"></p>
            <div class="rf-privacy-text" id="rf-privacy-text"></div>
        </aside>
    </section>
</main>

<script type="application/json" id="rosomaha-finance-products"><?= $configJson ?></script>
<script src="/finansirovanie/assets/finance-core.js" defer></script>
<script src="/finansirovanie/assets/finance.js" defer></script>
<?php require $_SERVER['DOCUMENT_ROOT'].'/bitrix/footer.php'; ?>
