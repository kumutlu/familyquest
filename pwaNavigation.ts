/**
 * Firebase Hosting owns the `/__/` namespace for Auth helpers and other
 * reserved infrastructure. Those navigations must reach Hosting instead of
 * Workbox's cached SPA shell.
 */
export const firebaseReservedNavigationDenylist = [/^\/__\//]
