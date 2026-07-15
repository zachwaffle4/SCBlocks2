/**
 * OpMode tabs.
 *
 * Each OpMode is its own tab with its own workspace and a single opmode hat
 * block (`sc_opmode`) at the root — rather than many opmode blocks combined in
 * one workspace. This module handles the per-tab serialized state: creating a
 * fresh opmode, reading its display info, and generating Python for every tab.
 */
import * as Blockly from 'blockly';
import {pythonGenerator} from 'blockly/python';
import {generateMechanismDefinitions, generateOpmodeClass} from './generators/python';
import {getMechanisms} from './mechanisms';
import {getRobotMode} from './robotMode';


export const OPMODE_DETAILS_BLOCK_TYPE = 'sc_opmode_details';

const BASE_IMPORT_LINES = [
  'from commands3 import *',
  'import wpilib',
];

const OPMODE_TYPE_TO_DECORATOR: Record<OpModeType, string> = {
  Teleop: 'teleop',
  Auto: 'autonomous',
  Utility: 'utility',
};

export type OpModeType = 'Teleop' | 'Auto' | 'Utility';

// A Blockly workspace serialization (Blockly.serialization.workspaces.save).
export type WorkspaceState = {[key: string]: unknown};

export type OpModeTab = {
  id: string;
  state: WorkspaceState;
};

export type OpModeInfo = {
  name: string;
  type: OpModeType;
  enabled: boolean;
};

let nextId = 1;
export const newTabId = () =>
  `opmode-${Date.now().toString(36)}-${nextId++}`;

/**
 * A fresh opmode workspace: the details hat plus an "on start" hat, each an
 * independent opmode-scoped hat block. Motors are registered automatically from
 * the project registry, so there's no setup hat by default — one can be added
 * from the toolbox for advanced raw-Python setup.
 */
export const makeOpmodeState = (
  type: OpModeType,
  name: string,
): WorkspaceState => ({
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: OPMODE_DETAILS_BLOCK_TYPE,
        x: 40,
        y: 40,
        deletable: false,
        fields: {
          TYPE: type,
          ENABLED: 'TRUE',
          NAME: name,
          GROUP: '',
          DESCRIPTION: '',
        },
      },
      {
        type: 'sc_on_start',
        x: 40,
        y: 200,
      },
    ],
  },
});

type SerializedBlock = {
  type?: string;
  fields?: {[key: string]: unknown};
  inputs?: Record<string, SerializedInput>;
  next?: {block?: SerializedBlock};
};

type SerializedInput = {
  block?: SerializedBlock;
  shadow?: SerializedBlock;
};

const CONDITION_BLOCKS = new Set(['sc_trigger', 'sc_wait_until']);

const numberShadow = (value: number): SerializedBlock => ({
  type: 'math_number',
  fields: {NUM: value},
});

const sensorGreaterThanZeroBlock = (
  sensorBlock: SerializedBlock,
): SerializedBlock => ({
  type: 'logic_compare',
  fields: {OP: 'GT'},
  inputs: {
    A: {block: sensorBlock},
    B: {shadow: numberShadow(0)},
  },
});

const migrateSerializedBlock = (block: SerializedBlock | undefined) => {
  if (!block) return;

  const inputs = block.inputs ?? {};
  const condition = inputs.CONDITION;
  if (
    CONDITION_BLOCKS.has(block.type ?? '') &&
    condition?.block?.type === 'sc_a301_sensor_value'
  ) {
    condition.block = sensorGreaterThanZeroBlock(condition.block);
  }
  if (
    CONDITION_BLOCKS.has(block.type ?? '') &&
    condition?.shadow?.type === 'sc_a301_sensor_value'
  ) {
    condition.shadow = sensorGreaterThanZeroBlock(condition.shadow);
  }

  for (const name of Object.keys(inputs)) {
    const input = inputs[name];
    migrateSerializedBlock(input.block);
    migrateSerializedBlock(input.shadow);
  }
  migrateSerializedBlock(block.next?.block);
};

/**
 * Repairs older saved opmodes whose Boolean condition sockets contained the
 * numeric A301 sensor block directly. Blockly v13 rejects that during load.
 */
export const migrateWorkspaceState = (state: WorkspaceState): WorkspaceState => {
  const migrated = JSON.parse(JSON.stringify(state ?? {})) as WorkspaceState;
  const blocks = (migrated as {blocks?: {blocks?: SerializedBlock[]}})?.blocks
    ?.blocks;
  if (Array.isArray(blocks)) {
    for (const block of blocks) migrateSerializedBlock(block);
  }
  return migrated;
};

const findDetailsBlock = (state: WorkspaceState): SerializedBlock | null => {
  const blocks = (state as {blocks?: {blocks?: SerializedBlock[]}})?.blocks
    ?.blocks;
  if (!Array.isArray(blocks)) return null;
  return (
    blocks.find((block) => block.type === OPMODE_DETAILS_BLOCK_TYPE) ?? null
  );
};

/** Reads the opmode's display info straight from its serialized details hat. */
export const opmodeInfoFromState = (state: WorkspaceState): OpModeInfo => {
  const block = findDetailsBlock(state);
  const fields = block?.fields ?? {};
  const enabled = fields.ENABLED !== false && fields.ENABLED !== 'FALSE';
  return {
    name: (fields.NAME as string) || 'OpMode',
    type: (fields.TYPE as OpModeType) || 'Teleop',
    enabled,
  };
};

type GeneratorDefinitions = {definitions_: Record<string, string>};

/**
 * Generates Python for every opmode tab. Each tab is loaded into a throwaway
 * headless workspace; its opmode-scoped hat blocks are assembled into one class
 * (see generateOpmodeClass), and the classes are joined under a single shared
 * import header (plus any imports the escape-hatch extension blocks required).
 */
export const generateAllOpmodes = (tabs: OpModeTab[]): string => {
  const classes: string[] = [];
  const extraImports = new Set<string>();
  const decoratorImports = new Set<string>();

  for (const tab of tabs) {
    const temp = new Blockly.Workspace();
    const state = migrateWorkspaceState(tab.state);
    try {
      Blockly.serialization.workspaces.load(state, temp);
      pythonGenerator.init(temp);
      const code = generateOpmodeClass(temp, pythonGenerator).trim();
      if (code) {
        classes.push(code);
        const info = opmodeInfoFromState(state);
        if (info.enabled) {
          decoratorImports.add(OPMODE_TYPE_TO_DECORATOR[info.type] || 'teleop');
        }
      }

      // Collect imports the extension (escape-hatch) blocks registered while
      // generating, e.g. `import wpimath` for an extension enum value.
      const definitions = (pythonGenerator as unknown as GeneratorDefinitions)
        .definitions_;
      for (const key of Object.keys(definitions)) {
        if (key.startsWith('import_')) extraImports.add(definitions[key]);
      }
    } catch (error) {
      console.warn(`Skipping opmode ${tab.id} during generation:`, error);
    } finally {
      temp.dispose();
    }
  }

  if (!classes.length) return '';

  const importLines = [...BASE_IMPORT_LINES];
  for (const line of extraImports) {
    if (importLines.indexOf(line) === -1) importLines.push(line);
  }
  const needsA301 =
    classes.some((code) => code.includes(' = A301(')) ||
    (getRobotMode() === 'advanced' &&
      getMechanisms().some((mechanism) => mechanism.motorIds.length > 0));
  if (needsA301) {
    importLines.push('from rev import A301');
  }
  if (decoratorImports.size) {
    importLines.push(
      '',
      `from robot import ${[...decoratorImports].sort().join(', ')}`,
    );
  }

  const mechanisms = generateMechanismDefinitions();
  return `${importLines.join('\n')}\n\n${mechanisms ? `${mechanisms}\n\n\n` : ''}${classes.join('\n\n\n')}\n`;
};
