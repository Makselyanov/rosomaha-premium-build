const LEGACY_MEDIA_ORIGIN_PATTERN = /^https?:\/\/(?:www\.)?rosomaha-rus\.ru/i;

function normalizeLegacyUploadPath(value: string) {
  if (LEGACY_MEDIA_ORIGIN_PATTERN.test(value) && /\/upload\//i.test(value)) {
    return value.replace(LEGACY_MEDIA_ORIGIN_PATTERN, "");
  }

  return value;
}

export function resolveMediaUrl(value?: string | null): string {
  if (!value) {
    return "";
  }

  const normalizedValue = normalizeLegacyUploadPath(value.trim());

  if (/^https?:\/\//i.test(normalizedValue)) {
    return normalizedValue;
  }

  if (normalizedValue.startsWith("/upload/")) {
    return normalizedValue;
  }

  if (normalizedValue.startsWith("upload/")) {
    return `/${normalizedValue}`;
  }

  return normalizedValue;
}

export function resolveMediaUrls(values: Array<string | null | undefined>): string[] {
  return values.map((value) => resolveMediaUrl(value)).filter(Boolean);
}
