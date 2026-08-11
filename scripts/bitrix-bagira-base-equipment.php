<?php

declare(strict_types=1);

const ROSOMAHA_SITE_ROOT = '/home/b/berkutm4/rosomaha-rus.ru/public_html';
const ROSOMAHA_BACKUP_ROOT = '/home/b/berkutm4/migration/rosomaha-rus/backups/bitrix-bagira';
const ROSOMAHA_IBLOCK_ID = 86;
const ROSOMAHA_AUTOROS_ROW = '<li>Заводские колёса Авторос 1200х600</li>';
const ROSOMAHA_BAGIRA_ROW = '<li>Заводские колёса Багира 1200х600</li>';

const ROSOMAHA_PRODUCTS = [
    768 => [
        'offer_id' => 812,
        'slug' => 'extrime-s-1-5l-dvs-1nz-fe',
    ],
    879 => [
        'offer_id' => 824,
        'slug' => 'extrime-1-5-litra-mosty-toyota',
    ],
    770 => [
        'offer_id' => 800,
        'slug' => 'hunter-s-1-5l-dvs-1nz-fe',
    ],
];

function rosomahaResult(array $payload, int $exitCode = 0): void
{
    echo json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ), PHP_EOL;
    exit($exitCode);
}

function rosomahaStage(string $stage): void
{
    fwrite(STDERR, "STAGE:{$stage}\n");
}

function rosomahaReadProduct(int $productId): array
{
    $result = CIBlockElement::GetList(
        [],
        [
            'ID' => $productId,
            'IBLOCK_ID' => ROSOMAHA_IBLOCK_ID,
        ],
        false,
        false,
        [
            'ID',
            'NAME',
            'IBLOCK_ID',
            'PREVIEW_TEXT',
            'PREVIEW_TEXT_TYPE',
            'TIMESTAMP_X',
            'MODIFIED_BY',
        ]
    );
    $fields = $result->Fetch();

    if (!is_array($fields)) {
        throw new RuntimeException("Bitrix product {$productId} was not found");
    }

    $previewText = (string) ($fields['PREVIEW_TEXT'] ?? '');

    return [
        'id' => $productId,
        'name' => (string) ($fields['NAME'] ?? ''),
        'iblock_id' => (int) ($fields['IBLOCK_ID'] ?? 0),
        'preview_text_type' => strtolower((string) ($fields['PREVIEW_TEXT_TYPE'] ?? '')),
        'modified_at' => (string) ($fields['TIMESTAMP_X'] ?? ''),
        'modified_by' => (int) ($fields['MODIFIED_BY'] ?? 0),
        'preview_text' => $previewText,
        'preview_sha256' => hash('sha256', $previewText),
        'autoros_count' => substr_count($previewText, ROSOMAHA_AUTOROS_ROW),
        'bagira_count' => substr_count($previewText, ROSOMAHA_BAGIRA_ROW),
    ];
}

function rosomahaPublicProduct(array $product): array
{
    return [
        'id' => $product['id'],
        'name' => $product['name'],
        'iblock_id' => $product['iblock_id'],
        'preview_text_type' => $product['preview_text_type'],
        'modified_at' => $product['modified_at'],
        'modified_by' => $product['modified_by'],
        'preview_sha256' => $product['preview_sha256'],
        'autoros_count' => $product['autoros_count'],
        'bagira_count' => $product['bagira_count'],
    ];
}

function rosomahaValidateProduct(array $product): void
{
    if ($product['iblock_id'] !== ROSOMAHA_IBLOCK_ID) {
        throw new RuntimeException(
            "Unexpected iblock {$product['iblock_id']} for product {$product['id']}"
        );
    }

    if ($product['preview_text_type'] !== 'html') {
        throw new RuntimeException(
            "Unexpected PREVIEW_TEXT_TYPE for product {$product['id']}"
        );
    }

    if ($product['autoros_count'] !== 1) {
        throw new RuntimeException(
            "Autoros anchor count must be 1 for product {$product['id']}"
        );
    }

    if ($product['bagira_count'] > 1) {
        throw new RuntimeException(
            "Bagira row is duplicated for product {$product['id']}"
        );
    }
}

function rosomahaRollback(array $before, array $updatedIds): array
{
    $rollbackErrors = [];
    $element = new CIBlockElement();

    foreach (array_reverse($updatedIds) as $productId) {
        $original = $before[$productId];
        $ok = $element->Update($productId, [
            'PREVIEW_TEXT' => $original['preview_text'],
            'PREVIEW_TEXT_TYPE' => $original['preview_text_type'],
        ]);

        if (!$ok) {
            $rollbackErrors[] = [
                'id' => $productId,
                'error' => (string) $element->LAST_ERROR,
            ];
        }
    }

    CIBlock::clearIblockTagCache(ROSOMAHA_IBLOCK_ID);

    return $rollbackErrors;
}

if (PHP_SAPI !== 'cli') {
    rosomahaResult(['status' => 'error', 'error' => 'CLI only'], 2);
}

$mode = $argv[1] ?? 'audit';
if (!in_array($mode, ['audit', 'apply'], true)) {
    rosomahaResult(['status' => 'error', 'error' => 'Expected audit or apply'], 2);
}

ini_set('display_errors', '0');
set_time_limit(60);
error_reporting(E_ALL);

$_SERVER['DOCUMENT_ROOT'] = ROSOMAHA_SITE_ROOT;
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
    rosomahaStage('bootstrap-start');
    $prolog = ROSOMAHA_SITE_ROOT . '/bitrix/modules/main/include/prolog_before.php';
    if (!is_file($prolog)) {
        throw new RuntimeException('Bitrix prolog was not found at the pinned site root');
    }

    ob_start();
    require $prolog;
    ob_end_clean();
    rosomahaStage('bootstrap-complete');

    if (!Bitrix\Main\Loader::includeModule('iblock')) {
        throw new RuntimeException('Bitrix iblock module could not be loaded');
    }
    rosomahaStage('iblock-loaded');

    $before = [];
    foreach (array_keys(ROSOMAHA_PRODUCTS) as $productId) {
        rosomahaStage("read-{$productId}");
        $product = rosomahaReadProduct($productId);
        rosomahaValidateProduct($product);
        $before[$productId] = $product;
    }

    if ($mode === 'audit') {
        rosomahaStage('audit-complete');
        rosomahaResult([
            'status' => 'ok',
            'mode' => 'audit',
            'database_mutations' => 0,
            'products' => array_map('rosomahaPublicProduct', array_values($before)),
        ]);
    }

    $backupRoot = ROSOMAHA_BACKUP_ROOT;
    if (!is_dir($backupRoot) && !mkdir($backupRoot, 0700, true) && !is_dir($backupRoot)) {
        throw new RuntimeException('Could not create the pinned backup directory');
    }

    $resolvedBackupRoot = realpath($backupRoot);
    if ($resolvedBackupRoot !== ROSOMAHA_BACKUP_ROOT) {
        throw new RuntimeException('Backup directory resolved outside the pinned path');
    }

    $timestamp = gmdate('Ymd\THis\Z');
    $backupPath = $backupRoot . "/{$timestamp}-preview-text.json";
    $backupPayload = [
        'created_at_utc' => gmdate(DATE_ATOM),
        'site_root' => ROSOMAHA_SITE_ROOT,
        'iblock_id' => ROSOMAHA_IBLOCK_ID,
        'autoros_row' => ROSOMAHA_AUTOROS_ROW,
        'bagira_row' => ROSOMAHA_BAGIRA_ROW,
        'products' => [],
    ];

    foreach ($before as $productId => $product) {
        $backupPayload['products'][] = [
            'id' => $productId,
            'name' => $product['name'],
            'preview_text_type' => $product['preview_text_type'],
            'preview_text' => $product['preview_text'],
            'preview_sha256' => $product['preview_sha256'],
        ];
    }

    $backupJson = json_encode(
        $backupPayload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR
    );
    if (file_put_contents($backupPath, $backupJson, LOCK_EX) === false) {
        throw new RuntimeException('Could not write the rollback receipt');
    }
    if (!chmod($backupPath, 0600)) {
        throw new RuntimeException('Could not restrict rollback receipt permissions');
    }

    $updatedIds = [];
    $expectedAfter = [];
    $element = new CIBlockElement();

    try {
        foreach ($before as $productId => $product) {
            $freshProduct = rosomahaReadProduct($productId);
            if ($freshProduct['preview_sha256'] !== $product['preview_sha256']) {
                throw new RuntimeException(
                    "Concurrent PREVIEW_TEXT change detected for product {$productId}"
                );
            }

            if ($product['bagira_count'] === 1) {
                $expectedAfter[$productId] = $product['preview_text'];
                continue;
            }

            $updatedText = str_replace(
                ROSOMAHA_AUTOROS_ROW,
                ROSOMAHA_AUTOROS_ROW . "\n" . ROSOMAHA_BAGIRA_ROW,
                $product['preview_text'],
                $replacementCount
            );

            if ($replacementCount !== 1) {
                throw new RuntimeException(
                    "Unexpected replacement count for product {$productId}"
                );
            }
            $expectedAfter[$productId] = $updatedText;

            $ok = $element->Update($productId, [
                'PREVIEW_TEXT' => $updatedText,
                'PREVIEW_TEXT_TYPE' => 'html',
            ]);
            if (!$ok) {
                throw new RuntimeException(
                    "Bitrix update failed for product {$productId}: {$element->LAST_ERROR}"
                );
            }

            $updatedIds[] = $productId;
            rosomahaStage("updated-{$productId}");
        }

        CIBlock::clearIblockTagCache(ROSOMAHA_IBLOCK_ID);

        $after = [];
        foreach (array_keys(ROSOMAHA_PRODUCTS) as $productId) {
            rosomahaStage("verify-{$productId}");
            $product = rosomahaReadProduct($productId);
            rosomahaValidateProduct($product);
            if ($product['preview_text'] !== $expectedAfter[$productId]) {
                throw new RuntimeException(
                    "Unexpected PREVIEW_TEXT readback for product {$productId}"
                );
            }
            if ($product['bagira_count'] !== 1) {
                throw new RuntimeException(
                    "Bagira row verification failed for product {$productId}"
                );
            }
            $after[$productId] = $product;
        }
    } catch (Throwable $updateError) {
        $rollbackErrors = rosomahaRollback($before, $updatedIds);
        rosomahaResult([
            'status' => 'error',
            'mode' => 'apply',
            'error' => $updateError->getMessage(),
            'rollback_status' => $rollbackErrors === [] ? 'ok' : 'failed',
            'rollback_errors' => $rollbackErrors,
            'backup_path' => $backupPath,
        ], 1);
    }

    rosomahaResult([
        'status' => 'ok',
        'mode' => 'apply',
        'database_mutations' => count($updatedIds),
        'updated_ids' => $updatedIds,
        'backup_path' => $backupPath,
        'before' => array_map('rosomahaPublicProduct', array_values($before)),
        'after' => array_map('rosomahaPublicProduct', array_values($after)),
    ]);
} catch (Throwable $error) {
    if (ob_get_level() > 0) {
        ob_end_clean();
    }

    rosomahaResult([
        'status' => 'error',
        'mode' => $mode,
        'error' => $error->getMessage(),
    ], 1);
}
