import type { SettingRow } from './types'

/**
 * The two marks a row can carry. A plugin row brings its own answers: its
 * value lives in the plugin registry rather than in this screen's stores, so
 * `touched` and `fromConfigFile` are properties of the plugin's layers, not of
 * anything hydration recorded.
 */
export function rowMarks(
  row: SettingRow,
  fromStore: { fromConfigFile: boolean; touched: boolean }
): { fromConfigFile: boolean; touched: boolean } {
  if (row.kind !== 'info' && row.kind !== 'action' && row.storage === 'plugin') {
    return { fromConfigFile: row.fromConfigFile, touched: row.isSet }
  }
  return fromStore
}
