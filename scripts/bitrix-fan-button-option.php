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
const ROSOMAHA_FAN_LINK_GOODS_PROPERTY_ID = 1219;
const ROSOMAHA_FAN_OPTIONS_SECTION_ID = 302;
const ROSOMAHA_FAN_TARGET_SORT = 506;
const ROSOMAHA_FAN_MAX_LINKED_OPTIONS = 96;
const ROSOMAHA_FAN_MAX_NO_CONTENT_SAMPLES = 16;
const ROSOMAHA_FAN_MAX_ERROR_MESSAGE_BYTES = 4096;

const ROSOMAHA_FAN_ERROR_STAGES = [
    'bootstrap',
    'prolog_preflight',
    'prolog_load',
    'iblock_module_load',
    'site_read',
    'iblock_read',
    'property_schema_read',
    'anchor_read',
    'comparator_read',
    'models_read',
    'duplicate_read',
    'relation_analysis',
    'price_analysis',
    'section_order',
    'model_link_evidence',
    'linked_options_read',
    'template_peers',
    'render_order',
    'no_content_samples',
    'metadata_templates',
    'result_assembly',
];

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

const ROSOMAHA_FAN_EXPECTED_LINKED_OPTION_IDS = [
    841, 842, 843, 844, 847, 848, 849, 850, 851, 852, 853, 854, 855, 856,
    859, 860, 862, 865, 867, 868, 869, 870, 871, 872, 873, 874, 875, 876,
    877, 878, 882, 883, 886, 887, 893, 894, 895, 937, 938, 951, 952, 961,
    962, 975, 976, 977, 992, 998, 999, 1072, 1073, 1084, 1091, 1093, 1095,
    1096, 1097, 1098, 1099, 1112, 1113, 1114,
];

const ROSOMAHA_FAN_TEMPLATE_PEER_IDS = [876, 877, 856, 1099];

function rosomahaFanResult(array $payload, int $exitCode = 0): void
{
    $json = json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    );
    echo '__ROSOMAHA_FAN_JSON_BYTES__=', strlen($json), PHP_EOL;
    echo '__ROSOMAHA_FAN_JSON_SHA256__=', hash('sha256', $json), PHP_EOL;
    echo '__ROSOMAHA_FAN_JSON_BASE64__=', base64_encode($json), PHP_EOL;
    exit($exitCode);
}

function rosomahaFanErrorClass(Throwable $error): string
{
    if ($error instanceof ErrorException) {
        return 'ErrorException';
    }
    if ($error instanceof TypeError) {
        return 'TypeError';
    }
    if ($error instanceof RuntimeException) {
        return 'RuntimeException';
    }
    if ($error instanceof LogicException) {
        return 'LogicException';
    }
    if ($error instanceof Error) {
        return 'Error';
    }
    if ($error instanceof Exception) {
        return 'Exception';
    }
    return 'unknown';
}

function rosomahaFanErrorCode(Throwable $error, bool $originIsHelper): string
{
    $knownMessages = [
        'Bitrix prolog was not found at the pinned root' => 'prolog_not_found',
        'Bitrix iblock module could not be loaded' => 'iblock_module_load_failed',
        'Pinned Bitrix site was not found' => 'pinned_site_not_found',
        'Pinned Bitrix site is inactive' => 'pinned_site_inactive',
        'Pinned iblock was not found' => 'pinned_iblock_not_found',
        'Pinned iblock is inactive' => 'pinned_iblock_inactive',
        'Pinned iblock is not assigned to the pinned site' => 'pinned_iblock_site_mismatch',
        'Anchor code drifted from the pinned identity' => 'anchor_identity_drift',
        'Comparator no longer identifies Bagira' => 'comparator_identity_drift',
        'Two pinned model codes resolved to one element' => 'model_identity_collision',
        'Pinned model resolved to an option element' => 'model_scope_collision',
        'Pinned model scope is incomplete' => 'model_scope_incomplete',
        'LINK_GOODS contains a non-element value' => 'link_goods_non_element_value',
        'LINK_GOODS contains a duplicate element id' => 'link_goods_duplicate_element_id',
        'Render evidence is missing a linked option' =>
            'render_evidence_missing_linked_option',
    ];
    $message = $error->getMessage();
    if ($originIsHelper && isset($knownMessages[$message])) {
        return $knownMessages[$message];
    }
    if (
        $originIsHelper
        && preg_match(
            '/^Template peer [1-9][0-9]* is outside LINK_GOODS union$/D',
            $message
        ) === 1
    ) {
        return 'template_peer_outside_link_goods_union';
    }
    if ($originIsHelper) {
        return 'helper_contract_violation';
    }
    return match (rosomahaFanErrorClass($error)) {
        'TypeError' => 'external_type_error',
        'Error' => 'external_php_error',
        'RuntimeException', 'LogicException', 'ErrorException' =>
            'external_runtime_exception',
        'Exception' => 'external_exception',
        default => 'unknown_error',
    };
}

function rosomahaFanErrorEvidence(Throwable $error, string $auditStage): array
{
    $originIsHelper = $error->getFile() === __FILE__;
    $line = $error->getLine();
    $message = $error->getMessage();
    $messageBytes = strlen($message);
    return [
        'status' => 'error',
        'mode' => 'audit',
        'phase' => 'schema_and_relation_discovery',
        'apply_supported' => false,
        'database_mutations' => 0,
        'ready_for_apply' => false,
        'error_code' => rosomahaFanErrorCode($error, $originIsHelper),
        'error_class' => rosomahaFanErrorClass($error),
        'audit_stage' => in_array($auditStage, ROSOMAHA_FAN_ERROR_STAGES, true)
            ? $auditStage
            : 'bootstrap',
        'origin_is_helper' => $originIsHelper,
        'helper_line' => $originIsHelper && $line > 0 ? $line : null,
        'message_bytes' => min($messageBytes, ROSOMAHA_FAN_MAX_ERROR_MESSAGE_BYTES),
        'message_truncated' => $messageBytes > ROSOMAHA_FAN_MAX_ERROR_MESSAGE_BYTES,
        'message_sha256' => hash('sha256', $message),
    ];
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

function rosomahaFanCanonicalValue(mixed $value): mixed
{
    if (!is_array($value)) {
        return $value;
    }
    if (array_is_list($value)) {
        return array_map('rosomahaFanCanonicalValue', $value);
    }
    ksort($value, SORT_STRING);
    foreach ($value as $key => $item) {
        $value[$key] = rosomahaFanCanonicalValue($item);
    }
    return $value;
}

function rosomahaFanEvidenceHash(mixed $value): string
{
    return hash(
        'sha256',
        json_encode(
            rosomahaFanCanonicalValue($value),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        )
    );
}

function rosomahaFanPropertyShapes(array $properties): array
{
    $shapes = [];
    foreach ($properties as $property) {
        $values = $property['values'] ?? [];
        if (!is_array($values)) {
            throw new RuntimeException('Normalized property values are invalid');
        }
        $shapes[] = [
            'id' => (int) ($property['id'] ?? 0),
            'code' => (string) ($property['code'] ?? ''),
            'type' => (string) ($property['type'] ?? ''),
            'multiple' => ($property['multiple'] ?? false) === true,
            'link_iblock_id' => (int) ($property['link_iblock_id'] ?? 0),
            'value_count' => count($values),
            'values_sha256' => rosomahaFanEvidenceHash($values),
        ];
    }
    return $shapes;
}

function rosomahaFanPropertyValuesById(array $publicElement, int $propertyId): array
{
    foreach ($publicElement['properties'] as $property) {
        if ((int) ($property['id'] ?? 0) === $propertyId) {
            return is_array($property['values'] ?? null) ? $property['values'] : [];
        }
    }
    throw new RuntimeException("Element property {$propertyId} is absent");
}

function rosomahaFanOrderedLinkIds(array $publicElement): array
{
    $ids = [];
    foreach (rosomahaFanPropertyValuesById(
        $publicElement,
        ROSOMAHA_FAN_LINK_GOODS_PROPERTY_ID
    ) as $entry) {
        $value = $entry['value'] ?? null;
        if (is_int($value) && $value > 0) {
            $ids[] = $value;
        } elseif (is_string($value) && preg_match('/^[1-9][0-9]*$/D', $value) === 1) {
            $ids[] = (int) $value;
        } else {
            throw new RuntimeException('LINK_GOODS contains a non-element value');
        }
    }
    if (count($ids) !== count(array_unique($ids))) {
        throw new RuntimeException('LINK_GOODS contains a duplicate element id');
    }
    return $ids;
}

function rosomahaFanModelLinkEvidence(array $models): array
{
    $rows = [];
    $union = [];
    foreach ($models as $model) {
        $public = $model['public'];
        $orderedIds = rosomahaFanOrderedLinkIds($public);
        foreach ($orderedIds as $linkedId) {
            $union[$linkedId] = true;
        }
        $gurPositions = [];
        foreach ($orderedIds as $position => $linkedId) {
            if ($linkedId === ROSOMAHA_FAN_ANCHOR_ID) {
                $gurPositions[] = $position;
            }
        }
        $rows[] = [
            'model_id' => $public['id'],
            'model_code' => $public['code'],
            'ordered_ids' => $orderedIds,
            'ordered_ids_sha256' => rosomahaFanEvidenceHash($orderedIds),
            'count' => count($orderedIds),
            'gur_positions_zero_based' => $gurPositions,
        ];
    }
    $unionIds = array_keys($union);
    sort($unionIds, SORT_NUMERIC);
    if (count($unionIds) > ROSOMAHA_FAN_MAX_LINKED_OPTIONS) {
        throw new RuntimeException('Linked option union exceeded the fixed limit');
    }
    return [
        'models' => $rows,
        'union_ids' => $unionIds,
        'union_count' => count($unionIds),
        'union_sha256' => rosomahaFanEvidenceHash($unionIds),
        'expected_union_ids' => ROSOMAHA_FAN_EXPECTED_LINKED_OPTION_IDS,
        'matches_pinned_audit_union' => $unionIds === ROSOMAHA_FAN_EXPECTED_LINKED_OPTION_IDS,
        'gur_model_count' => count(array_filter(
            $rows,
            static fn(array $row): bool => count($row['gur_positions_zero_based']) === 1
        )),
    ];
}

function rosomahaFanLinkedOptionSummary(array $publicElement): array
{
    return [
        'id' => $publicElement['id'],
        'code' => $publicElement['code'],
        'fields' => $publicElement['fields'],
        'sections' => $publicElement['sections'],
        'property_shapes' => rosomahaFanPropertyShapes($publicElement['properties']),
        'price_values' => rosomahaFanPropertyValuesById($publicElement, 1171),
        'filter_price_values' => rosomahaFanPropertyValuesById($publicElement, 1177),
        'full_snapshot_sha256' => rosomahaFanEvidenceHash($publicElement),
    ];
}

function rosomahaFanReadLinkedOptions(array $unionIds, array $propertyById): array
{
    if (count($unionIds) > ROSOMAHA_FAN_MAX_LINKED_OPTIONS) {
        throw new RuntimeException('Linked option read exceeded the fixed limit');
    }
    $summaries = [];
    $publicById = [];
    foreach ($unionIds as $linkedId) {
        $fields = rosomahaFanReadElementFieldsById((int) $linkedId, "linked option {$linkedId}");
        $element = rosomahaFanReadElement($fields, $propertyById);
        $public = $element['public'];
        if ((int) $public['id'] !== (int) $linkedId || (string) $public['code'] === '') {
            throw new RuntimeException('Linked option identity is invalid');
        }
        $publicById[(int) $linkedId] = $public;
        $summaries[] = rosomahaFanLinkedOptionSummary($public);
    }
    return ['summaries' => $summaries, 'public_by_id' => $publicById];
}

function rosomahaFanTemplatePeers(array $publicById): array
{
    $peers = [];
    foreach (ROSOMAHA_FAN_TEMPLATE_PEER_IDS as $peerId) {
        if (!isset($publicById[$peerId])) {
            throw new RuntimeException("Template peer {$peerId} is outside LINK_GOODS union");
        }
        $peers[] = $publicById[$peerId];
    }
    return [
        'peer_ids' => ROSOMAHA_FAN_TEMPLATE_PEER_IDS,
        'elements' => $peers,
        'full_snapshot_sha256' => rosomahaFanEvidenceHash($peers),
    ];
}

function rosomahaFanFilterPriceContract(array $filterPriceValues, bool $active): array
{
    $filterPrice = null;
    $filterPriceNumericCount = 0;
    $normalizationEvidence = [];
    foreach ($filterPriceValues as $index => $entry) {
        $value = $entry['value'] ?? null;
        $evidence = [
            'index' => $index,
            'input_kind' => 'unsupported',
            'raw_utf8_bytes' => null,
            'raw_sha256' => null,
            'normalized_utf8_bytes' => null,
            'normalized_sha256' => null,
            'ascii_surrounding_whitespace_stripped' => false,
        ];
        if (is_int($value) || is_float($value)) {
            $evidence['input_kind'] = 'numeric';
            $filterPriceNumericCount++;
            $filterPrice = $value;
        } elseif (is_string($value)) {
            $normalized = trim($value, " \t\n\r\v\f");
            $evidence = [
                'index' => $index,
                'input_kind' => 'string',
                'raw_utf8_bytes' => strlen($value),
                'raw_sha256' => hash('sha256', $value),
                'normalized_utf8_bytes' => strlen($normalized),
                'normalized_sha256' => hash('sha256', $normalized),
                'ascii_surrounding_whitespace_stripped' => $normalized !== $value,
            ];
            if (preg_match('/^-?[0-9]+(?:\.[0-9]+)?$/D', $normalized) === 1) {
                $filterPriceNumericCount++;
                $filterPrice = (float) $normalized;
            }
        }
        $normalizationEvidence[] = $evidence;
    }
    $selectable = count($filterPriceValues) === 1
        && $filterPriceNumericCount === 1
        && is_numeric($filterPrice)
        && (float) $filterPrice > 0;
    return [
        'rule' => 'active_and_exactly_one_positive_filter_price',
        'normalization_rule' => 'strip_ascii_surrounding_whitespace_once',
        'normalization_evidence' => $normalizationEvidence,
        'property_value_count' => count($filterPriceValues),
        'numeric_value_count' => $filterPriceNumericCount,
        'positive_filter_price' => $selectable ? $filterPrice : null,
        'eligible' => $active && $selectable,
    ];
}

function rosomahaFanRenderItem(array $public): array
{
    $filterPriceValues = rosomahaFanPropertyValuesById($public, 1177);
    return [
        'id' => (int) $public['id'],
        'code' => (string) $public['code'],
        'name' => $public['fields']['name'],
        'active' => ($public['fields']['active'] ?? false) === true,
        'sort' => (int) ($public['fields']['sort'] ?? 0),
        'filter_price_values' => $filterPriceValues,
        'selectable_contract' => rosomahaFanFilterPriceContract(
            $filterPriceValues,
            ($public['fields']['active'] ?? false) === true
        ),
    ];
}

function rosomahaFanRenderOrderEvidence(array $modelLinks, array $publicById): array
{
    $models = [];
    foreach ($modelLinks['models'] as $modelLink) {
        $relationItems = [];
        foreach ($modelLink['ordered_ids'] as $linkedId) {
            if (!isset($publicById[$linkedId])) {
                throw new RuntimeException('Render evidence is missing a linked option');
            }
            $relationItems[] = rosomahaFanRenderItem($publicById[$linkedId]);
        }
        $selectableRelationItems = array_values(array_filter(
            $relationItems,
            static fn(array $item): bool => $item['selectable_contract']['eligible'] === true
        ));
        $sortItemsAsc = $selectableRelationItems;
        usort($sortItemsAsc, static function (array $left, array $right): int {
            $bySort = $left['sort'] <=> $right['sort'];
            return $bySort !== 0 ? $bySort : $left['id'] <=> $right['id'];
        });
        $sortItemsDesc = $selectableRelationItems;
        usort($sortItemsDesc, static function (array $left, array $right): int {
            $bySort = $left['sort'] <=> $right['sort'];
            return $bySort !== 0 ? $bySort : $right['id'] <=> $left['id'];
        });
        $below = array_values(array_filter(
            $sortItemsDesc,
            static fn(array $item): bool => $item['sort'] < ROSOMAHA_FAN_TARGET_SORT
        ));
        $equal = array_values(array_filter(
            $sortItemsDesc,
            static fn(array $item): bool => $item['sort'] === ROSOMAHA_FAN_TARGET_SORT
        ));
        $above = array_values(array_filter(
            $sortItemsDesc,
            static fn(array $item): bool => $item['sort'] > ROSOMAHA_FAN_TARGET_SORT
        ));
        $selectableIdsAsSet = array_values(array_unique(array_column(
            $selectableRelationItems,
            'id'
        )));
        sort($selectableIdsAsSet, SORT_NUMERIC);
        $models[] = [
            'model_id' => $modelLink['model_id'],
            'model_code' => $modelLink['model_code'],
            'hypotheses' => [
                'link_goods_order' => array_column($selectableRelationItems, 'id'),
                'element_sort_then_id_asc' => array_column($sortItemsAsc, 'id'),
                'element_sort_then_id_desc' => array_column($sortItemsDesc, 'id'),
            ],
            'relation_items' => $relationItems,
            'expected_selectable_count' => count($selectableRelationItems),
            'expected_selectable_ids_as_set' => $selectableIdsAsSet,
            'target_hypothesis' => [
                'target_sort' => ROSOMAHA_FAN_TARGET_SORT,
                'link_goods_append_position_zero_based' => count($relationItems),
                'sort_neighbor_before' => $below === [] ? null : $below[count($below) - 1],
                'same_sort_items' => $equal,
                'sort_neighbor_after' => $above === [] ? null : $above[0],
                'tie_break_is_unprovable_before_target_id_exists' => $equal !== [],
            ],
        ];
    }
    $existingAtTargetSort = [];
    foreach ($publicById as $public) {
        if ((int) ($public['fields']['sort'] ?? 0) === ROSOMAHA_FAN_TARGET_SORT) {
            $existingAtTargetSort[] = rosomahaFanRenderItem($public);
        }
    }
    usort(
        $existingAtTargetSort,
        static fn(array $left, array $right): int => $left['id'] <=> $right['id']
    );
    return [
        'candidate_sources' => [
            'link_goods_order',
            'element_sort_then_id_asc',
            'element_sort_then_id_desc',
        ],
        'selectable_db_rule' => 'active_and_exactly_one_positive_filter_price',
        'target_sort_from_section_gap' => ROSOMAHA_FAN_TARGET_SORT,
        'existing_union_items_at_target_sort' => $existingAtTargetSort,
        'target_sort_is_unique_in_linked_union' => $existingAtTargetSort === [],
        'models' => $models,
        'render_order_source' => null,
        'requires_public_model_page_evidence' => true,
    ];
}

function rosomahaFanNoContentOptionSamples(array $propertyById): array
{
    $samples = [];
    $eligibleCount = 0;
    $result = CIBlockElement::GetList(
        ['SORT' => 'ASC', 'ID' => 'ASC'],
        [
            'IBLOCK_ID' => ROSOMAHA_FAN_IBLOCK_ID,
            'SECTION_ID' => ROSOMAHA_FAN_OPTIONS_SECTION_ID,
            'INCLUDE_SUBSECTIONS' => 'N',
            'ACTIVE' => 'Y',
            'CHECK_PERMISSIONS' => 'N',
        ],
        false,
        ['nTopCount' => ROSOMAHA_FAN_MAX_SIBLINGS + 1],
        [
            'ID', 'IBLOCK_ID', 'IBLOCK_SECTION_ID', 'NAME', 'CODE', 'XML_ID',
            'ACTIVE', 'SORT', 'DATE_ACTIVE_FROM', 'DATE_ACTIVE_TO', 'PREVIEW_TEXT',
            'PREVIEW_TEXT_TYPE', 'DETAIL_TEXT', 'DETAIL_TEXT_TYPE', 'PREVIEW_PICTURE',
            'DETAIL_PICTURE', 'DETAIL_PAGE_URL', 'DATE_CREATE', 'TIMESTAMP_X',
        ]
    );
    $seen = 0;
    while ($fields = $result->GetNext()) {
        $seen++;
        if ($seen > ROSOMAHA_FAN_MAX_SIBLINGS) {
            throw new RuntimeException('Options section sample scan exceeded the fixed limit');
        }
        $noPictures = (int) ($fields['PREVIEW_PICTURE'] ?? 0) === 0
            && (int) ($fields['DETAIL_PICTURE'] ?? 0) === 0;
        $noText = (string) ($fields['PREVIEW_TEXT'] ?? '') === ''
            && (string) ($fields['DETAIL_TEXT'] ?? '') === '';
        if (!$noPictures || !$noText) {
            continue;
        }
        $eligibleCount++;
        if (count($samples) >= ROSOMAHA_FAN_MAX_NO_CONTENT_SAMPLES) {
            continue;
        }
        $element = rosomahaFanReadElement($fields, $propertyById)['public'];
        $samples[] = [
            'id' => $element['id'],
            'code' => $element['code'],
            'fields' => $element['fields'],
            'sections' => $element['sections'],
            'property_shapes' => rosomahaFanPropertyShapes($element['properties']),
            'full_snapshot_sha256' => rosomahaFanEvidenceHash($element),
            'public_url' => 'https://' . ROSOMAHA_FAN_DOMAIN
                . '/product/' . rawurlencode((string) $element['code']) . '/',
        ];
    }
    return [
        'section_id' => ROSOMAHA_FAN_OPTIONS_SECTION_ID,
        'active_direct_section_elements_scanned' => $seen,
        'eligible_count' => $eligibleCount,
        'samples' => $samples,
        'samples_truncated' => $eligibleCount > count($samples),
    ];
}

function rosomahaFanBoundedTemplateMap(mixed $templates): array
{
    if (!is_array($templates) || count($templates) > 64) {
        throw new RuntimeException('Inherited metadata template map is invalid');
    }
    $result = [];
    foreach ($templates as $key => $value) {
        if (!is_string($key) || strlen($key) > 128) {
            throw new RuntimeException('Inherited metadata template key is invalid');
        }
        $result[$key] = rosomahaFanNormalizeScalar($value);
    }
    ksort($result, SORT_STRING);
    return $result;
}

function rosomahaFanMetadataTemplateEvidence(): array
{
    $urls = [];
    foreach (['LIST_PAGE_URL', 'SECTION_PAGE_URL', 'DETAIL_PAGE_URL'] as $field) {
        $urls[$field] = rosomahaFanNormalizeScalar(
            (string) CIBlock::GetArrayByID(ROSOMAHA_FAN_IBLOCK_ID, $field)
        );
    }
    $evidence = [
        'iblock_page_url_templates' => $urls,
        'iblock_inherited_templates' => ['available' => false, 'templates' => null],
        'section_inherited_templates' => ['available' => false, 'templates' => null],
    ];
    $iblockClass = 'Bitrix\\Iblock\\InheritedProperty\\IblockTemplates';
    if (class_exists($iblockClass) && method_exists($iblockClass, 'findTemplates')) {
        try {
            $reader = new $iblockClass(ROSOMAHA_FAN_IBLOCK_ID);
            $evidence['iblock_inherited_templates'] = [
                'available' => true,
                'templates' => rosomahaFanBoundedTemplateMap($reader->findTemplates()),
            ];
        } catch (Throwable $error) {
            $evidence['iblock_inherited_templates']['reason'] = get_class($error);
        }
    } else {
        $evidence['iblock_inherited_templates']['reason'] = 'api_unavailable';
    }
    $sectionClass = 'Bitrix\\Iblock\\InheritedProperty\\SectionTemplates';
    if (class_exists($sectionClass) && method_exists($sectionClass, 'findTemplates')) {
        try {
            $reader = new $sectionClass(
                ROSOMAHA_FAN_IBLOCK_ID,
                ROSOMAHA_FAN_OPTIONS_SECTION_ID
            );
            $evidence['section_inherited_templates'] = [
                'available' => true,
                'templates' => rosomahaFanBoundedTemplateMap($reader->findTemplates()),
            ];
        } catch (Throwable $error) {
            $evidence['section_inherited_templates']['reason'] = get_class($error);
        }
    } else {
        $evidence['section_inherited_templates']['reason'] = 'api_unavailable';
    }
    return $evidence;
}

if (PHP_SAPI !== 'cli') {
    rosomahaFanResult([
        'status' => 'error',
        'mode' => 'blocked',
        'apply_supported' => false,
        'database_mutations' => 0,
        'ready_for_apply' => false,
        'error_code' => 'cli_only',
    ], 2);
}

$mode = $argv[1] ?? 'audit';
if ($mode !== 'audit' || count($argv) !== 2) {
    rosomahaFanResult([
        'status' => 'error',
        'mode' => 'blocked',
        'apply_supported' => false,
        'database_mutations' => 0,
        'ready_for_apply' => false,
        'error_code' => 'audit_argument_contract_failed',
    ], 2);
}

ini_set('display_errors', '0');
set_time_limit(110);
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

$auditStage = 'bootstrap';
try {
    $auditStage = 'prolog_preflight';
    $prolog = ROSOMAHA_FAN_SITE_ROOT . '/bitrix/modules/main/include/prolog_before.php';
    if (!is_file($prolog)) {
        throw new RuntimeException('Bitrix prolog was not found at the pinned root');
    }
    $auditStage = 'prolog_load';
    ob_start();
    require $prolog;
    ob_end_clean();

    $auditStage = 'iblock_module_load';
    if (!Bitrix\Main\Loader::includeModule('iblock')) {
        throw new RuntimeException('Bitrix iblock module could not be loaded');
    }

    $auditStage = 'site_read';
    $site = CSite::GetByID(ROSOMAHA_FAN_SITE_ID)->Fetch();
    if (!is_array($site) || (string) ($site['LID'] ?? '') !== ROSOMAHA_FAN_SITE_ID) {
        throw new RuntimeException('Pinned Bitrix site was not found');
    }
    if ((string) ($site['ACTIVE'] ?? 'N') !== 'Y') {
        throw new RuntimeException('Pinned Bitrix site is inactive');
    }
    $auditStage = 'iblock_read';
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

    $auditStage = 'property_schema_read';
    $propertySchema = rosomahaFanReadPropertyDefinitions();
    $auditStage = 'anchor_read';
    $anchorFields = rosomahaFanReadElementFieldsById(ROSOMAHA_FAN_ANCHOR_ID, 'anchor');
    if ((string) ($anchorFields['CODE'] ?? '') !== ROSOMAHA_FAN_ANCHOR_CODE) {
        throw new RuntimeException('Anchor code drifted from the pinned identity');
    }
    $auditStage = 'comparator_read';
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

    $auditStage = 'models_read';
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

    $auditStage = 'duplicate_read';
    $duplicates = rosomahaFanTargetDuplicates();
    $auditStage = 'relation_analysis';
    $relation = rosomahaFanRelationAnalysis(
        $propertySchema['definitions'],
        $anchor,
        $comparator,
        $models
    );
    $auditStage = 'price_analysis';
    $price = rosomahaFanPriceAnalysis(
        $propertySchema['definitions'],
        $anchor,
        $comparator
    );
    $auditStage = 'section_order';
    $sectionOrder = rosomahaFanSectionOrder($anchor['public']);
    $auditStage = 'model_link_evidence';
    $modelLinkEvidence = rosomahaFanModelLinkEvidence($models);
    $auditStage = 'linked_options_read';
    $linkedOptions = rosomahaFanReadLinkedOptions(
        $modelLinkEvidence['union_ids'],
        $propertySchema['by_id']
    );
    $auditStage = 'template_peers';
    $templatePeers = rosomahaFanTemplatePeers($linkedOptions['public_by_id']);
    $auditStage = 'render_order';
    $renderOrderEvidence = rosomahaFanRenderOrderEvidence(
        $modelLinkEvidence,
        $linkedOptions['public_by_id']
    );
    $auditStage = 'no_content_samples';
    $noContentSamples = rosomahaFanNoContentOptionSamples($propertySchema['by_id']);
    $auditStage = 'metadata_templates';
    $metadataTemplates = rosomahaFanMetadataTemplateEvidence();

    $auditStage = 'result_assembly';
    $phase1bBlockers = [];
    if (!$modelLinkEvidence['matches_pinned_audit_union']) {
        $phase1bBlockers[] = 'linked_option_union_drifted_from_pinned_audit';
    }
    if ($modelLinkEvidence['union_count'] !== 62) {
        $phase1bBlockers[] = 'linked_option_union_count_is_not_62';
    }
    if ($modelLinkEvidence['gur_model_count'] !== 8) {
        $phase1bBlockers[] = 'gur_coverage_is_not_8_of_12';
    }
    if ($noContentSamples['eligible_count'] === 0) {
        $phase1bBlockers[] = 'no_active_no_picture_no_text_option_baseline';
    }
    if (!$renderOrderEvidence['target_sort_is_unique_in_linked_union']) {
        $phase1bBlockers[] = 'target_sort_506_is_not_unique_in_linked_union';
    }
    $phase1bBlockers[] = 'public_render_order_source_not_verified';

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
    $baseAuditGatesPassed = $blockers === [];

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
        'phase1b_evidence' => [
            'linked_option_union' => [
                'ids' => $modelLinkEvidence['union_ids'],
                'count' => $modelLinkEvidence['union_count'],
                'sha256' => $modelLinkEvidence['union_sha256'],
                'expected_ids_from_pinned_audit' => $modelLinkEvidence['expected_union_ids'],
                'matches_pinned_audit' => $modelLinkEvidence['matches_pinned_audit_union'],
            ],
            'model_link_goods' => $modelLinkEvidence['models'],
            'gur_model_count' => $modelLinkEvidence['gur_model_count'],
            'linked_options' => $linkedOptions['summaries'],
            'template_peers' => $templatePeers,
            'render_order' => $renderOrderEvidence,
            'active_no_picture_no_text_options' => $noContentSamples,
            'metadata_templates' => $metadataTemplates,
            'public_verification_contract' => [
                'model_urls' => array_map(
                    static fn(string $code): string => 'https://' . ROSOMAHA_FAN_DOMAIN
                        . '/product/' . rawurlencode($code) . '/',
                    ROSOMAHA_FAN_MODEL_CODES
                ),
                'required_model_page_fields' => [
                    'http_status', 'final_url', 'self_canonical', 'robots',
                    'body_sha256', 'ordered_selectable_option_ids',
                    'ordered_selectable_option_sums',
                ],
                'render_order_source_rule' =>
                    'exactly_one_database_hypothesis_must_match_all_12_public_pages',
                'control_selector_contract' => [
                    'tag' => 'span',
                    'required_classes' => ['btn', 'bg-theme-target'],
                    'required_attributes' => [
                        'data-product-id', 'data-sum', 'data-name', 'data-row-id', 'onclick',
                    ],
                    'onclick' => 'priceCalculator.toggleOption(this)',
                ],
                'selectable_db_rule' => 'active_and_exactly_one_positive_filter_price',
                'no_content_policy_baseline_required' => true,
            ],
            'blockers' => $phase1bBlockers,
            'phase1b_evidence_ready' => false,
            'database_mutations' => 0,
        ],
        'base_audit_gates_passed' => $baseAuditGatesPassed,
        'ready_for_apply' => false,
        'blockers' => $blockers,
    ]);
} catch (Throwable $error) {
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    rosomahaFanResult(rosomahaFanErrorEvidence($error, $auditStage), 1);
}
