// Save data: the model, localStorage persistence, and file export/import.
export {
  NAME_MAX_LENGTH,
  SAVE_ERRORS,
  SAVE_KEY,
  SAVE_VERSION,
  createSave,
  recordRound,
  recordEndless,
  resetProgress,
  setBounties,
  validateName,
  type NameResult,
  type NodeInfo,
  type RoundResult,
  type EndlessResult,
  type EndlessRecords,
  type SaveData,
} from "./model";
export { parseSave, sanitizeUpgrades, type SaveResult } from "./parse";
export { CORRUPT_SAVE_KEY, loadSave, writeSave } from "./storage";
export { exportSave, saveFileName } from "./file";
