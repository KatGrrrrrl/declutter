/**
 * The parent role's Family screen — the same roster the contributors see.
 *
 * It exists because administering a household (who is in it, who else may
 * administer it, who is removed) is not the same job as deciding items, and a
 * parent who set their own home up holds BOTH. Without this route they would
 * be the administrator with no way to reach the roster.
 *
 * Hidden from the tab bar (see _layout) and reached from Settings, the same
 * pattern as Legacy.
 */
export { default } from '../(child)/family';
