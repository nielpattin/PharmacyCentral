/**
 * Drops the "actions" column when no shown row has an action for the current user, so a table never keeps a header
 * and empty cells where every button is hidden. Pass the same check the row buttons use.
 */
export const withActionColumn = <C extends { key: string }>(columns: C[], hasAction: boolean): C[] =>
  hasAction ? columns : columns.filter((column) => column.key !== "actions");
