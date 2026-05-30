const DEFAULT_DISPLAY_NAME = 'Khách TikTok';

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const INVISIBLE_FORMAT_RE = /[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const REPLACEMENT_CHAR_RE = /\uFFFD/;

function cleanDisplayText(value) {
    return String(value ?? '')
        .normalize('NFC')
        .replace(CONTROL_CHAR_RE, ' ')
        .replace(INVISIBLE_FORMAT_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeTextForDisplay(value) {
    return cleanDisplayText(value).normalize('NFKC').normalize('NFC');
}

function hasReplacementChar(value) {
    return REPLACEMENT_CHAR_RE.test(String(value ?? ''));
}

function normalizeDisplayName(name, fallback = DEFAULT_DISPLAY_NAME) {
    const displayName = normalizeTextForDisplay(name);
    if (displayName && !hasReplacementChar(displayName)) {
        return displayName;
    }

    const displayFallback = normalizeTextForDisplay(fallback);
    if (displayFallback && !hasReplacementChar(displayFallback)) {
        return displayFallback;
    }

    return DEFAULT_DISPLAY_NAME;
}

function normalizeDisplayText(value) {
    return cleanDisplayText(value).replace(/\uFFFD/g, '');
}

module.exports = {
    DEFAULT_DISPLAY_NAME,
    cleanDisplayText,
    hasReplacementChar,
    normalizeDisplayName,
    normalizeTextForDisplay,
    normalizeDisplayText
};
