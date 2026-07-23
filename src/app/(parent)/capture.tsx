/**
 * Owner capture — a parent cataloguing their own belongings or a collection
 * only they can identify. Renders the very same capture flow helpers use
 * (native camera batch / web photo form); because the capturer is a decider,
 * each item is auto-marked "Keep" (see (child)/capture.tsx).
 *
 * Not a bottom tab — five labels must already fit at 375px — so it's hidden
 * (href: null) and reached from the "Add item" entry on the Decide screen.
 */
export { default } from '@/app/(child)/capture';
