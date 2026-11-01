export const READER_SETTINGS_KEY='novel-branches:reader-settings:v1';
export const DEFAULT_READER_SETTINGS=Object.freeze({font:'gothic',theme:'paper',size:18});
export const READER_SIZES=Object.freeze([16,18,20,24,28]);
export function normalizeReaderSettings(value) {
 const s=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 return {font:['gothic','mincho'].includes(s.font)?s.font:DEFAULT_READER_SETTINGS.font,theme:['paper','white','dark'].includes(s.theme)?s.theme:DEFAULT_READER_SETTINGS.theme,size:READER_SIZES.includes(s.size)?s.size:DEFAULT_READER_SETTINGS.size};
}
export function loadReaderSettings(storage) {
 try{return normalizeReaderSettings(JSON.parse((storage??globalThis.localStorage).getItem(READER_SETTINGS_KEY)));}catch{return {...DEFAULT_READER_SETTINGS};}
}
export function saveReaderSettings(value,storage) {
 try{(storage??globalThis.localStorage).setItem(READER_SETTINGS_KEY,JSON.stringify(normalizeReaderSettings(value)));return true;}catch{return false;}
}
