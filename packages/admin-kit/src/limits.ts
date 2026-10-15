// Limits of the admin kit (the design documents sections 2 and 3).

/** Declarations without `pageSize`. */
export const ADMIN_DEFAULT_PAGE_SIZE = 25;
/** Declarations (start-up error above it) and requests (clamped to it). */
export const ADMIN_MAX_PAGE_SIZE = 100;
/** `(page - 1) * pageSize`; 422 above it. */
export const ADMIN_MAX_OFFSET = 10_000;
/** Trimmed `search`; 422 above it. */
export const ADMIN_MAX_SEARCH_LENGTH = 100;
/** `:id` path segment; 404 above it. */
export const ADMIN_MAX_ID_LENGTH = 128;
/** Items returned per relationship link. */
export const ADMIN_MAX_LINK_ITEMS = 50;

/** Default length caps per field type (section 2). */
export const ADMIN_STRING_MAX_LENGTH = 200;
export const ADMIN_TEXT_MAX_LENGTH = 5_000;
export const ADMIN_LIST_MAX_ITEMS = 50;
export const ADMIN_LIST_ITEM_MAX_LENGTH = 100;
export const ADMIN_JSON_MAX_LENGTH = 2_000;

/** A declaration may raise `maxLength` for a type, but never above these. */
export const ADMIN_HARD_MAX_LENGTH = {
  string: 1_000,
  text: 20_000,
  json: 20_000,
} as const;
