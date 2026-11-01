/**
 * Loose declarations of the Foundry VTT globals, so JSDoc type checking accepts module code without Foundry's own types (which
 * aren't published as a package). Everything is `any`: the checker catches mistakes in our own code, not in Foundry calls. Verify
 * Foundry APIs at https://foundryvtt.com/api instead.
 */
declare const game: any;
declare const ui: any;
declare const canvas: any;
declare const CONFIG: any;
declare const CONST: any;
declare const Hooks: any;
declare const foundry: any;
declare function fromUuid(uuid: string, options?: object): Promise<any>;
declare function fromUuidSync(uuid: string, options?: object): any;
declare const Actor: any;
declare const Item: any;
declare const Scene: any;
declare const JournalEntry: any;
declare const ChatMessage: any;
declare const Folder: any;
declare const Macro: any;
declare const RollTable: any;
declare const Roll: any;
declare const TextEditor: any;
