// Null-byte prefix cannot appear in filesystem paths, so this value is safe
// as a sentinel key for "no cwd provided" td watcher subscriptions.
export const TD_DEFAULT_WATCH_KEY = '\0default'
