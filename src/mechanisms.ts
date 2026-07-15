import * as Blockly from 'blockly';
import {getDevice} from './devices';
import type {WorkspaceState} from './opmodes';

/**
 * A project-level commands2 subsystem made from one or more A301 motors and
 * any sensors or named RobotPy objects used by its event workspace.
 *
 * The stable ids are intentional: a block continues to point at the same
 * mechanism when its display name changes, and a removed mechanism remains
 * visibly missing instead of being silently retargeted.
 */
export type Mechanism = {
  id: string;
  name: string;
  motorIds: string[];
  /** Scratch-style event workspace used in Advanced mode. */
  state: WorkspaceState;
};

const EMPTY_MECHANISM_LABEL = '(add a mechanism)';
const MISSING_MECHANISM_LABEL = '(missing mechanism)';
const EMPTY_COMMAND_LABEL = '(add a command event)';
const MISSING_COMMAND_LABEL = '(missing command)';

let mechanisms: Mechanism[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const newMechanismId = () =>
  `mechanism-${Date.now().toString(36)}-${nextId++}`;

const uniqueName = (base: string) => {
  const taken = new Set(mechanisms.map((mechanism) => mechanism.name));
  if (!taken.has(base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base}_${index}`;
    if (!taken.has(candidate)) return candidate;
  }
};

const normalizeMotorIds = (motorIds: unknown) =>
  Array.isArray(motorIds)
    ? [...new Set(motorIds.filter((id): id is string => typeof id === 'string'))]
    : [];

/** A newly added subsystem starts with the two useful Scratch-style events. */
export const makeMechanismState = (): WorkspaceState => ({
  blocks: {
    languageVersion: 0,
    blocks: [
      {type: 'sc_subsystem_on_start', x: 40, y: 40},
      {
        type: 'sc_subsystem_on_command',
        x: 40,
        y: 150,
        fields: {COMMAND: 'run'},
      },
    ],
  },
});

type SerializedBlock = {
  type?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, {block?: SerializedBlock; shadow?: SerializedBlock}>;
  next?: {block?: SerializedBlock};
};

const numberShadow = (value: number): SerializedBlock => ({
  type: 'math_number',
  fields: {NUM: value},
});

const numericSensorCondition = (sensor: SerializedBlock): SerializedBlock => ({
  type: 'logic_compare',
  fields: {OP: 'GT'},
  inputs: {
    A: {block: sensor},
    B: {shadow: numberShadow(0)},
  },
});

/**
 * Blockly requires Boolean sockets to contain Boolean-producing blocks. Older
 * mechanism workspaces could put the numeric A301 sensor block directly into
 * `wait until` or `if`, so repair those saved states before loading them.
 */
const migrateSensorConditions = (block: SerializedBlock) => {
  const inputs = block.inputs || {};
  const conditionNames =
    block.type === 'sc_wait_until'
      ? ['CONDITION']
      : block.type === 'sc_if'
        ? Object.keys(inputs).filter((name) => /^IF\d+$/.test(name))
        : [];
  for (const name of conditionNames) {
    const input = inputs[name];
    if (input?.block?.type === 'sc_a301_sensor_value') {
      input.block = numericSensorCondition(input.block);
    }
    if (input?.shadow?.type === 'sc_a301_sensor_value') {
      input.shadow = numericSensorCondition(input.shadow);
    }
  }
};

const legacyMotorIds = (value: unknown) => {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
};

const directMotorCommands = (
  type: 'sc_motor_group_set_power' | 'sc_motor_group_stop' | 'sc_subsystem_set_power' | 'sc_subsystem_stop',
  block: SerializedBlock,
  mechanismMotorIds: string[],
) => {
  const group = block.inputs?.GROUP?.block;
  const requestedMotorIds = type.startsWith('sc_motor_group')
    ? legacyMotorIds(group?.fields?.MOTORS)
    : mechanismMotorIds;
  const motorIds = requestedMotorIds.filter(
    (id) => mechanismMotorIds.indexOf(id) !== -1,
  );
  const next = block.next;
  const commands: SerializedBlock[] = motorIds.map((id) => ({
    type: type.endsWith('set_power')
      ? 'sc_motor_set_power'
      : 'sc_motor_stop',
    fields: {DEVICE: id},
    ...(type.endsWith('set_power') && block.inputs?.POWER
      ? {inputs: {POWER: block.inputs.POWER}}
      : {}),
  }));

  if (!commands.length) {
    // A removed or empty group used to be a no-op. Preserve that behavior with
    // a valid command block so old workspaces can still load and be edited.
    Object.assign(block, {
      type: 'sc_wait_seconds',
      fields: undefined,
      inputs: {SECONDS: {shadow: {type: 'math_number', fields: {NUM: 0}}}},
      next,
    });
    return;
  }

  for (let index = 0; index < commands.length - 1; index += 1) {
    commands[index].next = {block: commands[index + 1]};
  }
  commands[commands.length - 1].next = next;
  Object.assign(block, commands[0]);
};

/**
 * The temporary motor-group surface has been retired. Convert its saved
 * commands to the mechanism's ordinary per-motor blocks so existing projects
 * stay editable without keeping the old block types in the toolbox.
 */
const migrateSubsystemState = (
  state: WorkspaceState,
  motorIds: string[],
): WorkspaceState => {
  const migrated = JSON.parse(JSON.stringify(state ?? {})) as WorkspaceState;
  const visit = (block: SerializedBlock | undefined) => {
    if (!block) return;
    if (
      block.type === 'sc_subsystem_set_power' ||
      block.type === 'sc_subsystem_stop' ||
      block.type === 'sc_motor_group_set_power' ||
      block.type === 'sc_motor_group_stop'
    ) {
      directMotorCommands(block.type, block, motorIds);
    } else if (block.type === 'sc_motor_group') {
      block.type = 'math_number';
      block.fields = {NUM: 0};
      block.inputs = undefined;
    }
    migrateSensorConditions(block);
    const inputs = block.inputs || {};
    for (const name of Object.keys(inputs)) {
      const input = inputs[name];
      visit(input.block);
      visit(input.shadow);
    }
    visit(block.next?.block);
  };
  const blocks = (migrated as {blocks?: {blocks?: SerializedBlock[]}})
    .blocks?.blocks;
  for (const block of blocks || []) visit(block);
  return migrated;
};

export const getMechanisms = (): readonly Mechanism[] => mechanisms;

export const getMechanism = (id: string | null | undefined) =>
  id ? mechanisms.find((mechanism) => mechanism.id === id) : undefined;

export const onMechanismsChanged = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const addMechanism = (partial: Partial<Mechanism> = {}): Mechanism => {
  const motorIds = normalizeMotorIds(partial.motorIds);
  const mechanism: Mechanism = {
    id: partial.id || newMechanismId(),
    name: uniqueName(partial.name?.trim() || `mechanism_${mechanisms.length + 1}`),
    motorIds,
    state: migrateSubsystemState(partial.state || makeMechanismState(), motorIds),
  };
  mechanisms = [...mechanisms, mechanism];
  notify();
  return mechanism;
};

export const updateMechanism = (id: string, patch: Partial<Mechanism>) => {
  mechanisms = mechanisms.map((mechanism) =>
    mechanism.id === id
      ? (() => {
          const motorIds =
            patch.motorIds === undefined
              ? mechanism.motorIds
              : normalizeMotorIds(patch.motorIds);
          return {
            ...mechanism,
            ...patch,
            id: mechanism.id,
            name: patch.name?.trim() || mechanism.name,
            motorIds,
            state: migrateSubsystemState(patch.state || mechanism.state, motorIds),
          };
        })()
      : mechanism,
  );
  notify();
};

export const removeMechanism = (id: string) => {
  mechanisms = mechanisms.filter((mechanism) => mechanism.id !== id);
  notify();
};

export const setMechanisms = (list: unknown) => {
  const next: Mechanism[] = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Partial<Mechanism>;
      next.push({
        id: candidate.id || newMechanismId(),
        name: candidate.name?.trim() || 'mechanism',
        motorIds: normalizeMotorIds(candidate.motorIds),
        state: migrateSubsystemState(
          candidate.state || makeMechanismState(),
          normalizeMotorIds(candidate.motorIds),
        ),
      });
    }
  }
  mechanisms = next;
  notify();
};

export const mechanismMotorNames = (mechanism: Mechanism) =>
  mechanism.motorIds.map((id) => getDevice(id)?.name || '(missing motor)');

/** Reads command-event names directly from a saved subsystem workspace. */
export const mechanismCommandNames = (mechanism: Mechanism) => {
  const names = new Set<string>();
  const visit = (block: SerializedBlock | undefined) => {
    if (!block) return;
    if (block.type === 'sc_subsystem_on_command') {
      const name = String(block.fields?.COMMAND || '').trim();
      if (name) names.add(name);
    }
    const inputs = block.inputs || {};
    for (const name of Object.keys(inputs)) {
      visit(inputs[name].block);
      visit(inputs[name].shadow);
    }
    visit(block.next?.block);
  };
  const root = (mechanism.state as {blocks?: {blocks?: SerializedBlock[]}})
    .blocks?.blocks;
  for (const block of root || []) visit(block);
  return [...names];
};

type DropdownOption = [string, string];

const mechanismOptions = (currentValue?: string): DropdownOption[] => {
  const options = mechanisms.map((mechanism) => [mechanism.name, mechanism.id] as DropdownOption);
  if (!options.length) return [[EMPTY_MECHANISM_LABEL, '']];
  if (currentValue && !mechanisms.some((mechanism) => mechanism.id === currentValue)) {
    options.push([MISSING_MECHANISM_LABEL, currentValue]);
  }
  return options;
};

function mechanismMenuGenerator(
  this: Blockly.FieldDropdown,
): DropdownOption[] {
  const current = this.getValue?.();
  return mechanismOptions(typeof current === 'string' ? current : undefined);
}

/** Dropdown used by mechanism command blocks. */
export class FieldMechanism extends Blockly.FieldDropdown {
  constructor() {
    super(mechanismMenuGenerator);
  }

  static fromJson(): FieldMechanism {
    return new FieldMechanism();
  }

  protected override doClassValidation_(newValue?: string): string | null {
    return newValue == null ? null : String(newValue);
  }
}

export const MECHANISM_FIELD_TYPE = 'field_mechanism';

const mechanismCommandOptions = (
  mechanismId: string,
  currentValue?: string,
): DropdownOption[] => {
  const mechanism = getMechanism(mechanismId);
  const options = mechanism
    ? mechanismCommandNames(mechanism).map((name) => [name, name] as DropdownOption)
    : [];
  if (!options.length) return [[EMPTY_COMMAND_LABEL, ''] as DropdownOption];
  if (currentValue && !options.some(([, name]) => name === currentValue)) {
    options.push([MISSING_COMMAND_LABEL, currentValue]);
  }
  return options;
};

function mechanismCommandMenuGenerator(
  this: Blockly.FieldDropdown,
): DropdownOption[] {
  const mechanismId = this.getSourceBlock()?.getFieldValue('MECHANISM') || '';
  const current = this.getValue?.();
  return mechanismCommandOptions(
    mechanismId,
    typeof current === 'string' ? current : undefined,
  );
}

/** Command-name dropdown scoped to the selected subsystem. */
export class FieldMechanismCommand extends Blockly.FieldDropdown {
  constructor() {
    super(mechanismCommandMenuGenerator);
  }

  static fromJson(): FieldMechanismCommand {
    return new FieldMechanismCommand();
  }

  protected override doClassValidation_(newValue?: string): string | null {
    return newValue == null ? null : String(newValue);
  }
}

export const MECHANISM_COMMAND_FIELD_TYPE = 'field_mechanism_command';

let fieldRegistered = false;
export const registerMechanismField = () => {
  if (fieldRegistered) return;
  Blockly.fieldRegistry.register(MECHANISM_FIELD_TYPE, FieldMechanism);
  Blockly.fieldRegistry.register(
    MECHANISM_COMMAND_FIELD_TYPE,
    FieldMechanismCommand,
  );
  fieldRegistered = true;
};

export const refreshMechanismFields = (workspace: Blockly.Workspace) => {
  for (const block of workspace.getAllBlocks(false)) {
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (field instanceof FieldMechanism || field instanceof FieldMechanismCommand) {
          field.forceRerender();
        }
      }
    }
  }
};

export const mechanismField = (name = 'MECHANISM') => ({
  type: MECHANISM_FIELD_TYPE,
  name,
});

export const mechanismCommandField = (name = 'COMMAND') => ({
  type: MECHANISM_COMMAND_FIELD_TYPE,
  name,
});
