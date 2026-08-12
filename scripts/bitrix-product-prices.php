<?php

declare(strict_types=1);

const ROSOMAHA_PRICE_SITE_ROOT = '/home/b/berkutm4/rosomaha-rus.ru/public_html';
const ROSOMAHA_PRICE_BACKUP_ROOT = '/home/b/berkutm4/migration/rosomaha-rus/backups/bitrix-product-prices';
const ROSOMAHA_PRODUCT_IBLOCK_ID = 86;
const ROSOMAHA_OFFER_IBLOCK_ID = 64;

const ROSOMAHA_PRICE_PROPERTIES = [
    'product_link_sku' => [
        'id' => 1165,
        'iblock_id' => ROSOMAHA_PRODUCT_IBLOCK_ID,
        'code' => 'LINK_SKU',
        'multiple' => 'Y',
    ],
    'product_price' => [
        'id' => 1171,
        'iblock_id' => ROSOMAHA_PRODUCT_IBLOCK_ID,
        'code' => 'PRICE',
        'multiple' => 'N',
    ],
    'product_filter_price' => [
        'id' => 1177,
        'iblock_id' => ROSOMAHA_PRODUCT_IBLOCK_ID,
        'code' => 'FILTER_PRICE',
        'multiple' => 'N',
    ],
    'offer_price' => [
        'id' => 748,
        'iblock_id' => ROSOMAHA_OFFER_IBLOCK_ID,
        'code' => 'PRICE',
        'multiple' => 'N',
    ],
    'offer_filter_price' => [
        'id' => 751,
        'iblock_id' => ROSOMAHA_OFFER_IBLOCK_ID,
        'code' => 'FILTER_PRICE',
        'multiple' => 'N',
    ],
];

const ROSOMAHA_PRICE_CHANGES = [
    [
        'product_id' => 755,
        'offer_id' => 764,
        'slug' => 'standart-plus-1-5-litra',
        'old_price' => 1300000,
        'new_price' => 1350000,
    ],
    [
        'product_id' => 898,
        'offer_id' => 907,
        'slug' => 'rosomakha-standart-plyus-uaz-timken',
        'old_price' => 1400000,
        'new_price' => 1450000,
    ],
    [
        'product_id' => 768,
        'offer_id' => 812,
        'slug' => 'extrime-s-1-5l-dvs-1nz-fe',
        'old_price' => 1800000,
        'new_price' => 1850000,
    ],
    [
        'product_id' => 879,
        'offer_id' => 824,
        'slug' => 'extrime-1-5-litra-mosty-toyota',
        'old_price' => 2050000,
        'new_price' => 2100000,
    ],
    [
        'product_id' => 769,
        'offer_id' => 788,
        'slug' => 'extrime-plus-s-1-8l-dvs-1zz-fe',
        'old_price' => 2150000,
        'new_price' => 2200000,
    ],
    [
        'product_id' => 770,
        'offer_id' => 800,
        'slug' => 'hunter-s-1-5l-dvs-1nz-fe',
        'old_price' => 2180000,
        'new_price' => 2230000,
    ],
    [
        'product_id' => 979,
        'offer_id' => 991,
        'slug' => 'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken',
        'old_price' => 1800000,
        'new_price' => 1850000,
    ],
    [
        'product_id' => 881,
        'offer_id' => 929,
        'slug' => 'snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz',
        'old_price' => 2250000,
        'new_price' => 2300000,
    ],
    [
        'product_id' => 880,
        'offer_id' => 919,
        'slug' => 'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota',
        'old_price' => 2450000,
        'new_price' => 2500000,
    ],
];

function rosomahaPricesResult(array $payload, int $exitCode = 0): void
{
    echo json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ), PHP_EOL;
    exit($exitCode);
}

function rosomahaPricesStage(string $stage): void
{
    $stderr = fopen('php://stderr', 'wb');
    if ($stderr !== false) {
        fwrite($stderr, "STAGE:{$stage}\n");
        fclose($stderr);
    }
}

function rosomahaPricesProperty(string $key): array
{
    if (!isset(ROSOMAHA_PRICE_PROPERTIES[$key])) {
        throw new LogicException("Unknown pinned property key {$key}");
    }

    return ROSOMAHA_PRICE_PROPERTIES[$key];
}

function rosomahaPricesFormatted(int $amount): string
{
    return 'от ' . number_format($amount, 0, '', ' ') . ' #CURRENCY#';
}

function rosomahaPricesValidateAllowlist(): void
{
    if (count(ROSOMAHA_PRICE_CHANGES) !== 9) {
        throw new LogicException('The pinned price allowlist must contain exactly nine pairs');
    }

    $productIds = [];
    $offerIds = [];
    $slugs = [];
    foreach (ROSOMAHA_PRICE_CHANGES as $change) {
        $productId = (int) ($change['product_id'] ?? 0);
        $offerId = (int) ($change['offer_id'] ?? 0);
        $slug = (string) ($change['slug'] ?? '');
        $oldPrice = (int) ($change['old_price'] ?? 0);
        $newPrice = (int) ($change['new_price'] ?? 0);

        if ($productId <= 0 || $offerId <= 0 || $slug === '') {
            throw new LogicException('The pinned price allowlist contains an incomplete row');
        }
        if ($oldPrice <= 0 || $newPrice <= $oldPrice) {
            throw new LogicException("Invalid pinned price transition for product {$productId}");
        }
        if (isset($productIds[$productId]) || isset($offerIds[$offerId]) || isset($slugs[$slug])) {
            throw new LogicException('The pinned price allowlist contains duplicate identifiers');
        }

        $productIds[$productId] = true;
        $offerIds[$offerId] = true;
        $slugs[$slug] = true;
    }
}

function rosomahaPricesValidateIblock(int $iblockId): array
{
    $cursor = CIBlock::GetList([], ['ID' => $iblockId]);
    $iblock = $cursor->Fetch();
    if (!is_array($iblock) || (int) ($iblock['ID'] ?? 0) !== $iblockId) {
        throw new RuntimeException("Pinned iblock {$iblockId} was not found");
    }

    return [
        'id' => (int) $iblock['ID'],
        'code' => (string) ($iblock['CODE'] ?? ''),
        'name' => (string) ($iblock['NAME'] ?? ''),
    ];
}

function rosomahaPricesValidatePropertyDefinition(string $key, array $expected): array
{
    $cursor = CIBlockProperty::GetList(
        [],
        [
            'ID' => (int) $expected['id'],
            'IBLOCK_ID' => (int) $expected['iblock_id'],
        ]
    );
    $property = $cursor->Fetch();
    if (!is_array($property)) {
        throw new RuntimeException("Pinned property {$key} was not found");
    }

    $actualId = (int) ($property['ID'] ?? 0);
    $actualIblockId = (int) ($property['IBLOCK_ID'] ?? 0);
    $actualCode = (string) ($property['CODE'] ?? '');
    if (
        $actualId !== (int) $expected['id']
        || $actualIblockId !== (int) $expected['iblock_id']
        || $actualCode !== (string) $expected['code']
    ) {
        throw new RuntimeException("Pinned property schema mismatch for {$key}");
    }

    $actualMultiple = (string) ($property['MULTIPLE'] ?? '');
    $expectedMultiple = (string) ($expected['multiple'] ?? '');
    if ($actualMultiple !== $expectedMultiple) {
        throw new RuntimeException("Pinned property multiplicity mismatch for {$key}");
    }

    return [
        'key' => $key,
        'id' => $actualId,
        'iblock_id' => $actualIblockId,
        'code' => $actualCode,
        'property_type' => (string) ($property['PROPERTY_TYPE'] ?? ''),
        'multiple' => $actualMultiple,
    ];
}

function rosomahaPricesValidateSchema(): array
{
    $schema = [
        'iblocks' => [
            rosomahaPricesValidateIblock(ROSOMAHA_PRODUCT_IBLOCK_ID),
            rosomahaPricesValidateIblock(ROSOMAHA_OFFER_IBLOCK_ID),
        ],
        'properties' => [],
    ];

    foreach (ROSOMAHA_PRICE_PROPERTIES as $key => $expected) {
        $schema['properties'][] = rosomahaPricesValidatePropertyDefinition($key, $expected);
    }

    return $schema;
}

function rosomahaPricesReadElement(int $elementId, int $iblockId): array
{
    $cursor = CIBlockElement::GetList(
        [],
        [
            'ID' => $elementId,
            'IBLOCK_ID' => $iblockId,
        ],
        false,
        false,
        [
            'ID',
            'IBLOCK_ID',
            'NAME',
            'CODE',
            'TIMESTAMP_X',
            'MODIFIED_BY',
        ]
    );
    $element = $cursor->Fetch();
    if (!is_array($element)) {
        throw new RuntimeException("Element {$elementId} was not found in iblock {$iblockId}");
    }

    return [
        'id' => (int) ($element['ID'] ?? 0),
        'iblock_id' => (int) ($element['IBLOCK_ID'] ?? 0),
        'name' => (string) ($element['NAME'] ?? ''),
        'code' => (string) ($element['CODE'] ?? ''),
        'modified_at' => (string) ($element['TIMESTAMP_X'] ?? ''),
        'modified_by' => (int) ($element['MODIFIED_BY'] ?? 0),
    ];
}

function rosomahaPricesReadSingleProperty(int $elementId, int $iblockId, int $propertyId): string
{
    $cursor = CIBlockElement::GetProperty(
        $iblockId,
        $elementId,
        'sort',
        'asc',
        ['ID' => $propertyId]
    );
    $values = [];
    while ($property = $cursor->Fetch()) {
        $values[] = $property['VALUE'] ?? null;
    }

    if (count($values) !== 1) {
        throw new RuntimeException(
            "Property {$propertyId} for element {$elementId} must have exactly one value"
        );
    }

    $value = $values[0];
    if (!is_string($value) && !is_int($value) && !is_float($value)) {
        throw new RuntimeException(
            "Property {$propertyId} for element {$elementId} is not a scalar value"
        );
    }

    return (string) $value;
}

function rosomahaPricesReadLinkedOfferValues(int $productId): array
{
    $linkProperty = rosomahaPricesProperty('product_link_sku');
    $cursor = CIBlockElement::GetProperty(
        ROSOMAHA_PRODUCT_IBLOCK_ID,
        $productId,
        ['sort' => 'asc', 'id' => 'asc'],
        ['ID' => (int) $linkProperty['id']]
    );
    $offerIds = [];
    while ($property = $cursor->Fetch()) {
        $rawValue = $property['VALUE'] ?? null;
        if (!is_string($rawValue) && !is_int($rawValue) && !is_float($rawValue)) {
            throw new RuntimeException(
                "LINK_SKU for product {$productId} contains a non-scalar value"
            );
        }
        $offerIds[] = rosomahaPricesExactInteger(
            (string) $rawValue,
            "LINK_SKU for product {$productId}"
        );
    }
    $offerIds = array_values(array_unique($offerIds));
    sort($offerIds, SORT_NUMERIC);
    if ($offerIds === []) {
        throw new RuntimeException("LINK_SKU for product {$productId} has no values");
    }

    return $offerIds;
}

function rosomahaPricesExactInteger(string $raw, string $label): int
{
    if (!preg_match('/^[1-9][0-9]*$/D', $raw)) {
        throw new RuntimeException("{$label} must be an exact positive integer");
    }

    $value = (int) $raw;
    if ((string) $value !== $raw) {
        throw new RuntimeException("{$label} is outside the supported integer range");
    }

    return $value;
}

function rosomahaPricesReadPriceElement(
    int $elementId,
    int $iblockId,
    int $pricePropertyId,
    int $filterPricePropertyId
): array {
    $element = rosomahaPricesReadElement($elementId, $iblockId);
    $price = rosomahaPricesReadSingleProperty($elementId, $iblockId, $pricePropertyId);
    $filterPriceRaw = rosomahaPricesReadSingleProperty(
        $elementId,
        $iblockId,
        $filterPricePropertyId
    );
    $filterPrice = rosomahaPricesExactInteger(
        $filterPriceRaw,
        "FILTER_PRICE {$filterPricePropertyId} for element {$elementId}"
    );

    $element['price'] = $price;
    $element['filter_price'] = $filterPrice;
    $element['filter_price_raw'] = $filterPriceRaw;
    $element['price_values_sha256'] = hash(
        'sha256',
        $price . "\0" . $filterPriceRaw
    );

    return $element;
}

function rosomahaPricesReadLinkedOffer(int $productId, int $expectedOfferId): array
{
    $linkProperty = rosomahaPricesProperty('product_link_sku');
    $linkedOfferIds = rosomahaPricesReadLinkedOfferValues($productId);
    if (!in_array($expectedOfferId, $linkedOfferIds, true)) {
        throw new RuntimeException(
            "Product {$productId} is not linked to pinned offer {$expectedOfferId}"
        );
    }

    $cursor = CIBlockElement::GetList(
        ['ID' => 'ASC'],
        [
            'IBLOCK_ID' => ROSOMAHA_PRODUCT_IBLOCK_ID,
            'PROPERTY_' . (int) $linkProperty['id'] => $expectedOfferId,
        ],
        false,
        false,
        ['ID']
    );
    $reverseProductIds = [];
    while ($element = $cursor->Fetch()) {
        $reverseProductIds[(int) $element['ID']] = true;
    }
    $reverseProductIds = array_keys($reverseProductIds);
    sort($reverseProductIds, SORT_NUMERIC);
    if ($reverseProductIds !== [$productId]) {
        throw new RuntimeException(
            "Offer {$expectedOfferId} must have exactly one pinned LINK_SKU owner"
        );
    }

    return [
        'property_id' => (int) $linkProperty['id'],
        'linked_offer_ids' => $linkedOfferIds,
        'pinned_offer_id' => $expectedOfferId,
        'reverse_product_ids' => $reverseProductIds,
    ];
}

function rosomahaPricesElementMatches(array $element, int $amount): bool
{
    return $element['price'] === rosomahaPricesFormatted($amount)
        && $element['filter_price_raw'] === (string) $amount
        && $element['filter_price'] === $amount;
}

function rosomahaPricesElementWithinTransition(
    array $element,
    int $beforeAmount,
    int $afterAmount
): bool {
    return in_array(
        $element['price'],
        [rosomahaPricesFormatted($beforeAmount), rosomahaPricesFormatted($afterAmount)],
        true
    ) && in_array(
        $element['filter_price_raw'],
        [(string) $beforeAmount, (string) $afterAmount],
        true
    );
}

function rosomahaPricesClassifyPair(array $change, array $product, array $offer): string
{
    $oldPrice = (int) $change['old_price'];
    $newPrice = (int) $change['new_price'];
    $isOld = rosomahaPricesElementMatches($product, $oldPrice)
        && rosomahaPricesElementMatches($offer, $oldPrice);
    $isNew = rosomahaPricesElementMatches($product, $newPrice)
        && rosomahaPricesElementMatches($offer, $newPrice);

    if ($isOld) {
        return 'old';
    }
    if ($isNew) {
        return 'new';
    }

    $observed = json_encode(
        [
            'product' => [
                'price' => $product['price'],
                'filter_price_raw' => $product['filter_price_raw'],
            ],
            'offer' => [
                'price' => $offer['price'],
                'filter_price_raw' => $offer['filter_price_raw'],
            ],
        ],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    );
    throw new RuntimeException(
        "Price drift or mixed state for product {$change['product_id']}: {$observed}"
    );
}

function rosomahaPricesPairFingerprint(array $pair): string
{
    return hash(
        'sha256',
        json_encode(
            [
                'product' => $pair['product'],
                'offer' => $pair['offer'],
                'link' => $pair['link'],
            ],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        )
    );
}

function rosomahaPricesElementFingerprint(array $element): string
{
    return hash(
        'sha256',
        json_encode(
            $element,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        )
    );
}

function rosomahaPricesReadPair(array $change): array
{
    $productPrice = rosomahaPricesProperty('product_price');
    $productFilterPrice = rosomahaPricesProperty('product_filter_price');
    $offerPrice = rosomahaPricesProperty('offer_price');
    $offerFilterPrice = rosomahaPricesProperty('offer_filter_price');

    $product = rosomahaPricesReadPriceElement(
        (int) $change['product_id'],
        ROSOMAHA_PRODUCT_IBLOCK_ID,
        (int) $productPrice['id'],
        (int) $productFilterPrice['id']
    );
    if ($product['code'] !== (string) $change['slug']) {
        throw new RuntimeException(
            "Unexpected slug for product {$change['product_id']}: {$product['code']}"
        );
    }

    $offer = rosomahaPricesReadPriceElement(
        (int) $change['offer_id'],
        ROSOMAHA_OFFER_IBLOCK_ID,
        (int) $offerPrice['id'],
        (int) $offerFilterPrice['id']
    );
    $link = rosomahaPricesReadLinkedOffer(
        (int) $change['product_id'],
        (int) $change['offer_id']
    );
    $state = rosomahaPricesClassifyPair($change, $product, $offer);

    $pair = [
        'product_id' => (int) $change['product_id'],
        'offer_id' => (int) $change['offer_id'],
        'slug' => (string) $change['slug'],
        'old_price' => (int) $change['old_price'],
        'new_price' => (int) $change['new_price'],
        'state' => $state,
        'effective_price' => $state === 'new'
            ? (int) $change['new_price']
            : (int) $change['old_price'],
        'product' => $product,
        'offer' => $offer,
        'link' => $link,
    ];
    $pair['snapshot_sha256'] = rosomahaPricesPairFingerprint($pair);

    return $pair;
}

function rosomahaPricesReadAllPairs(): array
{
    $pairs = [];
    foreach (ROSOMAHA_PRICE_CHANGES as $change) {
        rosomahaPricesStage('read-' . (int) $change['product_id'] . '-' . (int) $change['offer_id']);
        $pairs[] = rosomahaPricesReadPair($change);
    }

    return $pairs;
}

function rosomahaPricesEnsureBackupRoot(): string
{
    if (
        !is_dir(ROSOMAHA_PRICE_BACKUP_ROOT)
        && !mkdir(ROSOMAHA_PRICE_BACKUP_ROOT, 0700, true)
        && !is_dir(ROSOMAHA_PRICE_BACKUP_ROOT)
    ) {
        throw new RuntimeException('Could not create the pinned price backup directory');
    }

    $resolved = realpath(ROSOMAHA_PRICE_BACKUP_ROOT);
    if ($resolved !== ROSOMAHA_PRICE_BACKUP_ROOT) {
        throw new RuntimeException('Price backup directory resolved outside the pinned path');
    }

    return $resolved;
}

function rosomahaPricesWriteBackup(array $pairs): array
{
    $backupRoot = rosomahaPricesEnsureBackupRoot();
    $nonce = bin2hex(random_bytes(6));
    $backupPath = $backupRoot . '/' . gmdate('Ymd\THis\Z') . "-{$nonce}-prices.json";
    $payload = [
        'created_at_utc' => gmdate(DATE_ATOM),
        'site_root' => ROSOMAHA_PRICE_SITE_ROOT,
        'product_iblock_id' => ROSOMAHA_PRODUCT_IBLOCK_ID,
        'offer_iblock_id' => ROSOMAHA_OFFER_IBLOCK_ID,
        'property_schema' => ROSOMAHA_PRICE_PROPERTIES,
        'pairs' => $pairs,
    ];
    $json = json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE
            | JSON_UNESCAPED_SLASHES
            | JSON_PRETTY_PRINT
            | JSON_THROW_ON_ERROR
    ) . "\n";

    $previousUmask = umask(0077);
    try {
        $written = file_put_contents($backupPath, $json, LOCK_EX);
    } finally {
        umask($previousUmask);
    }
    if ($written !== strlen($json)) {
        throw new RuntimeException('Could not write the complete price rollback backup');
    }
    if (!chmod($backupPath, 0600)) {
        throw new RuntimeException('Could not restrict price rollback backup permissions');
    }
    clearstatcache(true, $backupPath);
    $permissions = fileperms($backupPath);
    if ($permissions === false || ($permissions & 0777) !== 0600) {
        throw new RuntimeException('Price rollback backup permissions are not 0600');
    }

    return [
        'path' => $backupPath,
        'sha256' => hash_file('sha256', $backupPath),
        'permissions' => '0600',
    ];
}

function rosomahaPricesClearCaches(): void
{
    CIBlock::clearIblockTagCache(ROSOMAHA_PRODUCT_IBLOCK_ID);
    CIBlock::clearIblockTagCache(ROSOMAHA_OFFER_IBLOCK_ID);
}

function rosomahaPricesSetElement(
    int $elementId,
    int $iblockId,
    int $pricePropertyId,
    int $filterPricePropertyId,
    int $amount
): void {
    CIBlockElement::SetPropertyValuesEx(
        $elementId,
        $iblockId,
        [
            $pricePropertyId => rosomahaPricesFormatted($amount),
            $filterPricePropertyId => $amount,
        ]
    );
}

function rosomahaPricesRollback(array $attempted): array
{
    $results = [];
    $errors = [];

    foreach (array_reverse($attempted) as $attempt) {
        $elementId = (int) $attempt['element_id'];
        $iblockId = (int) $attempt['iblock_id'];
        try {
            $current = rosomahaPricesReadPriceElement(
                $elementId,
                $iblockId,
                (int) $attempt['price_property_id'],
                (int) $attempt['filter_price_property_id']
            );
            if (rosomahaPricesElementMatches($current, (int) $attempt['before_amount'])) {
                $results[] = [
                    'element_id' => $elementId,
                    'iblock_id' => $iblockId,
                    'status' => 'already_original',
                ];
                continue;
            }
            if (
                !rosomahaPricesElementWithinTransition(
                    $current,
                    (int) $attempt['before_amount'],
                    (int) $attempt['after_amount']
                )
            ) {
                throw new RuntimeException('Rollback refused because current values changed concurrently');
            }

            rosomahaPricesSetElement(
                $elementId,
                $iblockId,
                (int) $attempt['price_property_id'],
                (int) $attempt['filter_price_property_id'],
                (int) $attempt['before_amount']
            );
            $restored = rosomahaPricesReadPriceElement(
                $elementId,
                $iblockId,
                (int) $attempt['price_property_id'],
                (int) $attempt['filter_price_property_id']
            );
            if (!rosomahaPricesElementMatches($restored, (int) $attempt['before_amount'])) {
                throw new RuntimeException('Rollback database readback did not match the backup');
            }
            $results[] = [
                'element_id' => $elementId,
                'iblock_id' => $iblockId,
                'status' => 'restored',
            ];
        } catch (Throwable $rollbackError) {
            $errors[] = [
                'element_id' => $elementId,
                'iblock_id' => $iblockId,
                'error' => $rollbackError->getMessage(),
            ];
        }
    }

    try {
        rosomahaPricesClearCaches();
    } catch (Throwable $cacheError) {
        $errors[] = [
            'element_id' => null,
            'iblock_id' => null,
            'error' => 'Rollback cache clear failed: ' . $cacheError->getMessage(),
        ];
    }

    return [
        'status' => $errors === [] ? 'ok' : 'failed',
        'results' => $results,
        'errors' => $errors,
    ];
}

if (PHP_SAPI !== 'cli') {
    rosomahaPricesResult(['status' => 'error', 'error' => 'CLI only'], 2);
}

$mode = $argv[1] ?? 'audit';
if (!in_array($mode, ['audit', 'apply'], true)) {
    rosomahaPricesResult(['status' => 'error', 'error' => 'Expected audit or apply'], 2);
}

ini_set('display_errors', '0');
set_time_limit(120);
error_reporting(E_ALL);

$_SERVER['DOCUMENT_ROOT'] = ROSOMAHA_PRICE_SITE_ROOT;
$_SERVER['HTTP_HOST'] = 'rosomaha-rus.ru';
$_SERVER['SERVER_NAME'] = 'rosomaha-rus.ru';
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['HTTPS'] = 'on';
define('NO_KEEP_STATISTIC', true);
define('NO_AGENT_CHECK', true);
define('NOT_CHECK_PERMISSIONS', true);
define('BX_NO_ACCELERATOR_RESET', true);
define('DisableEventsCheck', true);

try {
    rosomahaPricesValidateAllowlist();
    rosomahaPricesStage('bootstrap-start');
    $prolog = ROSOMAHA_PRICE_SITE_ROOT . '/bitrix/modules/main/include/prolog_before.php';
    if (!is_file($prolog)) {
        throw new RuntimeException('Bitrix prolog was not found at the pinned site root');
    }

    ob_start();
    require $prolog;
    ob_end_clean();
    rosomahaPricesStage('bootstrap-complete');

    if (!Bitrix\Main\Loader::includeModule('iblock')) {
        throw new RuntimeException('Bitrix iblock module could not be loaded');
    }
    rosomahaPricesStage('iblock-loaded');

    $schema = rosomahaPricesValidateSchema();
    rosomahaPricesStage('schema-validated');
    $before = rosomahaPricesReadAllPairs();

    if ($mode === 'audit') {
        $oldPairs = count(array_filter($before, static fn(array $pair): bool => $pair['state'] === 'old'));
        rosomahaPricesResult([
            'status' => 'ok',
            'mode' => 'audit',
            'database_mutations' => 0,
            'planned_element_mutations' => $oldPairs * 2,
            'schema' => $schema,
            'database_readback' => $before,
        ]);
    }

    $backup = rosomahaPricesWriteBackup($before);
    rosomahaPricesStage('backup-written');
    $attempted = [];
    $updatedIds = [];

    try {
        foreach (ROSOMAHA_PRICE_CHANGES as $index => $change) {
            $originalPair = $before[$index];
            $freshPair = rosomahaPricesReadPair($change);
            if (!hash_equals($originalPair['snapshot_sha256'], $freshPair['snapshot_sha256'])) {
                throw new RuntimeException(
                    "Concurrent pre-update change detected for product {$change['product_id']}"
                );
            }

            if ($freshPair['state'] === 'new') {
                rosomahaPricesStage('already-new-' . (int) $change['product_id']);
                continue;
            }

            $productPrice = rosomahaPricesProperty('product_price');
            $productFilterPrice = rosomahaPricesProperty('product_filter_price');
            $offerPrice = rosomahaPricesProperty('offer_price');
            $offerFilterPrice = rosomahaPricesProperty('offer_filter_price');

            $attempted[] = [
                'element_id' => (int) $change['product_id'],
                'iblock_id' => ROSOMAHA_PRODUCT_IBLOCK_ID,
                'price_property_id' => (int) $productPrice['id'],
                'filter_price_property_id' => (int) $productFilterPrice['id'],
                'before_amount' => (int) $change['old_price'],
                'after_amount' => (int) $change['new_price'],
            ];
            rosomahaPricesSetElement(
                (int) $change['product_id'],
                ROSOMAHA_PRODUCT_IBLOCK_ID,
                (int) $productPrice['id'],
                (int) $productFilterPrice['id'],
                (int) $change['new_price']
            );
            $productAfter = rosomahaPricesReadPriceElement(
                (int) $change['product_id'],
                ROSOMAHA_PRODUCT_IBLOCK_ID,
                (int) $productPrice['id'],
                (int) $productFilterPrice['id']
            );
            if (!rosomahaPricesElementMatches($productAfter, (int) $change['new_price'])) {
                throw new RuntimeException(
                    "Product price readback failed for {$change['product_id']}"
                );
            }
            $updatedIds[] = [
                'iblock_id' => ROSOMAHA_PRODUCT_IBLOCK_ID,
                'element_id' => (int) $change['product_id'],
            ];

            $offerFresh = rosomahaPricesReadPriceElement(
                (int) $change['offer_id'],
                ROSOMAHA_OFFER_IBLOCK_ID,
                (int) $offerPrice['id'],
                (int) $offerFilterPrice['id']
            );
            if (
                !hash_equals(
                    rosomahaPricesElementFingerprint($originalPair['offer']),
                    rosomahaPricesElementFingerprint($offerFresh)
                )
            ) {
                throw new RuntimeException(
                    "Concurrent offer change detected for {$change['offer_id']}"
                );
            }

            $attempted[] = [
                'element_id' => (int) $change['offer_id'],
                'iblock_id' => ROSOMAHA_OFFER_IBLOCK_ID,
                'price_property_id' => (int) $offerPrice['id'],
                'filter_price_property_id' => (int) $offerFilterPrice['id'],
                'before_amount' => (int) $change['old_price'],
                'after_amount' => (int) $change['new_price'],
            ];
            rosomahaPricesSetElement(
                (int) $change['offer_id'],
                ROSOMAHA_OFFER_IBLOCK_ID,
                (int) $offerPrice['id'],
                (int) $offerFilterPrice['id'],
                (int) $change['new_price']
            );
            $offerAfter = rosomahaPricesReadPriceElement(
                (int) $change['offer_id'],
                ROSOMAHA_OFFER_IBLOCK_ID,
                (int) $offerPrice['id'],
                (int) $offerFilterPrice['id']
            );
            if (!rosomahaPricesElementMatches($offerAfter, (int) $change['new_price'])) {
                throw new RuntimeException(
                    "Offer price readback failed for {$change['offer_id']}"
                );
            }
            $updatedIds[] = [
                'iblock_id' => ROSOMAHA_OFFER_IBLOCK_ID,
                'element_id' => (int) $change['offer_id'],
            ];

            $pairAfter = rosomahaPricesReadPair($change);
            if ($pairAfter['state'] !== 'new') {
                throw new RuntimeException(
                    "Pair readback failed for product {$change['product_id']}"
                );
            }
            rosomahaPricesStage('updated-' . (int) $change['product_id'] . '-' . (int) $change['offer_id']);
        }

        rosomahaPricesClearCaches();
        rosomahaPricesStage('caches-cleared');
        $after = rosomahaPricesReadAllPairs();
        foreach ($after as $pair) {
            if ($pair['state'] !== 'new') {
                throw new RuntimeException(
                    "Final database readback is not new for product {$pair['product_id']}"
                );
            }
        }
    } catch (Throwable $updateError) {
        $rollback = rosomahaPricesRollback($attempted);
        rosomahaPricesResult([
            'status' => 'error',
            'mode' => 'apply',
            'error' => $updateError->getMessage(),
            'database_mutations_before_rollback' => count($updatedIds),
            'rollback' => $rollback,
            'backup_path' => $backup['path'],
            'backup_sha256' => $backup['sha256'],
        ], 1);
    }

    rosomahaPricesResult([
        'status' => 'ok',
        'mode' => 'apply',
        'database_mutations' => count($updatedIds),
        'property_values_changed' => count($updatedIds) * 2,
        'updated_ids' => $updatedIds,
        'backup_path' => $backup['path'],
        'backup_sha256' => $backup['sha256'],
        'backup_permissions' => $backup['permissions'],
        'schema' => $schema,
        'before' => $before,
        'database_readback' => $after,
    ]);
} catch (Throwable $error) {
    if (ob_get_level() > 0) {
        ob_end_clean();
    }

    rosomahaPricesResult([
        'status' => 'error',
        'mode' => $mode,
        'error' => $error->getMessage(),
    ], 1);
}
