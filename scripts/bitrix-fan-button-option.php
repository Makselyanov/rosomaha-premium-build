<?php

declare(strict_types=1);

const ROSOMAHA_FAN_SITE_ROOT = '/home/b/berkutm4/rosomaha-rus.ru/public_html';
const ROSOMAHA_FAN_DOMAIN = 'rosomaha-rus.ru';
const ROSOMAHA_FAN_SITE_ID = 's1';
const ROSOMAHA_FAN_IBLOCK_ID = 86;
const ROSOMAHA_FAN_ANCHOR_ID = 877;
const ROSOMAHA_FAN_ANCHOR_CODE = 'dop-okhlazhdenie-gur';
const ROSOMAHA_FAN_COMPARATOR_ID = 997;
const ROSOMAHA_FAN_MAX_PROPERTIES = 192;
const ROSOMAHA_FAN_MAX_ENUMS = 128;
const ROSOMAHA_FAN_MAX_VALUES = 128;
const ROSOMAHA_FAN_MAX_PROPERTY_ROWS = 4096;
const ROSOMAHA_FAN_MAX_SECTIONS = 16;
const ROSOMAHA_FAN_MAX_SIBLINGS = 256;
const ROSOMAHA_FAN_MAX_DUPLICATES = 32;
const ROSOMAHA_FAN_MAX_STRING_BYTES = 512;

const ROSOMAHA_FAN_TARGET = [
    'name' => 'Дополнительная кнопка включения вентилятора',
    'code' => 'dopolnitelnaya-knopka-vklyucheniya-ventilyatora',
    'price' => 7000,
];

const ROSOMAHA_FAN_MODEL_CODES = [
    'snegobolotokhod-rosomakha-model-pro-4kh4-s-dvs-1zz-fe-1-8-litra-mosty-toyota',
    'rosomakha-model-eger-1-dvs-30-l-s-s-mostami-volga-',
    'standart-plus-1-5-litra',
    'rosomakha-standart-plyus-uaz-timken',
    'extrime-s-1-5l-dvs-1nz-fe',
    'extrime-1-5-litra-mosty-toyota',
    'extrime-plus-s-1-8l-dvs-1zz-fe',
    'hunter-s-1-5l-dvs-1nz-fe',
    'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken',
    'snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz',
    'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota',
    'snegobolotokhod-rosomakha-komplektatsiya-shestikolyesnik-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota',
];

function rosomahaFanResult(array $payload, int $exitCode = 0): void
{
    echo json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ), PHP_EOL;
    exit($exitCode);
}

function rosomahaFanSafeError(Throwable $error): string
{
    $message = $error->getMessage() !== '' ? $error->getMessage() : get_class($error);
    $message = str_replace(
        [ROSOMAHA_FAN_SITE_ROOT, 'berkutm4'],
        ['[pinned-root]', '[pinned-account]'],
        $message
    );
    return substr($message, 0, 500);
}

function rosomahaFanNormalizeScalar(mixed $value, int $depth = 0): mixed
{
    if ($depth > 3) {
        throw new RuntimeException('Property value nesting exceeded the fixed limit');
    }
    if ($value === null || is_bool($value) || is_int($value) || is_float($value)) {
        return $value;
    }
    if (is_string($value)) {
        $bytes = strlen($value);
        if (preg_match('//u', $value) !== 1) {
            return [
                'kind' => 'binary_digest',
                'bytes' => $bytes,
                'sha256' => hash('sha256', $value),
            ];
        }
        $normalized = str_replace(["\r\n", "\r"], "\n", $value);
        if ($bytes > ROSOMAHA_FAN_MAX_STRING_BYTES) {
            return [
                'kind' => 'string_digest',
                'bytes' => $bytes,
                'sha256' => hash('sha256', $value),
            ];
        }
        return $normalized;
    }
    if (is_array($value)) {
        if (count($value) > 32) {
            throw new RuntimeException('Property array exceeded the fixed limit');
        }
        $normalized = [];
        foreach ($value as $key => $item) {
            $normalized[(string) $key] = rosomahaFanNormalizeScalar($item, $depth + 1);
        }
        return $normalized;
    }
    throw new RuntimeException('Unsupported property value type');
}

function rosomahaFanTextShape(mixed $text): array
{
    $value = is_string($text) ? $text : '';
    return [
        'bytes' => strlen($value),
        'sha256' => hash('sha256', $value),
        'empty' => $value === '',
    ];
}

function rosomahaFanReadPropertyDefinitions(): array
{
    $definitions = [];
    $byId = [];
    $result = CIBlockProperty::GetList(
        ['SORT' => 'ASC', 'ID' => 'ASC'],
        ['IBLOCK_ID' => ROSOMAHA_FAN_IBLOCK_ID]
    );
    while ($row = $result->Fetch()) {
        if (count($definitions) >= ROSOMAHA_FAN_MAX_PROPERTIES) {
            throw new RuntimeException('Iblock property count exceeded the fixed limit');
        }
        $propertyId = (int) ($row['ID'] ?? 0);
        if ($propertyId <= 0 || isset($byId[$propertyId])) {
            throw new RuntimeException('Iblock property identity is invalid');
        }
        $enums = [];
        if ((string) ($row['PROPERTY_TYPE'] ?? '') === 'L') {
            $enumResult = CIBlockPropertyEnum::GetList(
                ['SORT' => 'ASC', 'ID' => 'ASC'],
                ['PROPERTY_ID' => $propertyId]
            );
            while ($enum = $enumResult->Fetch()) {
                if (count($enums) >= ROSOMAHA_FAN_MAX_ENUMS) {
                    throw new RuntimeException('Property enum count exceeded the fixed limit');
                }
                $enums[] = [
                    'id' => (int) ($enum['ID'] ?? 0),
                    'value' => rosomahaFanNormalizeScalar((string) ($enum['VALUE'] ?? '')),
                    'xml_id' => rosomahaFanNormalizeScalar((string) ($enum['XML_ID'] ?? '')),
                    'sort' => (int) ($enum['SORT'] ?? 0),
                    'default' => (string) ($enum['DEF'] ?? 'N') === 'Y',
                ];
            }
        }
        $definition = [
            'id' => $propertyId,
            'code' => (string) ($row['CODE'] ?? ''),
            'name' => rosomahaFanNormalizeScalar((string) ($row['NAME'] ?? '')),
            'type' => (string) ($row['PROPERTY_TYPE'] ?? ''),
            'user_type' => (string) ($row['USER_TYPE'] ?? ''),
            'multiple' => (string) ($row['MULTIPLE'] ?? 'N') === 'Y',
            'mandatory' => (string) ($row['IS_REQUIRED'] ?? 'N') === 'Y',
            'active' => (string) ($row['ACTIVE'] ?? 'N') === 'Y',
            'sort' => (int) ($row['SORT'] ?? 0),
            'link_iblock_id' => (int) ($row['LINK_IBLOCK_ID'] ?? 0),
            'with_description' => (string) ($row['WITH_DESCRIPTION'] ?? 'N') === 'Y',
            'enums' => $enums,
        ];
        $definitions[] = $definition;
        $byId[$propertyId] = $definition;
    }
    if ($definitions === []) {
        throw new RuntimeException('Iblock property schema is empty');
    }
    return ['definitions' => $definitions, 'by_id' => $byId];
}

function rosomahaFanReadElementFieldsByFilter(array $filter, string $label): array
{
    $result = CIBlockElement::GetList(
        ['ID' => 'ASC'],
        array_merge(
            ['IBLOCK_ID' => ROSOMAHA_FAN_IBLOCK_ID, 'CHECK_PERMISSIONS' => 'N'],
            $filter
        ),
        false,
        ['nTopCount' => 2],
        [
            'ID',
            'IBLOCK_ID',
            'IBLOCK_SECTION_ID',
            'NAME',
            'CODE',
            'XML_ID',
            'ACTIVE',
            'SORT',
            'DATE_ACTIVE_FROM',
            'DATE_ACTIVE_TO',
            'PREVIEW_TEXT',
            'PREVIEW_TEXT_TYPE',
            'DETAIL_TEXT',
            'DETAIL_TEXT_TYPE',
            'PREVIEW_PICTURE',
            'DETAIL_PICTURE',
            'DETAIL_PAGE_URL',
            'DATE_CREATE',
            'TIMESTAMP_X',
        ]
    );
    $rows = [];
    while ($row = $result->GetNext()) {
        $rows[] = $row;
    }
    if (count($rows) !== 1) {
        throw new RuntimeException("Expected exactly one {$label} element");
    }
    return $rows[0];
}

function rosomahaFanReadElementFieldsById(int $elementId, string $label): array
{
    return rosomahaFanReadElementFieldsByFilter(['ID' => $elementId], $label);
}

function rosomahaFanReadElementFieldsByCode(string $code): array
{
    $fields = rosomahaFanReadElementFieldsByFilter(['=CODE' => $code], "model {$code}");
    if ((string) ($fields['CODE'] ?? '') !== $code) {
        throw new RuntimeException('Model code equality check failed');
    }
    return $fields;
}

function rosomahaFanReadSections(int $elementId): array
{
    $sections = [];
    $result = CIBlockElement::GetElementGroups(
        $elementId,
        true,
        ['ID', 'IBLOCK_ID', 'IBLOCK_SECTION_ID', 'NAME', 'CODE', 'SORT', 'ACTIVE', 'DEPTH_LEVEL']
    );
    while ($row = $result->Fetch()) {
        if (count($sections) >= ROSOMAHA_FAN_MAX_SECTIONS) {
            throw new RuntimeException('Element section count exceeded the fixed limit');
        }
        if ((int) ($row['IBLOCK_ID'] ?? 0) !== ROSOMAHA_FAN_IBLOCK_ID) {
            throw new RuntimeException('Element section belongs to an unexpected iblock');
        }
        $sections[] = [
            'id' => (int) ($row['ID'] ?? 0),
            'parent_id' => (int) ($row['IBLOCK_SECTION_ID'] ?? 0),
            'name' => rosomahaFanNormalizeScalar((string) ($row['NAME'] ?? '')),
            'code' => (string) ($row['CODE'] ?? ''),
            'sort' => (int) ($row['SORT'] ?? 0),
            'active' => (string) ($row['ACTIVE'] ?? 'N') === 'Y',
            'depth' => (int) ($row['DEPTH_LEVEL'] ?? 0),
        ];
    }
    usort($sections, static fn(array $a, array $b): int => $a['id'] <=> $b['id']);
    return $sections;
}

function rosomahaFanLinkIds(mixed $value): array
{
    $ids = [];
    $walk = static function (mixed $item) use (&$ids, &$walk): void {
        if (is_array($item)) {
            foreach ($item as $nested) {
                $walk($nested);
            }
            return;
        }
        if (is_int($item) && $item > 0) {
            $ids[$item] = true;
            return;
        }
        if (is_string($item) && preg_match('/^[1-9][0-9]*$/D', $item) === 1) {
            $ids[(int) $item] = true;
        }
    };
    $walk($value);
    $result = array_keys($ids);
    sort($result, SORT_NUMERIC);
    return $result;
}

function rosomahaFanReadProperties(int $elementId, array $propertyById): array
{
    $public = [];
    $positionById = [];
    foreach ($propertyById as $propertyId => $definition) {
        $positionById[(int) $propertyId] = count($public);
        $public[] = [
            'id' => (int) $propertyId,
            'code' => $definition['code'],
            'type' => $definition['type'],
            'multiple' => $definition['multiple'],
            'link_iblock_id' => $definition['link_iblock_id'],
            'values' => [],
        ];
    }
    $links = [];
    $rowCount = 0;
    $result = CIBlockElement::GetProperty(
        ROSOMAHA_FAN_IBLOCK_ID,
        $elementId,
        ['sort' => 'asc', 'id' => 'asc'],
        []
    );
    while ($row = $result->Fetch()) {
        $rowCount++;
        if ($rowCount > ROSOMAHA_FAN_MAX_PROPERTY_ROWS) {
            throw new RuntimeException('Element property row count exceeded the fixed limit');
        }
        $propertyId = (int) ($row['ID'] ?? 0);
        if (!isset($positionById[$propertyId], $propertyById[$propertyId])) {
            throw new RuntimeException('Element property is absent from the schema snapshot');
        }
        $hasValueId = isset($row['PROPERTY_VALUE_ID']) && $row['PROPERTY_VALUE_ID'] !== false;
        $rawValue = $row['VALUE'] ?? null;
        if (!$hasValueId && ($rawValue === null || $rawValue === false || $rawValue === '')) {
            continue;
        }
        $position = $positionById[$propertyId];
        if (count($public[$position]['values']) >= ROSOMAHA_FAN_MAX_VALUES) {
            throw new RuntimeException('Property value count exceeded the fixed limit');
        }
        $public[$position]['values'][] = [
            'value' => rosomahaFanNormalizeScalar($rawValue),
            'enum_value' => rosomahaFanNormalizeScalar($row['VALUE_ENUM'] ?? null),
            'enum_xml_id' => rosomahaFanNormalizeScalar($row['VALUE_XML_ID'] ?? null),
            'description' => rosomahaFanNormalizeScalar($row['DESCRIPTION'] ?? null),
        ];
        if ($propertyById[$propertyId]['type'] === 'E') {
            foreach (rosomahaFanLinkIds($rawValue) as $linkedId) {
                $links[$propertyId][$linkedId] = true;
            }
        }
    }
    $normalizedLinks = [];
    foreach ($links as $propertyId => $linkedIds) {
        $ids = array_keys($linkedIds);
        sort($ids, SORT_NUMERIC);
        $normalizedLinks[(int) $propertyId] = $ids;
    }
    return ['public' => $public, 'links' => $normalizedLinks];
}

function rosomahaFanPublicFields(array $fields): array
{
    return [
        'iblock_id' => (int) ($fields['IBLOCK_ID'] ?? 0),
        'primary_section_id' => (int) ($fields['IBLOCK_SECTION_ID'] ?? 0),
        'name' => rosomahaFanNormalizeScalar((string) ($fields['NAME'] ?? '')),
        'xml_id' => rosomahaFanNormalizeScalar((string) ($fields['XML_ID'] ?? '')),
        'active' => (string) ($fields['ACTIVE'] ?? 'N') === 'Y',
        'sort' => (int) ($fields['SORT'] ?? 0),
        'active_from' => rosomahaFanNormalizeScalar((string) ($fields['DATE_ACTIVE_FROM'] ?? '')),
        'active_to' => rosomahaFanNormalizeScalar((string) ($fields['DATE_ACTIVE_TO'] ?? '')),
        'preview_text_type' => (string) ($fields['PREVIEW_TEXT_TYPE'] ?? ''),
        'preview_text' => rosomahaFanTextShape($fields['PREVIEW_TEXT'] ?? ''),
        'detail_text_type' => (string) ($fields['DETAIL_TEXT_TYPE'] ?? ''),
        'detail_text' => rosomahaFanTextShape($fields['DETAIL_TEXT'] ?? ''),
        'preview_picture_id' => (int) ($fields['PREVIEW_PICTURE'] ?? 0),
        'detail_picture_id' => (int) ($fields['DETAIL_PICTURE'] ?? 0),
        'detail_page_url' => rosomahaFanNormalizeScalar((string) ($fields['DETAIL_PAGE_URL'] ?? '')),
        'created_at' => rosomahaFanNormalizeScalar((string) ($fields['DATE_CREATE'] ?? '')),
        'changed_at' => rosomahaFanNormalizeScalar((string) ($fields['TIMESTAMP_X'] ?? '')),
    ];
}

function rosomahaFanReadElement(array $fields, array $propertyById): array
{
    $elementId = (int) ($fields['ID'] ?? 0);
    $code = (string) ($fields['CODE'] ?? '');
    if ($elementId <= 0 || (int) ($fields['IBLOCK_ID'] ?? 0) !== ROSOMAHA_FAN_IBLOCK_ID) {
        throw new RuntimeException('Element identity is invalid');
    }
    $properties = rosomahaFanReadProperties($elementId, $propertyById);
    return [
        'public' => [
            'id' => $elementId,
            'code' => $code,
            'fields' => rosomahaFanPublicFields($fields),
            'sections' => rosomahaFanReadSections($elementId),
            'properties' => $properties['public'],
        ],
        'links' => $properties['links'],
    ];
}

function rosomahaFanIdsForProperty(array $element, int $propertyId): array
{
    return $element['links'][$propertyId] ?? [];
}

function rosomahaFanCodesForIds(array $ids, array $modelCodeById): array
{
    $codes = [];
    foreach ($ids as $id) {
        if (isset($modelCodeById[$id])) {
            $codes[] = $modelCodeById[$id];
        }
    }
    $order = array_flip(ROSOMAHA_FAN_MODEL_CODES);
    usort($codes, static fn(string $a, string $b): int => $order[$a] <=> $order[$b]);
    return $codes;
}

function rosomahaFanRelationAnalysis(
    array $definitions,
    array $anchor,
    array $comparator,
    array $models
): array {
    $modelCodeById = [];
    foreach ($models as $model) {
        $modelCodeById[$model['public']['id']] = $model['public']['code'];
    }
    $modelIds = array_keys($modelCodeById);
    $candidates = [];
    foreach ($definitions as $definition) {
        if ($definition['type'] !== 'E' || $definition['link_iblock_id'] !== ROSOMAHA_FAN_IBLOCK_ID) {
            continue;
        }
        $propertyId = $definition['id'];
        $anchorLinks = rosomahaFanIdsForProperty($anchor, $propertyId);
        $comparatorLinks = rosomahaFanIdsForProperty($comparator, $propertyId);
        $anchorModelIds = array_values(array_intersect($anchorLinks, $modelIds));
        $comparatorModelIds = array_values(array_intersect($comparatorLinks, $modelIds));
        $anchorForeign = array_values(array_diff($anchorLinks, $modelIds));
        $comparatorForeign = array_values(array_diff($comparatorLinks, $modelIds));
        if ($anchorModelIds !== [] || $comparatorModelIds !== []) {
            $strong = $anchorModelIds !== []
                && $comparatorModelIds !== []
                && $anchorForeign === []
                && $comparatorForeign === [];
            $candidates[] = [
                'direction' => 'option_to_models',
                'property' => $definition,
                'anchor_model_codes' => rosomahaFanCodesForIds($anchorModelIds, $modelCodeById),
                'comparator_model_codes' => rosomahaFanCodesForIds($comparatorModelIds, $modelCodeById),
                'anchor_foreign_link_ids' => $anchorForeign,
                'comparator_foreign_link_ids' => $comparatorForeign,
                'strong' => $strong,
            ];
        }

        $modelsReferencingAnchor = [];
        $modelsReferencingComparator = [];
        foreach ($models as $model) {
            $links = rosomahaFanIdsForProperty($model, $propertyId);
            if (in_array(ROSOMAHA_FAN_ANCHOR_ID, $links, true)) {
                $modelsReferencingAnchor[] = $model['public']['code'];
            }
            if (in_array(ROSOMAHA_FAN_COMPARATOR_ID, $links, true)) {
                $modelsReferencingComparator[] = $model['public']['code'];
            }
        }
        if ($modelsReferencingAnchor !== [] || $modelsReferencingComparator !== []) {
            $candidates[] = [
                'direction' => 'models_to_option',
                'property' => $definition,
                'models_referencing_anchor' => $modelsReferencingAnchor,
                'models_referencing_comparator' => $modelsReferencingComparator,
                'strong' => $modelsReferencingAnchor !== [] && $modelsReferencingComparator !== [],
            ];
        }
    }
    $strong = array_values(array_filter(
        $candidates,
        static fn(array $candidate): bool => $candidate['strong'] === true
    ));
    $derivedRelation = count($strong) === 1 ? $strong[0] : null;
    $singleElementWriteSupported = is_array($derivedRelation)
        && $derivedRelation['direction'] === 'option_to_models'
        && $derivedRelation['property']['multiple'] === true
        && $derivedRelation['property']['link_iblock_id'] === ROSOMAHA_FAN_IBLOCK_ID;
    return [
        'desired_scope' => [
            'model_codes' => ROSOMAHA_FAN_MODEL_CODES,
            'model_count' => count(ROSOMAHA_FAN_MODEL_CODES),
            'trailer_included' => false,
            'anchor_scope_is_not_target_scope' => true,
            'future_new_elements_max' => 1,
            'future_existing_element_writes_max' => 0,
        ],
        'candidate_relations' => $candidates,
        'strong_candidate_count' => count($strong),
        'unambiguous' => count($strong) === 1,
        'derived_relation' => $derivedRelation,
        'single_element_write_supported' => $singleElementWriteSupported,
    ];
}

function rosomahaFanNumericValues(array $element, int $propertyId): array
{
    $values = [];
    foreach ($element['public']['properties'] as $property) {
        if ($property['id'] !== $propertyId) {
            continue;
        }
        foreach ($property['values'] as $entry) {
            $value = $entry['value'];
            if (is_int($value) || is_float($value)) {
                $values[] = $value;
            } elseif (is_string($value) && preg_match('/^-?[0-9]+(?:\.[0-9]+)?$/D', $value) === 1) {
                $values[] = (float) $value;
            }
        }
    }
    return $values;
}

function rosomahaFanPriceAnalysis(array $definitions, array $anchor, array $comparator): array
{
    $candidates = [];
    foreach ($definitions as $definition) {
        $semantic = (string) $definition['code'] . ' ' . (string) $definition['name'];
        if (!in_array($definition['type'], ['N', 'S'], true)
            || preg_match('/price|cost|цен/iu', $semantic) !== 1) {
            continue;
        }
        $anchorValues = rosomahaFanNumericValues($anchor, $definition['id']);
        $comparatorValues = rosomahaFanNumericValues($comparator, $definition['id']);
        $strong = count($anchorValues) === 1 && count($comparatorValues) === 1;
        $candidates[] = [
            'property' => $definition,
            'anchor_numeric_values' => $anchorValues,
            'comparator_numeric_values' => $comparatorValues,
            'strong' => $strong,
        ];
    }
    $strong = array_values(array_filter(
        $candidates,
        static fn(array $candidate): bool => $candidate['strong'] === true
    ));
    return [
        'target_price' => ROSOMAHA_FAN_TARGET['price'],
        'candidates' => $candidates,
        'strong_candidate_count' => count($strong),
        'unambiguous' => count($strong) === 1,
        'derived_property' => count($strong) === 1 ? $strong[0]['property'] : null,
    ];
}

function rosomahaFanFindExact(string $filterField, string $value): array
{
    $matches = [];
    $result = CIBlockElement::GetList(
        ['ID' => 'ASC'],
        [
            'IBLOCK_ID' => ROSOMAHA_FAN_IBLOCK_ID,
            'CHECK_PERMISSIONS' => 'N',
            '=' . $filterField => $value,
        ],
        false,
        ['nTopCount' => ROSOMAHA_FAN_MAX_DUPLICATES + 1],
        ['ID', 'IBLOCK_ID', 'NAME', 'CODE', 'ACTIVE', 'SORT']
    );
    while ($row = $result->Fetch()) {
        if (count($matches) >= ROSOMAHA_FAN_MAX_DUPLICATES) {
            throw new RuntimeException('Target duplicate result exceeded the fixed limit');
        }
        if ((string) ($row[$filterField] ?? '') !== $value) {
            continue;
        }
        $matches[] = [
            'id' => (int) ($row['ID'] ?? 0),
            'name' => rosomahaFanNormalizeScalar((string) ($row['NAME'] ?? '')),
            'code' => (string) ($row['CODE'] ?? ''),
            'active' => (string) ($row['ACTIVE'] ?? 'N') === 'Y',
            'sort' => (int) ($row['SORT'] ?? 0),
        ];
    }
    return $matches;
}

function rosomahaFanTargetDuplicates(): array
{
    $byName = rosomahaFanFindExact('NAME', ROSOMAHA_FAN_TARGET['name']);
    $byCode = rosomahaFanFindExact('CODE', ROSOMAHA_FAN_TARGET['code']);
    $union = [];
    foreach (array_merge($byName, $byCode) as $row) {
        $union[$row['id']] = $row;
    }
    ksort($union, SORT_NUMERIC);
    return [
        'by_exact_name' => $byName,
        'by_exact_code' => $byCode,
        'union' => array_values($union),
    ];
}

function rosomahaFanSectionOrder(array $anchorPublic): array
{
    $plans = [];
    $anchorSort = (int) $anchorPublic['fields']['sort'];
    $upperBounds = [];
    foreach ($anchorPublic['sections'] as $section) {
        $siblings = [];
        $result = CIBlockElement::GetList(
            ['SORT' => 'ASC', 'ID' => 'ASC'],
            [
                'IBLOCK_ID' => ROSOMAHA_FAN_IBLOCK_ID,
                'SECTION_ID' => $section['id'],
                'INCLUDE_SUBSECTIONS' => 'N',
                'CHECK_PERMISSIONS' => 'N',
            ],
            false,
            ['nTopCount' => ROSOMAHA_FAN_MAX_SIBLINGS + 1],
            ['ID', 'IBLOCK_ID', 'NAME', 'CODE', 'ACTIVE', 'SORT']
        );
        while ($row = $result->Fetch()) {
            if (count($siblings) >= ROSOMAHA_FAN_MAX_SIBLINGS) {
                throw new RuntimeException('Section sibling count exceeded the fixed limit');
            }
            $siblings[] = [
                'id' => (int) ($row['ID'] ?? 0),
                'name' => rosomahaFanNormalizeScalar((string) ($row['NAME'] ?? '')),
                'code' => (string) ($row['CODE'] ?? ''),
                'active' => (string) ($row['ACTIVE'] ?? 'N') === 'Y',
                'sort' => (int) ($row['SORT'] ?? 0),
                'is_anchor' => (int) ($row['ID'] ?? 0) === ROSOMAHA_FAN_ANCHOR_ID,
                'is_comparator' => (int) ($row['ID'] ?? 0) === ROSOMAHA_FAN_COMPARATOR_ID,
            ];
        }
        $positions = [];
        foreach ($siblings as $position => $sibling) {
            if ($sibling['is_anchor']) {
                $positions[] = $position;
            }
        }
        if (count($positions) !== 1) {
            throw new RuntimeException('Anchor occurrence in its section is not unique');
        }
        $position = $positions[0];
        $next = $siblings[$position + 1] ?? null;
        $nextSort = is_array($next) ? (int) $next['sort'] : null;
        if ($nextSort !== null) {
            $upperBounds[] = $nextSort;
        }
        $plans[] = [
            'section' => $section,
            'sibling_count' => count($siblings),
            'anchor_position_zero_based' => $position,
            'previous' => $position > 0 ? $siblings[$position - 1] : null,
            'anchor' => $siblings[$position],
            'next' => $next,
            'sort_gap_after_anchor' => $nextSort === null ? null : $nextSort - $anchorSort,
            'siblings' => $siblings,
        ];
    }
    $candidateSort = null;
    if ($plans !== []) {
        if ($upperBounds === []) {
            $candidateSort = $anchorSort <= 2147483637 ? $anchorSort + 10 : null;
        } else {
            $minimumUpper = min($upperBounds);
            if ($minimumUpper - $anchorSort > 1) {
                $candidateSort = $anchorSort + 1;
            }
        }
    }
    return [
        'anchor_sort' => $anchorSort,
        'sections' => $plans,
        'global_sort_plan' => [
            'candidate_sort' => $candidateSort,
            'unambiguous' => $candidateSort !== null,
            'requires_sibling_resort' => $candidateSort === null,
        ],
    ];
}

if (PHP_SAPI !== 'cli') {
    rosomahaFanResult(['status' => 'error', 'error' => 'CLI only'], 2);
}

$mode = $argv[1] ?? 'audit';
if ($mode !== 'audit' || count($argv) !== 2) {
    rosomahaFanResult([
        'status' => 'error',
        'mode' => 'blocked',
        'error' => 'This phase-1 helper accepts exactly one audit argument',
        'database_mutations' => 0,
    ], 2);
}

ini_set('display_errors', '0');
set_time_limit(90);
error_reporting(E_ALL);

$_SERVER['DOCUMENT_ROOT'] = ROSOMAHA_FAN_SITE_ROOT;
$_SERVER['HTTP_HOST'] = ROSOMAHA_FAN_DOMAIN;
$_SERVER['SERVER_NAME'] = ROSOMAHA_FAN_DOMAIN;
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['HTTPS'] = 'on';
define('NO_KEEP_STATISTIC', true);
define('NO_AGENT_CHECK', true);
define('NOT_CHECK_PERMISSIONS', true);
define('BX_NO_ACCELERATOR_RESET', true);
define('DisableEventsCheck', true);

try {
    $prolog = ROSOMAHA_FAN_SITE_ROOT . '/bitrix/modules/main/include/prolog_before.php';
    if (!is_file($prolog)) {
        throw new RuntimeException('Bitrix prolog was not found at the pinned root');
    }
    ob_start();
    require $prolog;
    ob_end_clean();

    if (!Bitrix\Main\Loader::includeModule('iblock')) {
        throw new RuntimeException('Bitrix iblock module could not be loaded');
    }

    $site = CSite::GetByID(ROSOMAHA_FAN_SITE_ID)->Fetch();
    if (!is_array($site) || (string) ($site['LID'] ?? '') !== ROSOMAHA_FAN_SITE_ID) {
        throw new RuntimeException('Pinned Bitrix site was not found');
    }
    if ((string) ($site['ACTIVE'] ?? 'N') !== 'Y') {
        throw new RuntimeException('Pinned Bitrix site is inactive');
    }
    $iblock = CIBlock::GetByID(ROSOMAHA_FAN_IBLOCK_ID)->Fetch();
    if (!is_array($iblock) || (int) ($iblock['ID'] ?? 0) !== ROSOMAHA_FAN_IBLOCK_ID) {
        throw new RuntimeException('Pinned iblock was not found');
    }
    if ((string) ($iblock['ACTIVE'] ?? 'N') !== 'Y') {
        throw new RuntimeException('Pinned iblock is inactive');
    }
    $iblockSiteIds = [];
    $siteResult = CIBlock::GetSite(ROSOMAHA_FAN_IBLOCK_ID);
    while ($row = $siteResult->Fetch()) {
        $iblockSiteIds[] = (string) ($row['LID'] ?? '');
    }
    sort($iblockSiteIds, SORT_STRING);
    if (!in_array(ROSOMAHA_FAN_SITE_ID, $iblockSiteIds, true)) {
        throw new RuntimeException('Pinned iblock is not assigned to the pinned site');
    }

    $propertySchema = rosomahaFanReadPropertyDefinitions();
    $anchorFields = rosomahaFanReadElementFieldsById(ROSOMAHA_FAN_ANCHOR_ID, 'anchor');
    if ((string) ($anchorFields['CODE'] ?? '') !== ROSOMAHA_FAN_ANCHOR_CODE) {
        throw new RuntimeException('Anchor code drifted from the pinned identity');
    }
    $comparatorFields = rosomahaFanReadElementFieldsById(
        ROSOMAHA_FAN_COMPARATOR_ID,
        'comparator'
    );
    $comparatorIdentity = (string) ($comparatorFields['NAME'] ?? '')
        . ' ' . (string) ($comparatorFields['CODE'] ?? '');
    if (preg_match('/багира|bagira/iu', $comparatorIdentity) !== 1) {
        throw new RuntimeException('Comparator no longer identifies Bagira');
    }
    $anchor = rosomahaFanReadElement($anchorFields, $propertySchema['by_id']);
    $comparator = rosomahaFanReadElement($comparatorFields, $propertySchema['by_id']);

    $models = [];
    $modelIds = [];
    foreach (ROSOMAHA_FAN_MODEL_CODES as $modelCode) {
        $fields = rosomahaFanReadElementFieldsByCode($modelCode);
        $model = rosomahaFanReadElement($fields, $propertySchema['by_id']);
        if (isset($modelIds[$model['public']['id']])) {
            throw new RuntimeException('Two pinned model codes resolved to one element');
        }
        if (in_array(
            $model['public']['id'],
            [ROSOMAHA_FAN_ANCHOR_ID, ROSOMAHA_FAN_COMPARATOR_ID],
            true
        )) {
            throw new RuntimeException('Pinned model resolved to an option element');
        }
        $modelIds[$model['public']['id']] = true;
        $models[] = $model;
    }
    if (count($models) !== 12) {
        throw new RuntimeException('Pinned model scope is incomplete');
    }

    $duplicates = rosomahaFanTargetDuplicates();
    $relation = rosomahaFanRelationAnalysis(
        $propertySchema['definitions'],
        $anchor,
        $comparator,
        $models
    );
    $price = rosomahaFanPriceAnalysis(
        $propertySchema['definitions'],
        $anchor,
        $comparator
    );
    $sectionOrder = rosomahaFanSectionOrder($anchor['public']);

    $blockers = [];
    if (!$relation['unambiguous']) {
        $blockers[] = 'relation_property_or_direction_is_ambiguous';
    } elseif (!$relation['single_element_write_supported']) {
        $blockers[] = 'relation_is_not_compatible_with_single_new_element_scope';
    }
    if (!$price['unambiguous']) {
        $blockers[] = 'price_property_is_ambiguous';
    }
    if ($duplicates['union'] !== []) {
        $blockers[] = 'target_exact_name_or_code_already_exists';
    }
    if (!$sectionOrder['global_sort_plan']['unambiguous']) {
        $blockers[] = 'no_safe_sort_gap_after_anchor';
    }
    $readyForApply = $blockers === [];

    $publicModels = [];
    foreach ($models as $model) {
        $publicModels[] = $model['public'];
    }
    rosomahaFanResult([
        'status' => 'ok',
        'mode' => 'audit',
        'phase' => 'schema_and_relation_discovery',
        'apply_supported' => false,
        'database_mutations' => 0,
        'identity' => [
            'domain' => ROSOMAHA_FAN_DOMAIN,
            'site_id' => ROSOMAHA_FAN_SITE_ID,
            'site_root' => ROSOMAHA_FAN_SITE_ROOT,
            'iblock_id' => ROSOMAHA_FAN_IBLOCK_ID,
            'anchor_id' => ROSOMAHA_FAN_ANCHOR_ID,
            'anchor_code' => ROSOMAHA_FAN_ANCHOR_CODE,
            'comparator_id' => ROSOMAHA_FAN_COMPARATOR_ID,
            'comparator_role' => 'bagira',
            'target' => ROSOMAHA_FAN_TARGET,
            'model_codes' => ROSOMAHA_FAN_MODEL_CODES,
            'trailer_included' => false,
        ],
        'schema' => [
            'site' => [
                'id' => (string) ($site['LID'] ?? ''),
                'active' => (string) ($site['ACTIVE'] ?? 'N') === 'Y',
                'dir' => (string) ($site['DIR'] ?? ''),
            ],
            'iblock' => [
                'id' => (int) ($iblock['ID'] ?? 0),
                'code' => (string) ($iblock['CODE'] ?? ''),
                'name' => rosomahaFanNormalizeScalar((string) ($iblock['NAME'] ?? '')),
                'active' => (string) ($iblock['ACTIVE'] ?? 'N') === 'Y',
                'site_ids' => $iblockSiteIds,
            ],
            'property_definitions' => $propertySchema['definitions'],
        ],
        'elements' => [
            'anchor' => $anchor['public'],
            'comparator' => $comparator['public'],
            'models' => $publicModels,
        ],
        'relation_analysis' => $relation,
        'price_analysis' => $price,
        'section_order' => $sectionOrder,
        'target_duplicates' => $duplicates,
        'ready_for_apply' => $readyForApply,
        'blockers' => $blockers,
    ]);
} catch (Throwable $error) {
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    rosomahaFanResult([
        'status' => 'error',
        'mode' => 'audit',
        'apply_supported' => false,
        'database_mutations' => 0,
        'error' => rosomahaFanSafeError($error),
    ], 1);
}
