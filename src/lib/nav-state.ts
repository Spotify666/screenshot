/**
 * Tiny in-memory navigation state shared by client components.
 * - `fromGallery`: the viewer was opened from the gallery, so "back" can use
 *   history (restoring the gallery's scroll position) instead of a fresh load.
 * - `dirty`: something was uploaded or deleted; the gallery should refetch
 *   when it's shown from the back/forward cache.
 */
export const navState = { fromGallery: false, dirty: false };
