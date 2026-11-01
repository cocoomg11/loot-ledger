/**
 * wanderers-core: the pure half. Nothing here touches Foundry at import time or at call time, so all of it runs (and is tested) in
 * Node. The Foundry halves are in ./foundry/index.mjs.
 *
 * Status of each export (see README, Public API): everything in 0.x is experimental unless the README marks it stable.
 */
export { CORE_VERSION, parseVersion, compareVersions, RELEASE_TAG, isReleaseTag, tagVersion } from "./version.mjs";
export { esc, plain, plural, slug, isoDay } from "./text.mjs";
export { addCapped, capList, versioned } from "./records.mjs";
export { defineFeatures, isOn, allOn, splitNeeds } from "./features-model.mjs";
export { defineSettings, scopeOf, records, tabRows, convert, registration } from "./settings-model.mjs";
export {
  HEARTBEAT_MS, GRACE_MS, SETTLE_MS, SEEN_MAX, ID_RE, newId, compareSessions, aliveCutoff, leaderOf, isLeader, prune,
  readSessionMessage, applySessionMessage, pickActiveGM, seenCache, requestId, makeRequestId, parseRequestId, readHookMessage,
  acceptHook, PASSIVE_MAX_AGE_MS
} from "./leader-model.mjs";
export { RATE_BURST, RATE_PER_SECOND, rateLimiter } from "./rate-model.mjs";
export { MAX_BYTES, MAX_DEPTH, defineRequests, readRequest, makeRequest, jsonBytes } from "./socket-model.mjs";
export { LEVELS, level, healthCollector, worst, counts, FIX_ACTION_RE, FIX_LABEL_MAX, FIX_CONFIRM_MAX, readFix, healthLine, storableReport } from "./health-model.mjs";
export { CONFIRM_WORD, confirmed, hasFlags, dryRun, picked, changedSettings, summary } from "./cleanup-model.mjs";
export { FORMAT as SETTINGS_FORMAT, buildExport, checkValue, readImport, preview, fileName } from "./settings-io-model.mjs";
export { decide, entriesBetween, buildNotice, lintNotes } from "./notes-model.mjs";
export {
  SCENE_TAB_GLOBAL, SCENE_TAB_VERSION, SCENE_TAB_ID, SCENE_TAB_LABEL, SCENE_TAB_ICON, defineSection, orderSections, upsertSection, ownField,
  createRegistry, usableRegistry, claimRegistry
} from "./scene-tab-model.mjs";
export { UI_REVISION, UI_CLASSES, UI_STYLESHEET, TONES, tone, icon, badge, dot, statusLine, statusLines, navItem } from "./ui-model.mjs";
export { QUALITIES, QUALITY_KEYS, quality, qualityLabel, itemSlot } from "./quality-model.mjs";
export { COIN_RATIO, toCopper, fromCopper, formatCoins, coins } from "./coins-model.mjs";
export {
  PLACEMENT_SETTING, PLACEMENT_VERSION, PLACEMENT_MAX, PLACEMENT_SAVE_MS, PLACEMENT_MIN_SIZE, WINDOW_KEY_RE, isWindowKey, readPlacement,
  readPlacements, getPlacement, setPlacement, removePlacement, samePlacement, clampPlacement, placementOf, debouncer
} from "./window-model.mjs";
export { KEY_MODIFIERS, ACTION_RE, KEY_CODE_RE, defineOpenKeybinding, keybindingConfig } from "./keybinding-model.mjs";
export { DATA_FOLDER_NAME, DATA_FOLDER_TYPE, DATA_FOLDER_SORT, pickDataFolder, dataFolderData, dataFolderPlan, folderEmptyAfter, SHOW_SETTING, dataFolderShown, dataFolderIds } from "./data-folder-model.mjs";
export {
  STORE_MAX_BYTES, STORE_DELETE_DEPTH, STORE_FILED_FLAG, defineStore, isStoreEntry, storeEntries, rawData as storeRawData, storeCreateData,
  needsFiling, storeKeys, storeGet, storeWith, storeWithKey, storeDeletions, deletionKeys, storeSize
} from "./store-model.mjs";
