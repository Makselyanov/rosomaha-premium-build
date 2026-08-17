<?php

declare(strict_types=1);

/**
 * Receipt-bound Bitrix operator for one image change on element 952.
 *
 * The script is intentionally CLI-only and has no generic element, property,
 * path, host, or file arguments.  The Python wrapper supplies one signed JSON
 * operation payload after it has captured the exact read-only preimage.
 */

const ROSOMAHA_COFFER_SITE_ROOT = '/home/b/berkutm4/rosomaha-rus.ru/public_html';
const ROSOMAHA_COFFER_DOMAIN = 'rosomaha-rus.ru';
const ROSOMAHA_COFFER_SITE_ID = 's1';
const ROSOMAHA_COFFER_IBLOCK_ID = 86;
const ROSOMAHA_COFFER_ELEMENT_ID = 952;
const ROSOMAHA_COFFER_ELEMENT_CODE = 'zadniy-kofr-plastikovyy-ekstrim-trekhsektsionnyy';
const ROSOMAHA_COFFER_ELEMENT_NAME = 'Задний кофр, пластиковый трехсекционный ЭКСТРИМ';
const ROSOMAHA_COFFER_PRIMARY_SECTION_ID = 340;
const ROSOMAHA_COFFER_SORT = 102;
const ROSOMAHA_COFFER_PHOTOS_PROPERTY_ID = 1201;
const ROSOMAHA_COFFER_LINK_GOODS_PROPERTY_ID = 1219;
const ROSOMAHA_COFFER_OPERATION_ROOT = '/home/b/berkutm4/migration/rosomaha-rus/ops/bitrix-coffer-image';
const ROSOMAHA_COFFER_SOURCE_SHA256 = '14d3973bbc0cab0cdcf43e88e97b1632116f0e4219837fd2fb36d07b43ff0eb6';
const ROSOMAHA_COFFER_SOURCE_BYTES = 837737;
const ROSOMAHA_COFFER_SOURCE_WIDTH = 3000;
const ROSOMAHA_COFFER_SOURCE_HEIGHT = 2636;
const ROSOMAHA_COFFER_ORIGINAL_SHA256 = 'a14f20ca64d2fe70f06a0915f127136bf30a58a20d1d186c69e9cf21e62866fd';
const ROSOMAHA_COFFER_BASELINE_DETAIL_ID = 3883;
const ROSOMAHA_COFFER_PREVIEW_ID = 3335;
const ROSOMAHA_COFFER_PHOTOS_APPEND_CLONE_PROOF = false;
const ROSOMAHA_COFFER_CLONE_PROOF_RECEIPT_SHA256 = null;
const ROSOMAHA_COFFER_THUMBNAIL_SHA256 = null;
const ROSOMAHA_COFFER_THUMBNAIL_BYTES = null;
const ROSOMAHA_COFFER_THUMBNAIL_WIDTH = null;
const ROSOMAHA_COFFER_THUMBNAIL_HEIGHT = null;
const ROSOMAHA_COFFER_MAX_FILE_BYTES = 8000000;
const ROSOMAHA_COFFER_MAX_PROPERTIES = 192;
const ROSOMAHA_COFFER_MAX_VALUES = 128;
const ROSOMAHA_COFFER_MAX_STRING_BYTES = 2048;
const ROSOMAHA_COFFER_MAX_TEXT_BYTES = 2000000;
const ROSOMAHA_COFFER_MAX_PAYLOAD_BYTES = 131072;
const ROSOMAHA_COFFER_MAX_ERROR_BYTES = 4096;

const ROSOMAHA_COFFER_MODEL_IDS = [768, 879, 769];
const ROSOMAHA_COFFER_MODEL_CODES = [
    'extrime-s-1-5l-dvs-1nz-fe',
    'extrime-1-5-litra-mosty-toyota',
    'extrime-plus-s-1-8l-dvs-1zz-fe',
];

function rosomahaCofferEmit(array $payload, int $exitCode = 0): never
{
    $json = json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    );
    echo '__ROSOMAHA_COFFER_JSON_BYTES__=', strlen($json), PHP_EOL;
    echo '__ROSOMAHA_COFFER_JSON_SHA256__=', hash('sha256', $json), PHP_EOL;
    echo '__ROSOMAHA_COFFER_JSON_BASE64__=', base64_encode($json), PHP_EOL;
    exit($exitCode);
}

function rosomahaCofferCanonical(mixed $value, int $depth = 0): mixed
{
    if ($depth > 12) {
        throw new RuntimeException('canonical_depth_exceeded');
    }
    if (!is_array($value)) {
        return $value;
    }
    if (array_is_list($value)) {
        return array_map(
            static fn(mixed $item): mixed => rosomahaCofferCanonical($item, $depth + 1),
            $value
        );
    }
    ksort($value, SORT_STRING);
    foreach ($value as $key => $item) {
        $value[$key] = rosomahaCofferCanonical($item, $depth + 1);
    }
    return $value;
}

function rosomahaCofferHash(mixed $value): string
{
    return hash(
        'sha256',
        json_encode(
            rosomahaCofferCanonical($value),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        )
    );
}

function rosomahaCofferString(mixed $value, string $error): string
{
    if (!is_string($value) || strlen($value) > ROSOMAHA_COFFER_MAX_STRING_BYTES) {
        throw new RuntimeException($error);
    }
    return $value;
}

function rosomahaCofferPositiveInt(mixed $value, string $error): int
{
    if (is_int($value) && $value > 0) {
        return $value;
    }
    if (is_string($value) && preg_match('/^[1-9][0-9]*$/D', $value) === 1) {
        return (int) $value;
    }
    throw new RuntimeException($error);
}

function rosomahaCofferFileSnapshot(int $fileId): array
{
    if ($fileId <= 0) {
        throw new RuntimeException('file_id_invalid');
    }
    $row = CFile::GetFileArray($fileId);
    if (!is_array($row) || (int) ($row['ID'] ?? 0) !== $fileId) {
        throw new RuntimeException('file_not_found');
    }
    $relative = rosomahaCofferString($row['SRC'] ?? '', 'file_src_invalid');
    if (!str_starts_with($relative, '/upload/') || str_contains($relative, '..')) {
        throw new RuntimeException('file_src_outside_upload');
    }
    $absolute = ROSOMAHA_COFFER_SITE_ROOT . $relative;
    $real = realpath($absolute);
    $uploadRoot = realpath(ROSOMAHA_COFFER_SITE_ROOT . '/upload');
    $fileStat = is_string($real) ? lstat($real) : false;
    if (!is_string($real) || !is_string($uploadRoot)
        || !str_starts_with($real, $uploadRoot . DIRECTORY_SEPARATOR)
        || !is_file($real) || is_link($real) || !is_array($fileStat)
        || (int) ($fileStat['nlink'] ?? 0) !== 1) {
        throw new RuntimeException('file_realpath_invalid');
    }
    $bytes = filesize($real);
    if (!is_int($bytes) || $bytes < 1 || $bytes > ROSOMAHA_COFFER_MAX_FILE_BYTES) {
        throw new RuntimeException('file_size_invalid');
    }
    $image = getimagesize($real);
    if (!is_array($image) || ($image[2] ?? null) !== IMAGETYPE_JPEG) {
        throw new RuntimeException('file_not_jpeg');
    }
    $sha = hash_file('sha256', $real);
    if (!is_string($sha) || preg_match('/^[a-f0-9]{64}$/D', $sha) !== 1) {
        throw new RuntimeException('file_hash_invalid');
    }
    return [
        'id' => $fileId,
        'relative_path' => $relative,
        'sha256' => $sha,
        'bytes' => $bytes,
        'width' => (int) $image[0],
        'height' => (int) $image[1],
        'mime' => 'image/jpeg',
    ];
}

function rosomahaCofferElementFields(int $id): array
{
    $result = CIBlockElement::GetList(
        [],
        ['IBLOCK_ID' => ROSOMAHA_COFFER_IBLOCK_ID, 'ID' => $id],
        false,
        false,
        [
            'ID', 'IBLOCK_ID', 'IBLOCK_SECTION_ID', 'CODE', 'XML_ID', 'NAME',
            'ACTIVE', 'SORT', 'PREVIEW_PICTURE', 'DETAIL_PICTURE',
            'PREVIEW_TEXT', 'PREVIEW_TEXT_TYPE', 'DETAIL_TEXT',
            'DETAIL_TEXT_TYPE', 'DETAIL_PAGE_URL',
        ]
    );
    $fields = $result->GetNext(false, false);
    if (!is_array($fields) || (int) ($fields['ID'] ?? 0) !== $id) {
        throw new RuntimeException('element_not_found');
    }
    return $fields;
}

function rosomahaCofferTextEvidence(mixed $value, mixed $type): array
{
    $text = $value ?? '';
    if (!is_string($text) || strlen($text) > ROSOMAHA_COFFER_MAX_TEXT_BYTES) {
        throw new RuntimeException('element_text_invalid');
    }
    $textType = rosomahaCofferString($type ?? '', 'element_text_type_invalid');
    if (!in_array($textType, ['', 'text', 'html'], true)) {
        throw new RuntimeException('element_text_type_invalid');
    }
    return [
        'type' => $textType,
        'bytes' => strlen($text),
        'sha256' => hash('sha256', $text),
    ];
}

function rosomahaCofferSections(int $id): array
{
    $ids = [];
    $result = CIBlockElement::GetElementGroups($id, true, ['ID']);
    while ($row = $result->Fetch()) {
        $sectionId = rosomahaCofferPositiveInt($row['ID'] ?? null, 'section_id_invalid');
        $ids[] = $sectionId;
        if (count($ids) > 32) {
            throw new RuntimeException('section_scope_exceeded');
        }
    }
    $ids = array_values(array_unique($ids));
    sort($ids, SORT_NUMERIC);
    return $ids;
}

function rosomahaCofferPropertyRows(int $elementId, ?int $onlyPropertyId = null): array
{
    $filter = $onlyPropertyId === null ? [] : ['ID' => $onlyPropertyId];
    $result = CIBlockElement::GetProperty(
        ROSOMAHA_COFFER_IBLOCK_ID,
        $elementId,
        ['sort' => 'asc', 'id' => 'asc'],
        $filter
    );
    $rows = [];
    while ($row = $result->Fetch()) {
        $propertyId = rosomahaCofferPositiveInt($row['ID'] ?? null, 'property_id_invalid');
        $valueId = $row['PROPERTY_VALUE_ID'] ?? null;
        if ($valueId !== null && $valueId !== false && $valueId !== '') {
            $valueId = rosomahaCofferPositiveInt($valueId, 'property_value_id_invalid');
        } else {
            $valueId = null;
        }
        $value = $row['VALUE'] ?? null;
        if (is_string($value) && strlen($value) > ROSOMAHA_COFFER_MAX_STRING_BYTES) {
            $value = [
                'bytes' => strlen($value),
                'sha256' => hash('sha256', $value),
            ];
        } elseif (is_array($value)) {
            $value = rosomahaCofferCanonical($value);
        } elseif (!is_null($value) && !is_bool($value) && !is_int($value) && !is_float($value) && !is_string($value)) {
            throw new RuntimeException('property_value_type_invalid');
        }
        $rows[] = [
            'property_id' => $propertyId,
            'property_code' => rosomahaCofferString($row['CODE'] ?? '', 'property_code_invalid'),
            'property_type' => rosomahaCofferString($row['PROPERTY_TYPE'] ?? '', 'property_type_invalid'),
            'multiple' => ($row['MULTIPLE'] ?? 'N') === 'Y',
            'property_value_id' => $valueId,
            'value' => $value,
            'description' => rosomahaCofferString($row['DESCRIPTION'] ?? '', 'property_description_invalid'),
        ];
        if (count($rows) > ROSOMAHA_COFFER_MAX_PROPERTIES * ROSOMAHA_COFFER_MAX_VALUES) {
            throw new RuntimeException('property_row_scope_exceeded');
        }
    }
    return $rows;
}

function rosomahaCofferPhotoRows(): array
{
    $rows = [];
    foreach (rosomahaCofferPropertyRows(
        ROSOMAHA_COFFER_ELEMENT_ID,
        ROSOMAHA_COFFER_PHOTOS_PROPERTY_ID
    ) as $row) {
        if ($row['property_type'] !== 'F' || $row['multiple'] !== true
            || $row['property_value_id'] === null) {
            throw new RuntimeException('photos_property_shape_invalid');
        }
        $fileId = rosomahaCofferPositiveInt($row['value'], 'photo_file_id_invalid');
        $rows[] = [
            'property_value_id' => $row['property_value_id'],
            'description' => $row['description'],
            'file' => rosomahaCofferFileSnapshot($fileId),
        ];
        if (count($rows) > 16) {
            throw new RuntimeException('photos_count_exceeded');
        }
    }
    return $rows;
}

function rosomahaCofferNonPhotoProperties(): array
{
    $rows = array_values(array_filter(
        rosomahaCofferPropertyRows(ROSOMAHA_COFFER_ELEMENT_ID),
        static fn(array $row): bool => $row['property_id'] !== ROSOMAHA_COFFER_PHOTOS_PROPERTY_ID
    ));
    return [
        'row_count' => count($rows),
        'sha256' => rosomahaCofferHash($rows),
    ];
}

function rosomahaCofferMetadataTemplates(): array
{
    $reader = new Bitrix\Iblock\InheritedProperty\ElementTemplates(
        ROSOMAHA_COFFER_IBLOCK_ID,
        ROSOMAHA_COFFER_ELEMENT_ID
    );
    $templates = $reader->findTemplates();
    if (!is_array($templates)) {
        throw new RuntimeException('metadata_templates_invalid');
    }
    ksort($templates, SORT_STRING);
    return [
        'keys' => array_keys($templates),
        'sha256' => rosomahaCofferHash($templates),
    ];
}

function rosomahaCofferModelSnapshots(): array
{
    $models = [];
    foreach (ROSOMAHA_COFFER_MODEL_IDS as $index => $modelId) {
        $fields = rosomahaCofferElementFields($modelId);
        if ((string) ($fields['CODE'] ?? '') !== ROSOMAHA_COFFER_MODEL_CODES[$index]) {
            throw new RuntimeException('model_identity_drift');
        }
        $links = [];
        foreach (rosomahaCofferPropertyRows(
            $modelId,
            ROSOMAHA_COFFER_LINK_GOODS_PROPERTY_ID
        ) as $row) {
            $links[] = rosomahaCofferPositiveInt($row['value'], 'model_link_invalid');
        }
        if (count(array_keys($links, ROSOMAHA_COFFER_ELEMENT_ID, true)) !== 1) {
            throw new RuntimeException('model_target_link_count_invalid');
        }
        $models[] = [
            'id' => $modelId,
            'code' => ROSOMAHA_COFFER_MODEL_CODES[$index],
            'target_position' => array_search(ROSOMAHA_COFFER_ELEMENT_ID, $links, true),
            'link_count' => count($links),
            'links_sha256' => rosomahaCofferHash($links),
        ];
    }
    return $models;
}

function rosomahaCofferState(): array
{
    $fields = rosomahaCofferElementFields(ROSOMAHA_COFFER_ELEMENT_ID);
    if ((int) ($fields['IBLOCK_ID'] ?? 0) !== ROSOMAHA_COFFER_IBLOCK_ID
        || (string) ($fields['CODE'] ?? '') !== ROSOMAHA_COFFER_ELEMENT_CODE
        || (string) ($fields['NAME'] ?? '') !== ROSOMAHA_COFFER_ELEMENT_NAME
        || (string) ($fields['ACTIVE'] ?? '') !== 'Y'
        || (int) ($fields['SORT'] ?? 0) !== ROSOMAHA_COFFER_SORT
        || (int) ($fields['IBLOCK_SECTION_ID'] ?? 0) !== ROSOMAHA_COFFER_PRIMARY_SECTION_ID) {
        throw new RuntimeException('element_identity_drift');
    }
    $previewId = rosomahaCofferPositiveInt(
        $fields['PREVIEW_PICTURE'] ?? null,
        'preview_picture_missing'
    );
    $detailId = rosomahaCofferPositiveInt(
        $fields['DETAIL_PICTURE'] ?? null,
        'detail_picture_missing'
    );
    $sections = rosomahaCofferSections(ROSOMAHA_COFFER_ELEMENT_ID);
    if (!in_array(ROSOMAHA_COFFER_PRIMARY_SECTION_ID, $sections, true)) {
        throw new RuntimeException('primary_section_missing');
    }
    $photos = rosomahaCofferPhotoRows();
    $models = rosomahaCofferModelSnapshots();
    $invariants = [
        'fields' => [
            'id' => ROSOMAHA_COFFER_ELEMENT_ID,
            'iblock_id' => ROSOMAHA_COFFER_IBLOCK_ID,
            'primary_section_id' => ROSOMAHA_COFFER_PRIMARY_SECTION_ID,
            'code' => ROSOMAHA_COFFER_ELEMENT_CODE,
            'xml_id' => (string) ($fields['XML_ID'] ?? ''),
            'name' => ROSOMAHA_COFFER_ELEMENT_NAME,
            'active' => true,
            'sort' => ROSOMAHA_COFFER_SORT,
            'detail_page_url' => (string) ($fields['DETAIL_PAGE_URL'] ?? ''),
            'preview_text' => rosomahaCofferTextEvidence(
                $fields['PREVIEW_TEXT'] ?? '',
                $fields['PREVIEW_TEXT_TYPE'] ?? ''
            ),
            'detail_text' => rosomahaCofferTextEvidence(
                $fields['DETAIL_TEXT'] ?? '',
                $fields['DETAIL_TEXT_TYPE'] ?? ''
            ),
        ],
        'preview_picture' => rosomahaCofferFileSnapshot($previewId),
        'sections' => $sections,
        'non_photo_properties' => rosomahaCofferNonPhotoProperties(),
        'metadata_templates' => rosomahaCofferMetadataTemplates(),
        'models' => $models,
    ];
    $state = [
        'element_id' => ROSOMAHA_COFFER_ELEMENT_ID,
        'code' => ROSOMAHA_COFFER_ELEMENT_CODE,
        'detail_picture' => rosomahaCofferFileSnapshot($detailId),
        'photos' => $photos,
        'invariants' => $invariants,
        'invariant_sha256' => rosomahaCofferHash($invariants),
    ];
    $state['gallery_sha256'] = [
        $state['detail_picture']['sha256'],
        ...array_map(static fn(array $row): string => $row['file']['sha256'], $photos),
    ];
    $state['state_sha256'] = rosomahaCofferHash($state);
    return $state;
}

function rosomahaCofferOperationId(array $before): string
{
    $seed = implode('|', [
        (string) ROSOMAHA_COFFER_ELEMENT_ID,
        ROSOMAHA_COFFER_SOURCE_SHA256,
        rosomahaCofferString($before['state_sha256'] ?? null, 'before_hash_invalid'),
    ]);
    return 'bitrix-coffer-' . substr(hash('sha256', $seed), 0, 24);
}

function rosomahaCofferExactKeys(array $value, array $expected): bool
{
    $actual = array_keys($value);
    sort($actual, SORT_STRING);
    sort($expected, SORT_STRING);
    return $actual === $expected;
}

function rosomahaCofferValidatePayloadFile(array $file, ?int $expectedId = null): void
{
    if (!rosomahaCofferExactKeys(
        $file,
        ['id', 'relative_path', 'sha256', 'bytes', 'width', 'height', 'mime']
    )) {
        throw new RuntimeException('operation_contract_failed');
    }
    $id = rosomahaCofferPositiveInt($file['id'] ?? null, 'operation_contract_failed');
    $relative = rosomahaCofferString(
        $file['relative_path'] ?? null,
        'operation_contract_failed'
    );
    if (($expectedId !== null && $id !== $expectedId)
        || !str_starts_with($relative, '/upload/') || str_contains($relative, '..')
        || preg_match('/^[a-f0-9]{64}$/D', (string) ($file['sha256'] ?? '')) !== 1
        || !is_int($file['bytes'] ?? null) || $file['bytes'] < 1
        || $file['bytes'] > ROSOMAHA_COFFER_MAX_FILE_BYTES
        || !is_int($file['width'] ?? null) || $file['width'] < 1 || $file['width'] > 20000
        || !is_int($file['height'] ?? null) || $file['height'] < 1 || $file['height'] > 20000
        || ($file['mime'] ?? null) !== 'image/jpeg') {
        throw new RuntimeException('operation_contract_failed');
    }
}

function rosomahaCofferPayload(array $argv, string $mode): array
{
    if (!in_array($mode, ['apply', 'recover', 'rollback'], true) || count($argv) !== 5) {
        throw new RuntimeException('operation_contract_failed');
    }
    $raw = base64_decode((string) $argv[3], true);
    if (!is_string($raw) || $raw === '' || strlen($raw) > ROSOMAHA_COFFER_MAX_PAYLOAD_BYTES
        || preg_match('/^[a-f0-9]{64}$/D', (string) $argv[4]) !== 1
        || !hash_equals((string) $argv[4], hash('sha256', $raw))) {
        throw new RuntimeException('operation_contract_failed');
    }
    $payload = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($payload)) {
        throw new RuntimeException('operation_contract_failed');
    }
    if (!rosomahaCofferExactKeys(
        $payload,
        ['backups', 'before', 'expected', 'operation_id', 'schema', 'source']
    )
        || ($payload['schema'] ?? null) !== 1
        || !is_array($payload['before'] ?? null)
        || !is_array($payload['expected'] ?? null)
        || !is_array($payload['source'] ?? null)
        || !is_array($payload['backups'] ?? null)
        || ($payload['operation_id'] ?? null) !== ($argv[2] ?? null)
        || ($payload['operation_id'] ?? null) !== rosomahaCofferOperationId($payload['before'])) {
        throw new RuntimeException('operation_contract_failed');
    }
    $before = $payload['before'];
    if (!rosomahaCofferExactKeys(
        $before,
        [
            'element_id', 'code', 'detail_picture', 'photos', 'invariants',
            'invariant_sha256', 'gallery_sha256', 'state_sha256',
        ]
    )
        || ($before['element_id'] ?? null) !== ROSOMAHA_COFFER_ELEMENT_ID
        || ($payload['before']['code'] ?? null) !== ROSOMAHA_COFFER_ELEMENT_CODE
        || preg_match('/^[a-f0-9]{64}$/D', (string) ($payload['before']['state_sha256'] ?? '')) !== 1
        || preg_match('/^[a-f0-9]{64}$/D', (string) ($payload['before']['invariant_sha256'] ?? '')) !== 1
        || !is_array($payload['before']['detail_picture'] ?? null)
        || !is_array($payload['before']['photos'] ?? null)
        || count($payload['before']['photos']) !== 8) {
        throw new RuntimeException('operation_contract_failed');
    }
    $beforeWithoutHash = $before;
    unset($beforeWithoutHash['state_sha256']);
    if (!hash_equals((string) $before['state_sha256'], rosomahaCofferHash($beforeWithoutHash))
        || !hash_equals(
            (string) $before['invariant_sha256'],
            rosomahaCofferHash($before['invariants'])
        )
        || !is_array($before['invariants']['preview_picture'] ?? null)
        || ($before['invariants']['preview_picture']['id'] ?? null)
            !== ROSOMAHA_COFFER_PREVIEW_ID) {
        throw new RuntimeException('operation_contract_failed');
    }
    rosomahaCofferValidatePayloadFile(
        $before['detail_picture'],
        ROSOMAHA_COFFER_BASELINE_DETAIL_ID
    );
    $valueIds = [];
    $fileIds = [];
    $photoFiles = [];
    foreach ($before['photos'] as $row) {
        if (!is_array($row)
            || !rosomahaCofferExactKeys(
                $row,
                ['property_value_id', 'description', 'file']
            )
            || !is_array($row['file'] ?? null)) {
            throw new RuntimeException('operation_contract_failed');
        }
        $valueIds[] = rosomahaCofferPositiveInt(
            $row['property_value_id'] ?? null,
            'operation_contract_failed'
        );
        rosomahaCofferString($row['description'] ?? null, 'operation_contract_failed');
        rosomahaCofferValidatePayloadFile($row['file']);
        $fileIds[] = (int) $row['file']['id'];
        $photoFiles[] = $row['file'];
    }
    if (count(array_unique($valueIds, SORT_REGULAR)) !== 8
        || count(array_unique($fileIds, SORT_REGULAR)) !== 8) {
        throw new RuntimeException('operation_contract_failed');
    }
    $beforeGallery = [
        $before['detail_picture']['sha256'],
        ...array_map(static fn(array $file): string => $file['sha256'], $photoFiles),
    ];
    if (($before['gallery_sha256'] ?? null) !== $beforeGallery) {
        throw new RuntimeException('operation_contract_failed');
    }
    $expected = $payload['expected'];
    $expectedGallery = [
        ROSOMAHA_COFFER_SOURCE_SHA256,
        ...array_slice($beforeGallery, 1),
        $beforeGallery[0],
    ];
    if (!rosomahaCofferExactKeys(
        $expected,
        [
            'gallery_sha256', 'invariant_sha256',
            'existing_photo_property_value_ids', 'existing_photo_file_ids',
            'public_gallery_count', 'old_detail_final', 'thumbnail_clone_proof',
        ]
    )
        || ($expected['gallery_sha256'] ?? null) !== $expectedGallery
        || ($expected['invariant_sha256'] ?? null) !== $before['invariant_sha256']
        || ($expected['existing_photo_property_value_ids'] ?? null) !== $valueIds
        || ($expected['existing_photo_file_ids'] ?? null) !== $fileIds
        || ($expected['public_gallery_count'] ?? null) !== 10
        || ($expected['old_detail_final'] ?? null) !== true
        || ($expected['thumbnail_clone_proof'] ?? null) !== [
            'receipt_sha256' => ROSOMAHA_COFFER_CLONE_PROOF_RECEIPT_SHA256,
            'sha256' => ROSOMAHA_COFFER_THUMBNAIL_SHA256,
            'bytes' => ROSOMAHA_COFFER_THUMBNAIL_BYTES,
            'width' => ROSOMAHA_COFFER_THUMBNAIL_WIDTH,
            'height' => ROSOMAHA_COFFER_THUMBNAIL_HEIGHT,
        ]) {
        throw new RuntimeException('operation_contract_failed');
    }
    $operationId = (string) $payload['operation_id'];
    $source = $payload['source'];
    if (!rosomahaCofferExactKeys(
        $source,
        ['path', 'sha256', 'bytes', 'width', 'height']
    )
        || ($source['path'] ?? null)
            !== ROSOMAHA_COFFER_OPERATION_ROOT . '/' . $operationId . '/source.jpg'
        || ($source['sha256'] ?? null) !== ROSOMAHA_COFFER_SOURCE_SHA256
        || ($source['bytes'] ?? null) !== ROSOMAHA_COFFER_SOURCE_BYTES
        || ($source['width'] ?? null) !== ROSOMAHA_COFFER_SOURCE_WIDTH
        || ($source['height'] ?? null) !== ROSOMAHA_COFFER_SOURCE_HEIGHT
        || count($payload['backups']) !== 9) {
        throw new RuntimeException('operation_contract_failed');
    }
    $beforeFiles = [$before['detail_picture'], ...$photoFiles];
    foreach ($payload['backups'] as $index => $descriptor) {
        $file = $beforeFiles[$index] ?? null;
        if (!is_array($descriptor) || !is_array($file)
            || !rosomahaCofferExactKeys(
                $descriptor,
                ['path', 'sha256', 'bytes', 'width', 'height']
            )
            || ($descriptor['path'] ?? null) !== sprintf(
                '%s/%s/before-%02d.jpg',
                ROSOMAHA_COFFER_OPERATION_ROOT,
                $operationId,
                $index
            )
            || ($descriptor['sha256'] ?? null) !== $file['sha256']
            || ($descriptor['bytes'] ?? null) !== $file['bytes']
            || ($descriptor['width'] ?? null) !== $file['width']
            || ($descriptor['height'] ?? null) !== $file['height']) {
            throw new RuntimeException('operation_contract_failed');
        }
    }
    return $payload;
}

function rosomahaCofferStagedFile(
    array $descriptor,
    string $operationId,
    string $expectedName,
    string $expectedSha,
    int $expectedBytes,
    ?int $expectedWidth = null,
    ?int $expectedHeight = null
): string {
    $expectedPath = ROSOMAHA_COFFER_OPERATION_ROOT . '/' . $operationId . '/' . $expectedName;
    if (($descriptor['path'] ?? null) !== $expectedPath
        || ($descriptor['sha256'] ?? null) !== $expectedSha
        || ($descriptor['bytes'] ?? null) !== $expectedBytes) {
        throw new RuntimeException('staged_file_contract_failed');
    }
    $real = realpath($expectedPath);
    $operationRoot = realpath(ROSOMAHA_COFFER_OPERATION_ROOT . '/' . $operationId);
    $fileStat = is_string($real) ? lstat($real) : false;
    if (!is_string($real) || !is_string($operationRoot)
        || !str_starts_with($real, $operationRoot . DIRECTORY_SEPARATOR)
        || !is_file($real) || is_link($real) || !is_array($fileStat)
        || (int) ($fileStat['nlink'] ?? 0) !== 1
        || filesize($real) !== $expectedBytes
        || !hash_equals($expectedSha, (string) hash_file('sha256', $real))) {
        throw new RuntimeException('staged_file_integrity_failed');
    }
    $image = getimagesize($real);
    if (!is_array($image) || ($image[2] ?? null) !== IMAGETYPE_JPEG
        || ($expectedWidth !== null && (int) $image[0] !== $expectedWidth)
        || ($expectedHeight !== null && (int) $image[1] !== $expectedHeight)) {
        throw new RuntimeException('staged_file_image_invalid');
    }
    return $real;
}

function rosomahaCofferValidateStaged(array $payload): array
{
    $operationId = (string) $payload['operation_id'];
    $source = rosomahaCofferStagedFile(
        $payload['source'],
        $operationId,
        'source.jpg',
        ROSOMAHA_COFFER_SOURCE_SHA256,
        ROSOMAHA_COFFER_SOURCE_BYTES,
        ROSOMAHA_COFFER_SOURCE_WIDTH,
        ROSOMAHA_COFFER_SOURCE_HEIGHT
    );
    $backupPaths = [];
    $beforeFiles = [
        $payload['before']['detail_picture'],
        ...array_map(static fn(array $row): array => $row['file'], $payload['before']['photos']),
    ];
    foreach ($beforeFiles as $index => $file) {
        $backupPaths[] = rosomahaCofferStagedFile(
            $payload['backups'][$index],
            $operationId,
            sprintf('before-%02d.jpg', $index),
            (string) $file['sha256'],
            (int) $file['bytes'],
            (int) $file['width'],
            (int) $file['height']
        );
    }
    return ['source' => $source, 'backups' => $backupPaths];
}

function rosomahaCofferFileArray(string $path): array
{
    $file = CFile::MakeFileArray($path, 'image/jpeg');
    if (!is_array($file) || ($file['tmp_name'] ?? '') !== $path) {
        throw new RuntimeException('file_array_invalid');
    }
    $file['MODULE_ID'] = 'iblock';
    return $file;
}

function rosomahaCofferKeepFileArray(int $fileId): array
{
    return [
        'name' => '', 'type' => '', 'tmp_name' => '', 'error' => 4, 'size' => 0,
        'del' => 'N', 'old_file' => (string) $fileId,
    ];
}

function rosomahaCofferAppendOldDetail(array $beforePhotos, string $path): void
{
    if (count($beforePhotos) !== 8) {
        throw new RuntimeException('photos_write_contract_failed');
    }
    $values = [];
    foreach ($beforePhotos as $row) {
        $valueId = rosomahaCofferPositiveInt(
            $row['property_value_id'] ?? null,
            'photos_write_contract_failed'
        );
        $fileId = rosomahaCofferPositiveInt(
            $row['file']['id'] ?? null,
            'photos_write_contract_failed'
        );
        $values[$valueId] = [
            'VALUE' => rosomahaCofferKeepFileArray($fileId),
            'DESCRIPTION' => rosomahaCofferString(
                $row['description'] ?? '',
                'photo_description_invalid'
            ),
        ];
    }
    $values['n0'] = [
        'VALUE' => rosomahaCofferFileArray($path),
        'DESCRIPTION' => '',
    ];
    CIBlockElement::SetPropertyValuesEx(
        ROSOMAHA_COFFER_ELEMENT_ID,
        ROSOMAHA_COFFER_IBLOCK_ID,
        [ROSOMAHA_COFFER_PHOTOS_PROPERTY_ID => $values]
    );
}

function rosomahaCofferRemoveAppendedPhoto(array $currentPhotos, array $beforePhotos): void
{
    if (count($currentPhotos) !== 9 || count($beforePhotos) !== 8) {
        throw new RuntimeException('photos_write_contract_failed');
    }
    $values = [];
    foreach ($beforePhotos as $index => $beforeRow) {
        $current = $currentPhotos[$index] ?? null;
        if (!is_array($current)
            || $current !== $beforeRow) {
            throw new RuntimeException('rollback_state_unsafe');
        }
        $valueId = rosomahaCofferPositiveInt(
            $current['property_value_id'] ?? null,
            'rollback_state_unsafe'
        );
        $values[$valueId] = [
            'VALUE' => rosomahaCofferKeepFileArray((int) $current['file']['id']),
            'DESCRIPTION' => (string) ($current['description'] ?? ''),
        ];
    }
    $appended = $currentPhotos[8];
    $appendedValueId = rosomahaCofferPositiveInt(
        $appended['property_value_id'] ?? null,
        'rollback_state_unsafe'
    );
    $values[$appendedValueId] = [
        'VALUE' => [
            'name' => '', 'type' => '', 'tmp_name' => '', 'error' => 4, 'size' => 0,
            'del' => 'Y', 'old_file' => (string) $appended['file']['id'],
        ],
        'DESCRIPTION' => (string) ($appended['description'] ?? ''),
    ];
    CIBlockElement::SetPropertyValuesEx(
        ROSOMAHA_COFFER_ELEMENT_ID,
        ROSOMAHA_COFFER_IBLOCK_ID,
        [ROSOMAHA_COFFER_PHOTOS_PROPERTY_ID => $values]
    );
}

function rosomahaCofferSetDetail(string $path): void
{
    $writer = new CIBlockElement();
    if (!$writer->Update(
        ROSOMAHA_COFFER_ELEMENT_ID,
        ['DETAIL_PICTURE' => rosomahaCofferFileArray($path)]
    )) {
        throw new RuntimeException('detail_picture_write_failed');
    }
}

function rosomahaCofferClassification(array $state, array $payload): string
{
    if (($state['state_sha256'] ?? null) === ($payload['before']['state_sha256'] ?? null)) {
        return 'baseline_exact';
    }
    if (($state['invariant_sha256'] ?? null) !== ($payload['expected']['invariant_sha256'] ?? null)) {
        return 'invariant_drift';
    }
    $photoIdentityExact = count($state['photos'] ?? []) === 9;
    foreach (($payload['before']['photos'] ?? []) as $index => $beforeRow) {
        $current = $state['photos'][$index] ?? null;
        $photoIdentityExact = $photoIdentityExact
            && is_array($current)
            && $current === $beforeRow;
    }
    if ($photoIdentityExact
        && ($state['gallery_sha256'] ?? null) === ($payload['expected']['gallery_sha256'] ?? null)) {
        return 'applied_exact';
    }
    $preparedGallery = [
        $payload['before']['detail_picture']['sha256'] ?? null,
        ...array_map(
            static fn(array $row): mixed => $row['file']['sha256'] ?? null,
            $payload['before']['photos'] ?? []
        ),
        $payload['before']['detail_picture']['sha256'] ?? null,
    ];
    if ($photoIdentityExact
        && ($state['detail_picture']['id'] ?? null)
            === ($payload['before']['detail_picture']['id'] ?? null)
        && ($state['gallery_sha256'] ?? null) === $preparedGallery) {
        return 'photos_prepared';
    }
    $beforeGallery = $payload['before']['gallery_sha256'] ?? null;
    if (is_array($beforeGallery) && ($state['gallery_sha256'] ?? null) === $beforeGallery) {
        return 'rolled_back_semantic';
    }
    return 'partial_or_external_drift';
}

function rosomahaCofferOperationResponse(
    string $mode,
    array $payload,
    array $before,
    array $after,
    int $mutations,
    string $status,
    bool $verified,
    ?array $error = null
): array {
    return [
        'status' => $status,
        'mode' => $mode,
        'phase' => 'fixed_coffer_image_operation',
        'operation_id' => $payload['operation_id'],
        'database_mutations' => $mutations,
        'classification' => rosomahaCofferClassification($after, $payload),
        'before_state_sha256' => $before['state_sha256'] ?? null,
        'after_state_sha256' => $after['state_sha256'] ?? null,
        'invariant_sha256' => $after['invariant_sha256'] ?? null,
        'gallery_sha256' => $after['gallery_sha256'] ?? null,
        'state' => $after,
        'verified' => $verified,
        'identifier_restoration' => false,
        'error_evidence' => $error,
    ];
}

function rosomahaCofferOperationError(Throwable $error): array
{
    $allowed = [
        'operation_contract_failed', 'staged_file_contract_failed',
        'staged_file_integrity_failed', 'staged_file_image_invalid',
        'file_array_invalid', 'photos_write_contract_failed',
        'photos_prepare_failed', 'detail_picture_write_failed',
        'state_verification_failed',
        'rollback_state_unsafe',
    ];
    $message = $error->getMessage();
    return [
        'error_code' => in_array($message, $allowed, true)
            ? $message
            : 'operation_exception',
        'error_class' => get_class($error),
        'origin_is_helper' => $error->getFile() === __FILE__,
        'helper_line' => $error->getFile() === __FILE__ ? $error->getLine() : null,
        'message_sha256' => hash('sha256', $message),
    ];
}

function rosomahaCofferApply(array $payload): array
{
    $before = rosomahaCofferState();
    if (ROSOMAHA_COFFER_PHOTOS_APPEND_CLONE_PROOF !== true) {
        return rosomahaCofferOperationResponse(
            'apply', $payload, $before, $before, 0, 'blocked', false,
            ['error_code' => 'photos_append_clone_proof_missing']
        );
    }
    if (rosomahaCofferClassification($before, $payload) !== 'baseline_exact') {
        return rosomahaCofferOperationResponse(
            'apply', $payload, $before, $before, 0, 'blocked', false
        );
    }
    $staged = rosomahaCofferValidateStaged($payload);
    $mutations = 0;
    try {
        rosomahaCofferAppendOldDetail(
            $payload['before']['photos'],
            $staged['backups'][0]
        );
        $mutations++;
        $prepared = rosomahaCofferState();
        if (rosomahaCofferClassification($prepared, $payload) !== 'photos_prepared') {
            throw new RuntimeException('photos_prepare_failed');
        }
        rosomahaCofferSetDetail($staged['source']);
        $mutations++;
        CIBlock::clearIblockTagCache(ROSOMAHA_COFFER_IBLOCK_ID);
        $after = rosomahaCofferState();
        $verified = rosomahaCofferClassification($after, $payload) === 'applied_exact';
        if (!$verified) {
            throw new RuntimeException('state_verification_failed');
        }
        return rosomahaCofferOperationResponse(
            'apply', $payload, $before, $after, $mutations, 'ok', true
        );
    } catch (Throwable $error) {
        try {
            $after = rosomahaCofferState();
        } catch (Throwable) {
            $after = $before;
        }
        if (rosomahaCofferClassification($after, $payload) === 'photos_prepared') {
            try {
                rosomahaCofferRemoveAppendedPhoto(
                    $after['photos'],
                    $payload['before']['photos']
                );
                $mutations++;
                CIBlock::clearIblockTagCache(ROSOMAHA_COFFER_IBLOCK_ID);
                $compensated = rosomahaCofferState();
                if (rosomahaCofferClassification($compensated, $payload) === 'baseline_exact') {
                    $after = $compensated;
                }
            } catch (Throwable) {
                // The receipt will expose the non-baseline classification; no retry follows.
            }
        }
        return rosomahaCofferOperationResponse(
            'apply', $payload, $before, $after, $mutations, 'error', false,
            rosomahaCofferOperationError($error)
        );
    }
}

function rosomahaCofferRecover(array $payload): array
{
    $state = rosomahaCofferState();
    $classification = rosomahaCofferClassification($state, $payload);
    $exact = in_array(
        $classification,
        ['baseline_exact', 'applied_exact'],
        true
    );
    return rosomahaCofferOperationResponse(
        'recover', $payload, $state, $state, 0, $exact ? 'ok' : 'blocked', $exact
    );
}

function rosomahaCofferRollback(array $payload): array
{
    $before = rosomahaCofferState();
    if (rosomahaCofferClassification($before, $payload) !== 'applied_exact') {
        return rosomahaCofferOperationResponse(
            'rollback', $payload, $before, $before, 0, 'blocked', false
        );
    }
    $staged = rosomahaCofferValidateStaged($payload);
    $mutations = 0;
    try {
        // Restore the former main image first.  If the second guarded write
        // fails, the public page keeps the old main image plus one duplicate
        // at the end instead of losing the rollback target from the gallery.
        rosomahaCofferSetDetail($staged['backups'][0]);
        $mutations++;
        rosomahaCofferRemoveAppendedPhoto(
            $before['photos'],
            $payload['before']['photos']
        );
        $mutations++;
        CIBlock::clearIblockTagCache(ROSOMAHA_COFFER_IBLOCK_ID);
        $after = rosomahaCofferState();
        $semantic = rosomahaCofferClassification($after, $payload)
            === 'rolled_back_semantic';
        if (!$semantic) {
            throw new RuntimeException('state_verification_failed');
        }
        return rosomahaCofferOperationResponse(
            'rollback', $payload, $before, $after, $mutations, 'ok', false
        );
    } catch (Throwable $error) {
        try {
            $after = rosomahaCofferState();
        } catch (Throwable) {
            $after = $before;
        }
        return rosomahaCofferOperationResponse(
            'rollback', $payload, $before, $after, $mutations, 'error', false,
            rosomahaCofferOperationError($error)
        );
    }
}

if (PHP_SAPI !== 'cli') {
    rosomahaCofferEmit([
        'status' => 'error', 'mode' => 'blocked', 'database_mutations' => 0,
        'apply_supported' => false, 'error_code' => 'cli_only',
    ], 2);
}

$mode = $argv[1] ?? 'audit';
if (($mode === 'audit' && count($argv) !== 2)
    || ($mode !== 'audit'
        && (!in_array($mode, ['apply', 'recover', 'rollback'], true) || count($argv) !== 5))) {
    rosomahaCofferEmit([
        'status' => 'error', 'mode' => 'blocked', 'database_mutations' => 0,
        'apply_supported' => false, 'error_code' => 'argument_contract_failed',
    ], 2);
}

ini_set('display_errors', '0');
set_time_limit(110);
error_reporting(E_ALL);

$_SERVER['DOCUMENT_ROOT'] = ROSOMAHA_COFFER_SITE_ROOT;
$_SERVER['HTTP_HOST'] = ROSOMAHA_COFFER_DOMAIN;
$_SERVER['SERVER_NAME'] = ROSOMAHA_COFFER_DOMAIN;
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['HTTPS'] = 'on';
define('NO_KEEP_STATISTIC', true);
define('NO_AGENT_CHECK', true);
define('NOT_CHECK_PERMISSIONS', true);
define('BX_NO_ACCELERATOR_RESET', true);
define('DisableEventsCheck', true);

try {
    $prolog = ROSOMAHA_COFFER_SITE_ROOT . '/bitrix/modules/main/include/prolog_before.php';
    if (!is_file($prolog)) {
        throw new RuntimeException('prolog_not_found');
    }
    ob_start();
    require $prolog;
    ob_end_clean();
    if (!Bitrix\Main\Loader::includeModule('iblock')) {
        throw new RuntimeException('iblock_module_load_failed');
    }
    $site = CSite::GetByID(ROSOMAHA_COFFER_SITE_ID)->Fetch();
    if (!is_array($site) || ($site['ACTIVE'] ?? 'N') !== 'Y') {
        throw new RuntimeException('site_identity_invalid');
    }
    $iblock = CIBlock::GetByID(ROSOMAHA_COFFER_IBLOCK_ID)->Fetch();
    if (!is_array($iblock) || (int) ($iblock['ID'] ?? 0) !== ROSOMAHA_COFFER_IBLOCK_ID
        || ($iblock['ACTIVE'] ?? 'N') !== 'Y') {
        throw new RuntimeException('iblock_identity_invalid');
    }

    if ($mode === 'audit') {
        $state = rosomahaCofferState();
        rosomahaCofferEmit([
            'status' => 'ok',
            'mode' => 'audit',
            'phase' => 'fixed_coffer_image_audit',
            'read_only' => true,
            'database_mutations' => 0,
            'apply_supported' => false,
            'ready_for_apply' => false,
            'apply_blocker' => 'photos_append_clone_proof_missing',
            'state' => $state,
        ]);
    }

    $payload = rosomahaCofferPayload($argv, $mode);
    $result = match ($mode) {
        'apply' => rosomahaCofferApply($payload),
        'recover' => rosomahaCofferRecover($payload),
        'rollback' => rosomahaCofferRollback($payload),
    };
    rosomahaCofferEmit($result, ($result['status'] ?? null) === 'error' ? 1 : 0);
} catch (Throwable $error) {
    $message = $error->getMessage();
    rosomahaCofferEmit([
        'status' => 'error',
        'mode' => $mode,
        'phase' => 'fixed_coffer_image',
        'read_only' => $mode === 'audit' || $mode === 'recover',
        'database_mutations' => 0,
        'apply_supported' => false,
        'ready_for_apply' => false,
        'error_code' => preg_match('/^[a-z0-9_]{3,80}$/D', $message) === 1
            ? $message
            : 'unexpected_error',
        'error_class' => get_class($error),
        'origin_is_helper' => $error->getFile() === __FILE__,
        'helper_line' => $error->getFile() === __FILE__ ? $error->getLine() : null,
        'message_bytes' => min(strlen($message), ROSOMAHA_COFFER_MAX_ERROR_BYTES),
        'message_sha256' => hash('sha256', $message),
    ], 1);
}
