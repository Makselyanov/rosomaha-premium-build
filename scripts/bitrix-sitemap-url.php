<?php

declare(strict_types=1);

const ROSOMAHA_SITEMAP_SITE_ROOT = '/home/b/berkutm4/rosomaha-rus.ru/public_html';
const ROSOMAHA_SITEMAP_DOMAIN = 'rosomaha-rus.ru';
const ROSOMAHA_SITEMAP_PUBLIC_URL = 'https://rosomaha-rus.ru/sitemap.xml';
const ROSOMAHA_SITEMAP_TARGET_URL = 'https://rosomaha-rus.ru/product/dopolnitelnaya-knopka-vklyucheniya-ventilyatora/';
const ROSOMAHA_SITEMAP_ANCHOR_LINE = "  <url><loc>https://rosomaha-rus.ru/product/dop-okhlazhdenie-gur/</loc></url>\n";
const ROSOMAHA_SITEMAP_TARGET_LINE = "  <url><loc>https://rosomaha-rus.ru/product/dopolnitelnaya-knopka-vklyucheniya-ventilyatora/</loc></url>\n";
const ROSOMAHA_SITEMAP_BASELINE_SHA256 = '1f191bb1dcc7bfe850b3b0ec64b63a1950d0c7ef865845ce427c08b4faf3f305';
const ROSOMAHA_SITEMAP_BASELINE_BYTES = 13008;
const ROSOMAHA_SITEMAP_BASELINE_URLS = 143;
const ROSOMAHA_SITEMAP_CANDIDATE_SHA256 = '11cff13b618473be3ce6e695a8f3654ea9be99983cf7c55f6116fba507b04498';
const ROSOMAHA_SITEMAP_CANDIDATE_BYTES = 13113;
const ROSOMAHA_SITEMAP_CANDIDATE_URLS = 144;
const ROSOMAHA_SITEMAP_OPERATION_ID = 'bitrix-sitemap-d415e75c421e2e3c805b0a05';
const ROSOMAHA_SITEMAP_MAX_BYTES = 256000;
const ROSOMAHA_SITEMAP_BACKUP_ROOT = '/home/b/berkutm4/migration/rosomaha-rus/backups/bitrix-sitemap-url';
const ROSOMAHA_SITEMAP_BACKINGS = [
    'root_sitemap' => '/home/b/berkutm4/rosomaha-rus.ru/public_html/sitemap.xml',
    'aspro_region_sitemap' => '/home/b/berkutm4/rosomaha-rus.ru/public_html/aspro_regions/sitemap/sitemap_rosomaha-rus.ru.xml',
];

final class RosomahaSitemapException extends RuntimeException
{
}

function rosomahaSitemapEmit(array $payload, int $exitCode = 0): never
{
    $json = json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    );
    echo '__ROSOMAHA_SITEMAP_JSON_BYTES__=', strlen($json), PHP_EOL;
    echo '__ROSOMAHA_SITEMAP_JSON_SHA256__=', hash('sha256', $json), PHP_EOL;
    echo '__ROSOMAHA_SITEMAP_JSON_BASE64__=', base64_encode($json), PHP_EOL;
    exit($exitCode);
}

function rosomahaSitemapFail(string $code): never
{
    throw new RosomahaSitemapException($code);
}

function rosomahaSitemapRead(string $path): string
{
    $stat = @lstat($path);
    if (!is_array($stat) || is_link($path) || !is_file($path)) {
        rosomahaSitemapFail('backing_not_regular');
    }
    $real = @realpath($path);
    if (!is_string($real) || $real !== $path) {
        rosomahaSitemapFail('backing_realpath_mismatch');
    }
    $size = @filesize($path);
    if (!is_int($size) || $size < 1 || $size > ROSOMAHA_SITEMAP_MAX_BYTES) {
        rosomahaSitemapFail('backing_size_invalid');
    }
    $body = @file_get_contents($path);
    if (!is_string($body) || strlen($body) !== $size) {
        rosomahaSitemapFail('backing_read_failed');
    }
    return $body;
}

function rosomahaSitemapState(string $body): array
{
    $bytes = strlen($body);
    $sha = hash('sha256', $body);
    $locCount = substr_count($body, '<loc>');
    $targetCount = substr_count($body, '<loc>' . ROSOMAHA_SITEMAP_TARGET_URL . '</loc>');
    if (
        $bytes === ROSOMAHA_SITEMAP_BASELINE_BYTES
        && hash_equals(ROSOMAHA_SITEMAP_BASELINE_SHA256, $sha)
        && $locCount === ROSOMAHA_SITEMAP_BASELINE_URLS
        && $targetCount === 0
    ) {
        $state = 'baseline';
    } elseif (
        $bytes === ROSOMAHA_SITEMAP_CANDIDATE_BYTES
        && hash_equals(ROSOMAHA_SITEMAP_CANDIDATE_SHA256, $sha)
        && $locCount === ROSOMAHA_SITEMAP_CANDIDATE_URLS
        && $targetCount === 1
    ) {
        $state = 'candidate';
    } else {
        rosomahaSitemapFail('sitemap_state_unpinned');
    }
    return [
        'state' => $state,
        'bytes' => $bytes,
        'sha256' => $sha,
        'url_count' => $locCount,
        'unique_url_count' => $locCount,
        'target_count' => $targetCount,
    ];
}

function rosomahaSitemapCandidate(string $baseline): string
{
    $before = rosomahaSitemapState($baseline);
    if ($before['state'] !== 'baseline') {
        rosomahaSitemapFail('candidate_requires_baseline');
    }
    if (
        substr_count($baseline, ROSOMAHA_SITEMAP_ANCHOR_LINE) !== 1
        || substr_count($baseline, ROSOMAHA_SITEMAP_TARGET_LINE) !== 0
        || str_contains($baseline, "\r")
    ) {
        rosomahaSitemapFail('candidate_anchor_contract_failed');
    }
    $candidate = str_replace(
        ROSOMAHA_SITEMAP_ANCHOR_LINE,
        ROSOMAHA_SITEMAP_ANCHOR_LINE . ROSOMAHA_SITEMAP_TARGET_LINE,
        $baseline,
        $replacements
    );
    if ($replacements !== 1 || rosomahaSitemapState($candidate)['state'] !== 'candidate') {
        rosomahaSitemapFail('candidate_digest_mismatch');
    }
    return $candidate;
}

function rosomahaSitemapRequest(string $mode, string $encoded, string $declaredSha): array
{
    if (!in_array($mode, ['audit', 'dry-run', 'apply', 'recover'], true)) {
        rosomahaSitemapFail('mode_invalid');
    }
    if (preg_match('/^[A-Za-z0-9+\/]+={0,2}$/D', $encoded) !== 1) {
        rosomahaSitemapFail('request_base64_invalid');
    }
    $raw = base64_decode($encoded, true);
    if (!is_string($raw) || strlen($raw) > 64000 || !hash_equals($declaredSha, hash('sha256', $raw))) {
        rosomahaSitemapFail('request_integrity_failed');
    }
    $request = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($request) || array_keys($request) !== [
        'candidate_sha256', 'mode', 'operation_id', 'public_body_b64',
        'public_bytes', 'public_sha256', 'schema',
    ]) {
        rosomahaSitemapFail('request_shape_invalid');
    }
    if (
        $request['schema'] !== 1
        || $request['mode'] !== $mode
        || $request['operation_id'] !== ROSOMAHA_SITEMAP_OPERATION_ID
        || $request['candidate_sha256'] !== ROSOMAHA_SITEMAP_CANDIDATE_SHA256
        || !is_string($request['public_body_b64'])
        || !is_int($request['public_bytes'])
        || !is_string($request['public_sha256'])
    ) {
        rosomahaSitemapFail('request_identity_invalid');
    }
    $publicBody = base64_decode($request['public_body_b64'], true);
    if (
        !is_string($publicBody)
        || strlen($publicBody) !== $request['public_bytes']
        || !hash_equals(hash('sha256', $publicBody), $request['public_sha256'])
    ) {
        rosomahaSitemapFail('public_body_integrity_failed');
    }
    $publicState = rosomahaSitemapState($publicBody);
    if (in_array($mode, ['dry-run', 'apply'], true) && $publicState['state'] !== 'baseline') {
        rosomahaSitemapFail('write_mode_requires_baseline');
    }
    $request['public_body'] = $publicBody;
    $request['public_state'] = $publicState;
    return $request;
}

function rosomahaSitemapDiscover(string $publicBody): array
{
    $matches = [];
    $evidence = [];
    foreach (ROSOMAHA_SITEMAP_BACKINGS as $alias => $path) {
        if (!file_exists($path) && !is_link($path)) {
            $evidence[] = ['alias' => $alias, 'state' => 'missing', 'matches_public' => false];
            continue;
        }
        $regular = is_file($path) && !is_link($path) && @realpath($path) === $path;
        if (!$regular) {
            $evidence[] = ['alias' => $alias, 'state' => 'unsafe', 'matches_public' => false];
            continue;
        }
        $body = rosomahaSitemapRead($path);
        $matchesPublic = hash_equals($body, $publicBody);
        $evidence[] = [
            'alias' => $alias,
            'state' => 'regular',
            'bytes' => strlen($body),
            'sha256' => hash('sha256', $body),
            'matches_public' => $matchesPublic,
        ];
        if ($matchesPublic) {
            $matches[] = ['alias' => $alias, 'path' => $path, 'body' => $body];
        }
    }
    if (count($matches) !== 1) {
        rosomahaSitemapFail('active_backing_not_unique');
    }
    return ['active' => $matches[0], 'evidence' => $evidence];
}

function rosomahaSitemapWriteExact(string $path, string $body, int $mode): void
{
    $handle = @fopen($path, 'x+b');
    if ($handle === false) {
        rosomahaSitemapFail('exclusive_write_open_failed');
    }
    $offset = 0;
    try {
        $length = strlen($body);
        while ($offset < $length) {
            $written = @fwrite($handle, substr($body, $offset));
            if (!is_int($written) || $written < 1) {
                rosomahaSitemapFail('exclusive_write_failed');
            }
            $offset += $written;
        }
        if (!@fflush($handle) || !function_exists('fsync') || !@fsync($handle)) {
            rosomahaSitemapFail('file_fsync_failed');
        }
    } finally {
        fclose($handle);
    }
    if (!@chmod($path, $mode)) {
        @unlink($path);
        rosomahaSitemapFail('file_mode_failed');
    }
}

function rosomahaSitemapFsyncDirectory(string $directory): bool
{
    $handle = @fopen($directory, 'r');
    if ($handle === false) {
        return false;
    }
    try {
        // The candidate and restore files are always fsync'ed before rename.
        // Directory fsync is an additional durability signal; some PHP stream
        // builds do not support it for directory handles, so it is fail-soft.
        return function_exists('fsync') && @fsync($handle);
    } finally {
        fclose($handle);
    }
}

function rosomahaSitemapAtomicReplace(
    string $path,
    string $baseline,
    string $candidate,
    int $fileMode,
    bool &$renamed
): void {
    $directory = dirname($path);
    $temp = $directory . '/.sitemap.' . ROSOMAHA_SITEMAP_OPERATION_ID . '.tmp';
    if (file_exists($temp) || is_link($temp)) {
        rosomahaSitemapFail('candidate_temp_exists');
    }
    rosomahaSitemapWriteExact($temp, $candidate, $fileMode);
    try {
        if (!hash_equals(ROSOMAHA_SITEMAP_CANDIDATE_SHA256, hash_file('sha256', $temp))) {
            rosomahaSitemapFail('candidate_temp_digest_failed');
        }
        if (!hash_equals($baseline, rosomahaSitemapRead($path))) {
            rosomahaSitemapFail('preimage_changed_before_rename');
        }
        if (!@rename($temp, $path)) {
            rosomahaSitemapFail('candidate_atomic_rename_failed');
        }
        $renamed = true;
        rosomahaSitemapFsyncDirectory($directory);
        if (!hash_equals($candidate, rosomahaSitemapRead($path))) {
            rosomahaSitemapFail('candidate_readback_failed');
        }
    } finally {
        if (file_exists($temp) || is_link($temp)) {
            @unlink($temp);
        }
    }
}

function rosomahaSitemapRestore(string $path, string $backup, int $fileMode): void
{
    $baseline = rosomahaSitemapRead($backup);
    if (rosomahaSitemapState($baseline)['state'] !== 'baseline') {
        rosomahaSitemapFail('restore_backup_invalid');
    }
    $directory = dirname($path);
    $temp = $directory . '/.sitemap.' . ROSOMAHA_SITEMAP_OPERATION_ID . '.restore.tmp';
    if (file_exists($temp) || is_link($temp)) {
        rosomahaSitemapFail('restore_temp_exists');
    }
    rosomahaSitemapWriteExact($temp, $baseline, $fileMode);
    try {
        if (!@rename($temp, $path)) {
            rosomahaSitemapFail('restore_atomic_rename_failed');
        }
        rosomahaSitemapFsyncDirectory($directory);
        if (!hash_equals($baseline, rosomahaSitemapRead($path))) {
            rosomahaSitemapFail('restore_readback_failed');
        }
    } finally {
        if (file_exists($temp) || is_link($temp)) {
            @unlink($temp);
        }
    }
}

function rosomahaSitemapPublicReadback(): string
{
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 10,
            'follow_location' => 0,
            'max_redirects' => 0,
            'ignore_errors' => true,
            'header' => "User-Agent: RosomahaFixedSitemapUrl/1.0\r\nCache-Control: no-cache\r\nAccept: application/xml,text/xml\r\n",
        ],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    for ($attempt = 0; $attempt < 4; $attempt++) {
        $http_response_header = [];
        $body = @file_get_contents(ROSOMAHA_SITEMAP_PUBLIC_URL, false, $context);
        $status = $http_response_header[0] ?? '';
        if (
            is_string($body)
            && strlen($body) <= ROSOMAHA_SITEMAP_MAX_BYTES
            && preg_match('/^HTTP\/\S+ 200(?: |$)/D', $status) === 1
            && hash_equals(ROSOMAHA_SITEMAP_CANDIDATE_SHA256, hash('sha256', $body))
            && strlen($body) === ROSOMAHA_SITEMAP_CANDIDATE_BYTES
        ) {
            return $body;
        }
        if ($attempt < 3) {
            usleep(250000);
        }
    }
    rosomahaSitemapFail('public_candidate_readback_failed');
}

function rosomahaSitemapBase(string $mode, array $active, array $before): array
{
    return [
        'schema' => 1,
        'mode' => $mode,
        'operation_id' => ROSOMAHA_SITEMAP_OPERATION_ID,
        'domain' => ROSOMAHA_SITEMAP_DOMAIN,
        'site_root_identity' => 'pinned_rosomaha_rus_docroot',
        'generator_used' => false,
        'database_used' => false,
        'robots_changed' => false,
        'active_backing' => [
            'alias' => $active['alias'],
            'exact_public_byte_match' => true,
            'regular_non_symlink' => true,
            // Root sitemap is the only historically proven write target.
            'write_authorized' => $active['alias'] === 'root_sitemap',
        ],
        'before' => $before,
    ];
}

function rosomahaSitemapReadBackupState(): array
{
    $operationDir = ROSOMAHA_SITEMAP_BACKUP_ROOT . '/' . ROSOMAHA_SITEMAP_OPERATION_ID;
    $backup = $operationDir . '/sitemap.preimage.xml';
    if (!file_exists($backup) && !is_link($backup)) {
        return [
            'operation_directory_exists' => is_dir($operationDir) || is_link($operationDir),
            'exists' => false,
            'exact_baseline' => false,
        ];
    }
    if (!is_file($backup) || is_link($backup) || @realpath($backup) !== $backup) {
        return [
            'operation_directory_exists' => true,
            'exists' => true,
            'exact_baseline' => false,
        ];
    }
    $body = rosomahaSitemapRead($backup);
    return [
        'operation_directory_exists' => true,
        'exists' => true,
        'exact_baseline' => strlen($body) === ROSOMAHA_SITEMAP_BASELINE_BYTES
            && hash_equals(ROSOMAHA_SITEMAP_BASELINE_SHA256, hash('sha256', $body)),
    ];
}

function rosomahaSitemapRun(string $mode, array $request): array
{
    if (@realpath(ROSOMAHA_SITEMAP_SITE_ROOT) !== ROSOMAHA_SITEMAP_SITE_ROOT) {
        rosomahaSitemapFail('site_root_identity_failed');
    }
    $discovery = rosomahaSitemapDiscover($request['public_body']);
    $active = $discovery['active'];
    $before = rosomahaSitemapState($active['body']);
    $base = rosomahaSitemapBase($mode, $active, $before);
    $base['discovery'] = $discovery['evidence'];

    if ($mode === 'audit') {
        return $base + [
            'status' => 'ok',
            'after' => $before,
            'filesystem_mutations' => 0,
            'diff' => ['added' => [], 'removed' => []],
        ];
    }

    if ($mode === 'dry-run') {
        $candidate = rosomahaSitemapCandidate($active['body']);
        return $base + [
            'status' => $base['active_backing']['write_authorized'] ? 'ready' : 'blocked',
            'after' => rosomahaSitemapState($candidate),
            'filesystem_mutations' => 0,
            'diff' => ['added' => [ROSOMAHA_SITEMAP_TARGET_URL], 'removed' => []],
        ];
    }

    if ($mode === 'recover') {
        $backupState = rosomahaSitemapReadBackupState();
        $classification = 'indeterminate';
        if ($before['state'] === 'candidate' && $backupState['exact_baseline']) {
            $classification = 'active_complete';
        } elseif (
            $before['state'] === 'baseline'
            && !$backupState['operation_directory_exists']
            && !$backupState['exists']
        ) {
            $classification = 'not_started';
        } elseif ($before['state'] === 'baseline' && $backupState['exact_baseline']) {
            $classification = 'rolled_back';
        }
        return $base + [
            'status' => $classification,
            'classification' => $classification,
            'backup' => $backupState,
            'after' => $before,
            'filesystem_mutations' => 0,
            'diff' => ['added' => [], 'removed' => []],
            'read_only' => true,
        ];
    }

    if ($active['alias'] !== 'root_sitemap') {
        rosomahaSitemapFail('active_backing_not_write_authorized');
    }
    if ($before['state'] !== 'baseline') {
        rosomahaSitemapFail('apply_preimage_drifted');
    }

    $backupParent = dirname(ROSOMAHA_SITEMAP_BACKUP_ROOT);
    if (@realpath($backupParent) !== $backupParent) {
        rosomahaSitemapFail('backup_parent_identity_failed');
    }
    if (!is_dir(ROSOMAHA_SITEMAP_BACKUP_ROOT)) {
        if (!@mkdir(ROSOMAHA_SITEMAP_BACKUP_ROOT, 0700, false)) {
            rosomahaSitemapFail('backup_root_create_failed');
        }
    }
    if (@realpath(ROSOMAHA_SITEMAP_BACKUP_ROOT) !== ROSOMAHA_SITEMAP_BACKUP_ROOT) {
        rosomahaSitemapFail('backup_root_identity_failed');
    }
    $operationDir = ROSOMAHA_SITEMAP_BACKUP_ROOT . '/' . ROSOMAHA_SITEMAP_OPERATION_ID;
    if (file_exists($operationDir) || is_link($operationDir)) {
        rosomahaSitemapFail('operation_already_exists_no_retry');
    }
    if (!@mkdir($operationDir, 0700, false) || @realpath($operationDir) !== $operationDir) {
        rosomahaSitemapFail('operation_directory_failed');
    }
    $backup = $operationDir . '/sitemap.preimage.xml';
    $fileMode = ((int) @fileperms($active['path'])) & 0777;
    if ($fileMode < 0400 || $fileMode > 0777) {
        rosomahaSitemapFail('active_file_mode_invalid');
    }
    rosomahaSitemapWriteExact($backup, $active['body'], 0400);
    if (!hash_equals($active['body'], rosomahaSitemapRead($backup))) {
        rosomahaSitemapFail('backup_readback_failed');
    }
    $candidate = rosomahaSitemapCandidate($active['body']);
    $lockPath = ROSOMAHA_SITEMAP_BACKUP_ROOT . '/operation.lock';
    $lock = @fopen($lockPath, 'c');
    if ($lock === false || !@flock($lock, LOCK_EX | LOCK_NB)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        rosomahaSitemapFail('operation_lock_unavailable');
    }
    $renamed = false;
    try {
        // Re-read under lock immediately before the single mutation.
        if (!hash_equals($request['public_body'], rosomahaSitemapRead($active['path']))) {
            rosomahaSitemapFail('locked_preimage_drifted');
        }
        rosomahaSitemapAtomicReplace(
            $active['path'], $active['body'], $candidate, $fileMode, $renamed
        );
        $public = rosomahaSitemapPublicReadback();
        return $base + [
            'status' => 'applied',
            'after' => rosomahaSitemapState(rosomahaSitemapRead($active['path'])),
            'filesystem_mutations' => 1,
            'diff' => ['added' => [ROSOMAHA_SITEMAP_TARGET_URL], 'removed' => []],
            'backup' => [
                'bytes' => strlen($active['body']),
                'sha256' => hash('sha256', $active['body']),
                'immutable_mode' => '0400',
            ],
            'public_readback' => [
                'bytes' => strlen($public),
                'sha256' => hash('sha256', $public),
                'exact_candidate' => true,
            ],
            'atomic_replace' => true,
            'automatic_restore_required' => false,
        ];
    } catch (Throwable $error) {
        $restoreOk = true;
        if ($renamed) {
            try {
                rosomahaSitemapRestore($active['path'], $backup, $fileMode);
            } catch (Throwable) {
                $restoreOk = false;
            }
        }
        $after = null;
        try {
            $after = rosomahaSitemapState(rosomahaSitemapRead($active['path']));
        } catch (Throwable) {
            $after = [
                'state' => 'unknown', 'bytes' => 0, 'sha256' => str_repeat('0', 64),
                'url_count' => 0, 'unique_url_count' => 0, 'target_count' => 0,
            ];
        }
        rosomahaSitemapEmit($base + [
            'status' => 'error',
            'error_code' => $error instanceof RosomahaSitemapException
                ? $error->getMessage() : 'unexpected_apply_error',
            'after' => $after,
            'filesystem_mutations' => $renamed ? 2 : 0,
            'diff' => ['added' => [], 'removed' => []],
            'automatic_restore_required' => $renamed,
            'automatic_restore_ok' => $restoreOk,
        ], 1);
    } finally {
        @flock($lock, LOCK_UN);
        fclose($lock);
    }
}

try {
    if (count($argv) !== 4) {
        rosomahaSitemapFail('argv_shape_invalid');
    }
    $mode = $argv[1];
    $request = rosomahaSitemapRequest($mode, $argv[2], $argv[3]);
    $result = rosomahaSitemapRun($mode, $request);
    rosomahaSitemapEmit($result, 0);
} catch (Throwable $error) {
    rosomahaSitemapEmit([
        'schema' => 1,
        'mode' => isset($mode) && is_string($mode) ? $mode : 'invalid',
        'operation_id' => ROSOMAHA_SITEMAP_OPERATION_ID,
        'status' => 'error',
        'error_code' => $error instanceof RosomahaSitemapException
            ? $error->getMessage() : 'unexpected_operator_error',
        'generator_used' => false,
        'database_used' => false,
        'robots_changed' => false,
    ], 1);
}
