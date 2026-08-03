/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Blockly from 'blockly/core';
import { Order, pythonGenerator, type PythonGenerator } from 'blockly/python';
import { varTypeAnnotation, varDefaultValue } from '../variableCategory';
import { getA301Method } from '../generated/a301';
import {
  getDevice,
  getDevices,
  normalizeMovementMotorsConfig,
  parseMovementMotorsConfig,
  type MovementMotorsConfig,
} from '../devices';
import {
  getMechanism,
  getMechanisms,
  mechanismCommandNames,
  type Mechanism,
} from '../mechanisms';
import { getRobotMode } from '../robotMode';
import { snakeCase } from '../pythonNaming';
import {
  getExtensionInstances,
  type ExtensionInstance,
} from '../extensionInstances';

// Export all the code generators for our custom blocks,
// but don't register them with Blockly yet.
// This file has no side effects!
export const forBlock = Object.create(null);

type GeneratorDefinitions = { definitions_: Record<string, string> };

let generatedMechanismImports = new Set<string>();

export const getGeneratedMechanismImports = () => [
  ...generatedMechanismImports,
];

export const registerPythonImport = (
  generator: PythonGenerator,
  moduleName: string,
) => {
  (generator as unknown as GeneratorDefinitions).definitions_[
    `import_${moduleName}`
  ] = `import ${moduleName}`;
};

const pythonKeywords = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

export const safePythonIdentifier = (
  value: string | null,
  fallback: string,
) => {
  const cleaned = (value || fallback)
    .trim()
    .replace(/\W+/g, '_')
    .replace(/^_+|_+$/g, '');
  const identifier = cleaned || fallback;
  const withValidStart = /^\d/.test(identifier)
    ? `motor_${identifier}`
    : identifier;
  return pythonKeywords.has(withValidStart)
    ? `${withValidStart}_value`
    : withValidStart;
};

const deviceNameForField = (
  block: Blockly.Block,
  fieldName: string,
  fallback: string,
) => {
  const deviceId = block.getFieldValue(fieldName);
  return getDevice(deviceId)?.name || fallback;
};

const deviceName = (block: Blockly.Block, _generator: PythonGenerator) =>
  deviceNameForField(block, 'DEVICE', 'drive_motor');

const deviceReference = (block: Blockly.Block, generator: PythonGenerator) =>
  `self.${safePythonIdentifier(deviceName(block, generator), 'drive_motor')}`;

const valueToCode = (
  block: Blockly.Block,
  generator: PythonGenerator,
  inputName: string,
  fallback: string,
) => generator.valueToCode(block, inputName, Order.NONE) || fallback;

// Blockly indents every statement input once. Remove that shared first level
// before inserting setup code into __init__, but retain deeper indentation for
// nested Python control flow such as sc_if.
const normalizeStatementIndentation = (code: string) => {
  const lines = code.split('\n');
  const firstContentLine = lines.find((line) => line.trim());
  if (!firstContentLine) return '';
  const baseIndent = firstContentLine.match(/^\s*/)?.[0].length ?? 0;
  return lines
    .map((line) => (line.trim() ? line.slice(baseIndent) : ''))
    .join('\n')
    .replace(/\s+$/, '');
};

const indentCode = (code: string, spaces: number) => {
  const indent = ' '.repeat(spaces);
  return code
    .split('\n')
    .map((line) => (line ? `${indent}${line}` : ''))
    .join('\n');
};

// Powers are percentages everywhere a student can see them, so the -1..1 values
// the hardware wants are converted at the boundary.
const percentToThrottle = (power: string) =>
  `max(-1, min(1, (${power}) / 100.0))`;

// The other half of that boundary: WPILib reports axes and triggers in -1..1, so
// gamepad readings are scaled up to match the percentages every power block, and
// every number a student types, is written in.
const throttleToPercent = (reading: string) => `${reading} * 100`;

const clampThrottle = (throttle: string) => `max(-1, min(1, ${throttle}))`;

// --- Block-method extraction ------------------------------------------------
// Each command's action becomes a named method (def block_N) on the opmode
// class, and the command references that method by name instead of inlining a
// lambda — matching the hand-written opmode style. The registry is reset at the
// start of every generateOpmodeClass() call.
let blockMethodBodies: string[] = [];
const blockMethodNameCounts = new Map<string, number>();
let generatingSubsystemCommand = false;

const resetBlockMethods = () => {
  blockMethodBodies = [];
  blockMethodNameCounts.clear();
};

const registerBlockMethod = (statement: string, baseName = 'block'): string => {
  let cleanBaseName =
    baseName
      .replace(/^self\./, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase() || 'block';
  if (!cleanBaseName.startsWith('block_')) {
    cleanBaseName = `block_${cleanBaseName}`;
  }

  const count = (blockMethodNameCounts.get(cleanBaseName) || 0) + 1;
  blockMethodNameCounts.set(cleanBaseName, count);

  const name = count > 1 ? `${cleanBaseName}_${count}` : cleanBaseName;

  blockMethodBodies.push(
    `    @no_requirements()\n    async def ${name}(self):\n${indentCode(statement.trim() ? statement : 'pass\n', 8)}`,
  );
  return `self.${name}`;
};

// An InstantCommand whose action is hoisted into a block_N method.
export const instantCommandExpr = (
  pythonCall: string,
  requirement?: string,
) => {
  // Subsystem command methods are already methods on their SubsystemBase.
  // Keep their actions inline so they call the subsystem's owned motors and
  // reserve that subsystem instead of emitting OpMode-only block_N methods.
  if (generatingSubsystemCommand) {
    return `_run_instant(lambda: ${pythonCall}, ${requirement || 'self'})`;
  }
  return registerBlockMethod(pythonCall + '\n');
};

const methodCall = (block: Blockly.Block, generator: PythonGenerator) => {
  const method = getA301Method(block.getFieldValue('METHOD'));
  const args = (block.getFieldValue('ARGS') || '').trim();
  return `${deviceReference(block, generator)}.${method.name}(${args})`;
};

const commandLinesForNext = (
  block: Blockly.Block,
  generator: PythonGenerator,
  baseName = 'block',
) => {
  const next = block.getNextBlock();
  if (!next) return [];
  const code = generator.blockToCode(next);
  const codeStr = Array.isArray(code) ? code[0] : code;
  const method = registerBlockMethod(
    (codeStr || '').trim() ? codeStr : 'pass\n',
    baseName,
  );
  return [method];
};

const commandGroupExpression = (commands: string[]) =>
  commands.length ? commands[0] : `no_requirements("empty")(lambda: None)`;

const pythonIfStatement = (
  block: Blockly.Block,
  generator: PythonGenerator,
) => {
  let code = '';
  let index = 0;
  while (block.getInput(`IF${index}`)) {
    const condition = valueToCode(block, generator, `IF${index}`, 'False');
    const branch =
      generator.statementToCode(block, `DO${index}`) ||
      `${generator.INDENT}pass\n`;
    code += `${index ? 'elif' : 'if'} ${condition}:\n${branch}`;
    index += 1;
  }

  if (block.getInput('ELSE')) {
    const branch =
      generator.statementToCode(block, 'ELSE') || `${generator.INDENT}pass\n`;
    code += `else:\n${branch}`;
  }

  return code;
};

const mainCommandExpression = (commands: string[]) => {
  if (!commands.length) {
    return `no_requirements("main")(lambda: None)`;
  }
  return commands[0];
};

const startCommandExpression = (commandStacks: string[][]) => {
  if (!commandStacks.length) return `no_requirements("start")(lambda: None)`;
  if (commandStacks.length === 1)
    return mainCommandExpression(commandStacks[0]);

  const inner = commandStacks
    .map((commands) => `            ${commandGroupExpression(commands)}`)
    .join(',\n');
  return `Command.parallel(\n${inner}\n        ).with_automatic_name()`;
};

const pascalCaseIdentifier = (value: string | null, fallback: string) => {
  const words = (value || '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  const identifier = words.join('');
  const safe = /^[A-Za-z_]/.test(identifier) ? identifier : `Op${identifier}`;
  return safe || fallback;
};

const mechanismPythonNames = () => {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const mechanism of getMechanisms()) {
    const base = safePythonIdentifier(mechanism.name, 'mechanism');
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name);
    names.set(mechanism.id, name);
  }
  return names;
};

const mechanismClassName = (name: string) =>
  `${pascalCaseIdentifier(name, 'Mechanism')}Subsystem`;

const subsystemCommandMethodName = (name: string) =>
  `command_${safePythonIdentifier(name, 'command')}`;

const mechanismDevices = (mechanism: Mechanism) =>
  mechanism.motorIds
    .map((id) => getDevice(id))
    .filter((device): device is NonNullable<typeof device> => Boolean(device));

const extensionInstancePythonNames = () => {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const instance of getExtensionInstances()) {
    const base = safePythonIdentifier(instance.name, 'object');
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name);
    names.set(instance.id, name);
  }
  return names;
};

const extensionInstanceClassExpression = (instance: ExtensionInstance) =>
  instance.className;

export const extensionInstancePythonName = (instance: ExtensionInstance) =>
  extensionInstancePythonNames().get(instance.id) ||
  safePythonIdentifier(instance.name, 'object');

export const extensionInstanceReference = (instance: ExtensionInstance) =>
  `self.${extensionInstancePythonName(instance)}`;

type MechanismResources = {
  sensors: SensorInitializer[];
  extensions: ExtensionInstance[];
};

type MechanismResourceBinding = {
  parameter: string;
  target: string;
};

const mechanismResources = (mechanism: Mechanism): MechanismResources => {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(mechanism.state, workspace);
    const extensionIds = new Set<string>();
    for (const type of ['sc_ext_instance_call', 'sc_ext_instance_value']) {
      for (const block of workspace.getBlocksByType(type, false)) {
        const instanceId = block.getFieldValue('INSTANCE');
        if (instanceId) extensionIds.add(instanceId);
      }
    }
    // Keep pre-instance projects working when an older mechanism used the
    // free-text extension block with a straightforward `self.object` target.
    // New blocks use stable INSTANCE ids; this is only a narrow compatibility
    // fallback and does not reintroduce the old block surface to the toolbox.
    for (const type of ['sc_ext_call', 'sc_ext_value']) {
      for (const block of workspace.getBlocksByType(type, false)) {
        const target = String(block.getFieldValue('TARGET') || '').trim();
        const name = target.startsWith('self.') ? target.slice(5) : '';
        const instance = getExtensionInstances().find(
          (candidate) => candidate.name === name,
        );
        if (instance) extensionIds.add(instance.id);
      }
    }
    return {
      sensors: [...sensorInitializers(workspace).values()],
      extensions: getExtensionInstances().filter((instance) =>
        extensionIds.has(instance.id),
      ),
    };
  } catch (error) {
    console.warn(
      `Skipping invalid mechanism resources for ${mechanism.name}:`,
      error,
    );
    return { sensors: [], extensions: [] };
  } finally {
    workspace.dispose();
  }
};

const mechanismResourceBindings = (resources: MechanismResources) => {
  const bindings: MechanismResourceBinding[] = [];
  const targets = new Set<string>();
  const parameters = new Set<string>();
  const add = (target: string) => {
    if (targets.has(target)) return;
    targets.add(target);
    const base = `resource_${safePythonIdentifier(target, 'object')}`;
    let parameter = base;
    let suffix = 2;
    while (parameters.has(parameter)) parameter = `${base}_${suffix++}`;
    parameters.add(parameter);
    bindings.push({ parameter, target });
  };
  for (const sensor of resources.sensors) add(sensor.name);
  for (const instance of resources.extensions) {
    add(extensionInstancePythonName(instance));
  }
  return bindings;
};

const subsystemEventStacks = (mechanism: Mechanism) => {
  const workspace = new Blockly.Workspace();
  const commandStacks = new Map<string, string[]>();
  const startCommands: string[] = [];
  let drivetrain: DrivetrainConfig | null = null;
  let varInitLines: string[] = [];
  const previousGeneratingSubsystemCommand = generatingSubsystemCommand;
  generatingSubsystemCommand = true;
  try {
    Blockly.serialization.workspaces.load(mechanism.state, workspace);
    pythonGenerator.init(workspace);
    if (movementDriveNeeded(workspace)) {
      drivetrain = movementDrivetrainConfig(workspace);
    }
    for (const proc of workspace.getBlocksByType(
      'procedures_defnoreturn',
      false,
    )) {
      pythonGenerator.blockToCode(proc);
    }
    for (const proc of workspace.getBlocksByType(
      'procedures_defreturn',
      false,
    )) {
      pythonGenerator.blockToCode(proc);
    }
    for (const hat of workspace.getBlocksByType(
      'sc_subsystem_on_start',
      false,
    )) {
      startCommands.push(
        ...commandLinesForNext(hat, pythonGenerator, 'on_start'),
      );
    }
    for (const hat of workspace.getBlocksByType(
      'sc_subsystem_on_command',
      false,
    )) {
      const command = (hat.getFieldValue('COMMAND') || '').trim();
      if (command && !commandStacks.has(command)) {
        commandStacks.set(
          command,
          commandLinesForNext(hat, pythonGenerator, command),
        );
      }
    }
    const variables = workspace.getVariableMap().getAllVariables();
    varInitLines = variables.map((v) => {
      const varName = pythonGenerator.getVariableName(v.getId());
      const annotation = varTypeAnnotation(v.getType());
      const defaultVal = varDefaultValue(v.getType());
      if (annotation !== null) {
        return `        self.${varName}: ${annotation} = ${defaultVal}`;
      }
      return `        self.${varName} = ${defaultVal}`;
    });
    const definitions = (pythonGenerator as unknown as GeneratorDefinitions)
      .definitions_;
    for (const key of Object.keys(definitions)) {
      if (key.startsWith('import_'))
        generatedMechanismImports.add(definitions[key]);
    }
  } catch (error) {
    console.warn(
      `Skipping invalid subsystem workspace for ${mechanism.name}:`,
      error,
    );
  } finally {
    generatingSubsystemCommand = previousGeneratingSubsystemCommand;
    workspace.dispose();
  }
  return { startCommands, commandStacks, drivetrain, varInitLines };
};

/**
 * Project-level commands3 subsystem classes. Advanced mode gives every
 * subsystem its own Scratch-style event workspace; its command hats become
 * reusable Command factories on this class.
 */
export const generateMechanismDefinitions = () => {
  generatedMechanismImports = new Set<string>();
  if (getRobotMode() !== 'advanced') return '';
  const definitions: string[] = [];
  const names = mechanismPythonNames();
  for (const mechanism of getMechanisms()) {
    resetBlockMethods();
    const events = subsystemEventStacks(mechanism);
    const bindings = mechanismResourceBindings(mechanismResources(mechanism));
    const motors = mechanismDevices(mechanism);
    const motorReferences = motors.map(
      (motor) => `self.${safePythonIdentifier(motor.name, 'motor')}`,
    );

    definitions.push(
      `class ${mechanismClassName(names.get(mechanism.id) || mechanism.name)}(Mechanism):`,
      `    def __init__(self${bindings.map(({ parameter }) => `, ${parameter}`).join('')}):`,
      `        super().__init__("${mechanismClassName(names.get(mechanism.id) || mechanism.name)}")`,
      ...motors.map(
        (motor) =>
          `        self.${safePythonIdentifier(motor.name, 'motor')} = A301(${motor.deviceId}, ${motor.bus})`,
      ),
      ...bindings.map(
        ({ parameter, target }) => `        self.${target} = ${parameter}`,
      ),
      `        self._motors = [${motorReferences.join(', ')}]`,
      ...(events.drivetrain ? drivetrainInitLines(events.drivetrain) : []),
      ...events.varInitLines,
      '',
      '    def set_power(self, power):',
      '        for motor in self._motors:',
      '            motor.set_throttle(power)',
      '',
      '    def stop(self):',
      '        self.set_power(0)',
      '',
      '    def on_start(self):',
      `        return ${commandGroupExpression(events.startCommands)}`,
    );
    for (const command of mechanismCommandNames(mechanism)) {
      const commands = events.commandStacks.get(command) || [];
      definitions.push(
        '',
        `    def ${subsystemCommandMethodName(command)}(self):`,
        `        return ${commandGroupExpression(commands)}`,
      );
    }
    const blockMethodLines: string[] = [];
    blockMethodBodies.forEach((body, index) => {
      if (index > 0) blockMethodLines.push('');
      blockMethodLines.push(body);
    });
    if (blockMethodLines.length) {
      definitions.push('');
      definitions.push(...blockMethodLines);
    }
    definitions.push('');
  }
  return definitions.join('\n').replace(/\s+$/, '');
};

const OPMODE_TYPE_TO_DECORATOR: Record<string, string> = {
  Teleop: 'teleop',
  Auto: 'autonomous',
  Utility: 'utility',
};

// The opmode hats don't emit code on their own; the class is assembled from all
// of them together by generateOpmodeClass(). Register no-ops so a stray
// workspaceToCode() never throws on them.
forBlock['sc_opmode_details'] = () => '';
forBlock['sc_on_setup'] = () => '';
forBlock['sc_on_start'] = () => '';
forBlock['sc_trigger'] = () => '';
forBlock['sc_rev_color_sensor_color_trigger'] = () => '';
forBlock['sc_rev_color_sensor_proximity_trigger'] = () => '';
forBlock['sc_wpilib_digital_input_trigger'] = () => '';
forBlock['sc_wpilib_analog_input_trigger'] = () => '';
forBlock['sc_wpilib_encoder_trigger'] = () => '';
forBlock['sc_wpilib_imu_trigger'] = () => '';
forBlock['sc_movement_motors'] = () => '';
forBlock['sc_subsystem_on_start'] = () => '';
forBlock['sc_subsystem_on_command'] = () => '';

const GAMEPAD_BLOCK_TYPES = [
  'sc_gamepad_button',
  'sc_gamepad_axis',
  'sc_gamepad_trigger',
] as const;

const DIFFERENTIAL_DRIVETRAIN_BLOCK_TYPES = [
  'sc_drivetrain_arcade_drive',
  'sc_drivetrain_tank_drive',
  'sc_drivetrain_stop',
] as const;

const MECANUM_DRIVETRAIN_BLOCK_TYPES = [
  'sc_mecanum_drive',
  'sc_mecanum_stop',
] as const;

type DrivetrainKind = 'differential' | 'mecanum';

type DrivetrainConfig = {
  kind: DrivetrainKind;
  name: string;
  motorNames: string[];
};

const MOVEMENT_MOTORS_BLOCK_TYPE = 'sc_movement_motors';
const MOVEMENT_DRIVE_NAME = 'movement_drive';

const movementDriveBlockTypes = [
  ...DIFFERENTIAL_DRIVETRAIN_BLOCK_TYPES,
  ...MECANUM_DRIVETRAIN_BLOCK_TYPES,
] as const;

const movementDriveNeeded = (workspace: Blockly.Workspace) =>
  workspace.getBlocksByType(MOVEMENT_MOTORS_BLOCK_TYPE, false).length > 0 ||
  movementDriveBlockTypes.some(
    (type) => workspace.getBlocksByType(type, false).length > 0,
  );

const motorNameForDeviceId = (id: string, fallback: string) =>
  safePythonIdentifier(getDevice(id)?.name || fallback, fallback);

const movementMotorsConfigInWorkspace = (
  workspace: Blockly.Workspace,
): MovementMotorsConfig => {
  const block = workspace.getBlocksByType(MOVEMENT_MOTORS_BLOCK_TYPE, false)[0];
  return normalizeMovementMotorsConfig(
    parseMovementMotorsConfig(block?.getFieldValue('MOTORS')),
  );
};

const movementDrivetrainConfig = (
  workspace: Blockly.Workspace,
): DrivetrainConfig => {
  const config = movementMotorsConfigInWorkspace(workspace);
  if (config.kind === 'mecanum') {
    return {
      kind: 'mecanum',
      name: MOVEMENT_DRIVE_NAME,
      motorNames: [
        motorNameForDeviceId(config.frontLeftDeviceId, 'front_left_motor'),
        motorNameForDeviceId(config.rearLeftDeviceId, 'rear_left_motor'),
        motorNameForDeviceId(config.frontRightDeviceId, 'front_right_motor'),
        motorNameForDeviceId(config.rearRightDeviceId, 'rear_right_motor'),
      ],
    };
  }

  return {
    kind: 'differential',
    name: MOVEMENT_DRIVE_NAME,
    motorNames: [
      motorNameForDeviceId(config.leftDeviceId, 'left_motor'),
      motorNameForDeviceId(config.rightDeviceId, 'right_motor'),
    ],
  };
};

const drivetrainInitLines = (config: DrivetrainConfig) => {
  const motorSetter = (motorName: string) =>
    `lambda output: self.${motorName}.set_throttle(output)`;

  if (config.kind === 'differential') {
    const [leftMotor, rightMotor] = config.motorNames;
    return [
      `        self.${config.name} = wpilib.DifferentialDrive(`,
      `            ${motorSetter(leftMotor)},`,
      `            ${motorSetter(rightMotor)},`,
      '        )',
    ];
  }

  const [frontLeft, rearLeft, frontRight, rearRight] = config.motorNames;
  return [
    `        self.${config.name} = wpilib.MecanumDrive(`,
    `            ${motorSetter(frontLeft)},`,
    `            ${motorSetter(rearLeft)},`,
    `            ${motorSetter(frontRight)},`,
    `            ${motorSetter(rearRight)},`,
    '        )',
  ];
};

const movementDriveReference = () => `self.${MOVEMENT_DRIVE_NAME}`;

// Gamepad dropdown value ('1' / '2') -> Driver Station port (0 / 1).
const gamepadNumber = (block: Blockly.Block) =>
  block.getFieldValue('GAMEPAD') === '2' ? '2' : '1';

const gamepadPort = (gamepad: string) => (gamepad === '2' ? '1' : '0');

const gamepadReference = (block: Blockly.Block) =>
  `self.gamepad${gamepadNumber(block)}`;

const GAMEPAD_ANALOG_TYPES = new Set(['sc_gamepad_axis', 'sc_gamepad_trigger']);

// The bare -1..1 WPILib call behind a gamepad axis or trigger block, before the
// block's generator scales it into a percent.
const gamepadAnalogReading = (block: Blockly.Block) =>
  block.type === 'sc_gamepad_trigger'
    ? `${gamepadReference(block)}.get_${snakeCase(block.getFieldValue('SIDE'))}_trigger()`
    : `${gamepadReference(block)}.get_${snakeCase(block.getFieldValue('AXIS'))}()`;

const literalNumber = (block: Blockly.Block | null) => {
  if (!block || block.type !== 'math_number') return null;
  const value = Number(block.getFieldValue('NUM'));
  return Number.isFinite(value) ? value : null;
};

// For `x * 100` (either operand order), the code for x — whose value is already
// the throttle the socket is about to divide back down to.
const multiplicandOfHundred = (
  block: Blockly.Block,
  generator: PythonGenerator,
) => {
  if (block.type !== 'math_arithmetic') return null;
  if (block.getFieldValue('OP') !== 'MULTIPLY') return null;
  if (literalNumber(block.getInputTargetBlock('B')) === 100) {
    return valueToCode(block, generator, 'A', '0');
  }
  if (literalNumber(block.getInputTargetBlock('A')) === 100) {
    return valueToCode(block, generator, 'B', '0');
  }
  return null;
};

/**
 * Builds the throttle argument for a power socket: percent in, -1..1 out.
 *
 * Two shapes cancel that division exactly, and this code runs on every loop
 * iteration, so they are recognised at generation time instead of being emitted
 * as `x * 100 / 100.0` for CPython to redo forever:
 *
 *   - a gamepad axis or trigger, whose generator scales -1..1 up by 100
 *   - any hand-built `x * 100`
 *
 * The clamp stays in both cases: it is what keeps a surprising value from
 * reaching the motor.
 */
const powerToThrottle = (
  block: Blockly.Block,
  generator: PythonGenerator,
  inputName: string,
  fallback = '0',
) => {
  const source = block.getInputTargetBlock(inputName);
  if (source && GAMEPAD_ANALOG_TYPES.has(source.type)) {
    return clampThrottle(gamepadAnalogReading(source));
  }
  const unscaled = source && multiplicandOfHundred(source, generator);
  if (unscaled) return clampThrottle(unscaled);
  return percentToThrottle(valueToCode(block, generator, inputName, fallback));
};

// post4 also renamed the compass-point face buttons to directions:
// getSouthFaceButton() -> get_face_down_button(). Saved projects still store the
// old stems as BUTTON field values, so translate here instead of migrating.
const GAMEPAD_FACE_BUTTONS: Record<string, string> = {
  EastFace: 'face_right',
  NorthFace: 'face_up',
  SouthFace: 'face_down',
  WestFace: 'face_left',
};

const gamepadButtonStem = (button: string) =>
  GAMEPAD_FACE_BUTTONS[button] || snakeCase(button);

const gamepadsInWorkspace = (workspace: Blockly.Workspace) => {
  const gamepads = new Set<string>();
  for (const type of GAMEPAD_BLOCK_TYPES) {
    for (const block of workspace.getBlocksByType(type, false)) {
      gamepads.add(gamepadNumber(block));
    }
  }
  return [...gamepads].sort();
};

const intField = (
  block: Blockly.Block,
  fieldName: string,
  fallback: number,
) => {
  const value = Number(block.getFieldValue(fieldName));
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
};

const sensorObjectName = (prefix: string, ...channels: number[]) =>
  `${prefix}_${channels.join('_')}`;

const sensorReference = (prefix: string, ...channels: number[]) =>
  `self.${sensorObjectName(prefix, ...channels)}`;

const digitalInputReference = (block: Blockly.Block) =>
  sensorReference('digital_input', intField(block, 'CHANNEL', 0));

const analogInputReference = (block: Blockly.Block) =>
  sensorReference('analog_input', intField(block, 'CHANNEL', 0));

// wpilib.AnalogInput getter for the block's READING field. Shared by the value
// read block and the analog-input trigger.
const analogInputMethod = (block: Blockly.Block) =>
  block.getFieldValue('READING') === 'VALUE' ? 'get_value' : 'get_voltage';

const encoderChannels = (block: Blockly.Block) =>
  [intField(block, 'A_CHANNEL', 0), intField(block, 'B_CHANNEL', 1)] as const;

const encoderReference = (block: Blockly.Block) =>
  sensorReference('encoder', ...encoderChannels(block));

// wpilib.Encoder getter for the block's READING field. Shared by the value read
// block and the encoder trigger.
const encoderMethod = (block: Blockly.Block) => {
  const reading = block.getFieldValue('READING');
  return reading === 'RATE'
    ? 'get_rate'
    : reading === 'COUNT'
      ? 'get'
      : 'get_distance';
};

const dutyCycleEncoderReference = (block: Blockly.Block) =>
  sensorReference('duty_cycle_encoder', intField(block, 'CHANNEL', 0));

const analogEncoderReference = (block: Blockly.Block) =>
  sensorReference('analog_encoder', intField(block, 'CHANNEL', 0));

const analogAccelerometerReference = (block: Blockly.Block) =>
  sensorReference('analog_accelerometer', intField(block, 'CHANNEL', 0));

const analogPotentiometerReference = (block: Blockly.Block) =>
  sensorReference('analog_potentiometer', intField(block, 'CHANNEL', 0));

// The SystemCore onboard IMU is a singleton; every IMU block shares self.imu.
const IMU_REFERENCE = 'self.imu';

// WPILib reports IMU angles in radians; students expect degrees. Shared by the
// value read block and the heading trigger.
const imuHeadingDegrees = (generator: PythonGenerator) => {
  registerPythonImport(generator, 'math');
  return `math.degrees(${IMU_REFERENCE}.get_yaw())`;
};

const digitalOutputReference = (block: Blockly.Block) =>
  sensorReference('digital_output', intField(block, 'CHANNEL', 0));

// A Python string literal for a user-entered SmartDashboard key.
const pythonStringLiteral = (value: string | null) =>
  `"${(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const i2cPortKey = (block: Blockly.Block) =>
  block.getFieldValue('PORT') === 'MXP' ? 'mxp' : 'onboard';

const i2cPortExpression = (block: Blockly.Block) =>
  block.getFieldValue('PORT') === 'MXP'
    ? 'wpilib.I2C.Port.PORT_1'
    : 'wpilib.I2C.Port.PORT_0';

const revColorSensorReference = (block: Blockly.Block) =>
  `self.rev_color_sensor_${i2cPortKey(block)}`;

const hexColorToRgb = (value: string | null) => {
  const named: Record<string, string> = {
    BLUE: '#0000ff',
    GREEN: '#00ff00',
    RED: '#ff0000',
  };
  const color = (value && named[value] ? named[value] : value || '#ff0000')
    .trim()
    .toLowerCase();
  const short = /^#?([0-9a-f]{3})$/.exec(color);
  const match = /^#?([0-9a-f]{6})$/.exec(color);
  const hex = short
    ? short[1]
        .split('')
        .map((char) => `${char}${char}`)
        .join('')
    : match
      ? match[1]
      : 'ff0000';
  return {
    red: parseInt(hex.slice(0, 2), 16) / 255,
    green: parseInt(hex.slice(2, 4), 16) / 255,
    blue: parseInt(hex.slice(4, 6), 16) / 255,
  };
};

const revColorSensorSeesColorExpression = (block: Blockly.Block) => {
  const sensor = revColorSensorReference(block);
  const target = hexColorToRgb(block.getFieldValue('COLOR'));
  const tolerance = '0.25';
  return [
    `abs(${sensor}.get_color().red - ${target.red}) <= ${tolerance}`,
    `abs(${sensor}.get_color().green - ${target.green}) <= ${tolerance}`,
    `abs(${sensor}.get_color().blue - ${target.blue}) <= ${tolerance}`,
  ].join(' and ');
};

type SensorInitializer = {
  name: string;
  expression: string;
};

const sensorInitializers = (workspace: Blockly.Workspace) => {
  const initializers = new Map<string, SensorInitializer>();
  const add = (name: string, expression: string) => {
    if (!initializers.has(name)) {
      initializers.set(name, { name, expression });
    }
  };

  for (const type of [
    'sc_wpilib_digital_input',
    'sc_wpilib_digital_input_trigger',
  ]) {
    for (const block of workspace.getBlocksByType(type, false)) {
      const channel = intField(block, 'CHANNEL', 0);
      add(
        sensorObjectName('digital_input', channel),
        `wpilib.DigitalInput(${channel})`,
      );
    }
  }
  for (const type of [
    'sc_wpilib_analog_input_value',
    'sc_wpilib_analog_input_trigger',
  ]) {
    for (const block of workspace.getBlocksByType(type, false)) {
      const channel = intField(block, 'CHANNEL', 0);
      add(
        sensorObjectName('analog_input', channel),
        `wpilib.AnalogInput(${channel})`,
      );
    }
  }
  for (const type of [
    'sc_wpilib_encoder_value',
    'sc_wpilib_encoder_reset',
    'sc_wpilib_encoder_trigger',
  ]) {
    for (const block of workspace.getBlocksByType(type, false)) {
      const [aChannel, bChannel] = encoderChannels(block);
      add(
        sensorObjectName('encoder', aChannel, bChannel),
        `wpilib.Encoder(${aChannel}, ${bChannel})`,
      );
    }
  }
  for (const type of [
    'sc_wpilib_duty_cycle_encoder_value',
    'sc_wpilib_duty_cycle_encoder_connected',
  ]) {
    for (const block of workspace.getBlocksByType(type, false)) {
      const channel = intField(block, 'CHANNEL', 0);
      add(
        sensorObjectName('duty_cycle_encoder', channel),
        `wpilib.DutyCycleEncoder(${channel})`,
      );
    }
  }
  for (const block of workspace.getBlocksByType(
    'sc_wpilib_analog_encoder_value',
    false,
  )) {
    const channel = intField(block, 'CHANNEL', 0);
    add(
      sensorObjectName('analog_encoder', channel),
      `wpilib.AnalogEncoder(${channel})`,
    );
  }
  for (const block of workspace.getBlocksByType(
    'sc_wpilib_analog_accelerometer_value',
    false,
  )) {
    const channel = intField(block, 'CHANNEL', 0);
    add(
      sensorObjectName('analog_accelerometer', channel),
      `wpilib.AnalogAccelerometer(${channel})`,
    );
  }
  for (const block of workspace.getBlocksByType(
    'sc_wpilib_analog_potentiometer_value',
    false,
  )) {
    const channel = intField(block, 'CHANNEL', 0);
    add(
      sensorObjectName('analog_potentiometer', channel),
      `wpilib.AnalogPotentiometer(${channel})`,
    );
  }
  // The onboard IMU is a singleton — one object no matter how many blocks use it.
  for (const type of [
    'sc_wpilib_imu_value',
    'sc_wpilib_imu_reset',
    'sc_wpilib_imu_trigger',
  ]) {
    if (workspace.getBlocksByType(type, false).length) {
      add('imu', 'wpilib.OnboardIMU(wpilib.OnboardIMU.MountOrientation.FLAT)');
    }
  }
  for (const block of workspace.getBlocksByType(
    'sc_wpilib_digital_output_set',
    false,
  )) {
    const channel = intField(block, 'CHANNEL', 0);
    add(
      sensorObjectName('digital_output', channel),
      `wpilib.DigitalOutput(${channel})`,
    );
  }
  for (const type of [
    'sc_rev_color_sensor_value',
    'sc_rev_color_sensor_status',
    'sc_rev_color_sensor_color_trigger',
    'sc_rev_color_sensor_sees_color',
    'sc_rev_color_sensor_proximity_trigger',
  ]) {
    for (const block of workspace.getBlocksByType(type, false)) {
      const key = i2cPortKey(block);
      add(
        `rev_color_sensor_${key}`,
        `rev.ColorSensorV3(${i2cPortExpression(block)})`,
      );
    }
  }

  return initializers;
};

const sensorInitLines = (
  workspace: Blockly.Workspace,
  generator: PythonGenerator,
  extraInitializers: Iterable<SensorInitializer> = [],
) => {
  const initializers = sensorInitializers(workspace);
  for (const initializer of extraInitializers) {
    if (!initializers.has(initializer.name)) {
      initializers.set(initializer.name, initializer);
    }
  }
  if (
    [...initializers.values()].some(({ expression }) =>
      expression.startsWith('rev.'),
    )
  ) {
    registerPythonImport(generator, 'rev');
  }
  return [...initializers.values()].map(
    ({ name, expression }) => `        self.${name} = ${expression}`,
  );
};

const buildTriggerLines = (
  triggers: Blockly.Block[],
  generator: PythonGenerator,
) => {
  if (!triggers.length) return [];
  const lines: string[] = [];
  triggers.forEach((trigger, index) => {
    const condition = triggerConditionExpression(trigger, generator);
    const mode =
      trigger.getFieldValue('MODE') === 'whileTrue' ? 'while_true' : 'on_true';
    const commands = commandLinesForNext(trigger, generator, condition);
    const name = `trigger_${index + 1}`;
    lines.push(
      `        ${name} = Trigger(lambda: ${condition})`,
      `        ${name}.${mode}(${commandGroupExpression(commands)})`,
    );
    if (index < triggers.length - 1) lines.push('');
  });
  return lines;
};

const triggerBlocksInWorkspace = (workspace: Blockly.Workspace) => [
  ...workspace.getBlocksByType('sc_trigger', false),
  ...workspace.getBlocksByType('sc_rev_color_sensor_color_trigger', false),
  ...workspace.getBlocksByType('sc_rev_color_sensor_proximity_trigger', false),
  ...workspace.getBlocksByType('sc_wpilib_digital_input_trigger', false),
  ...workspace.getBlocksByType('sc_wpilib_analog_input_trigger', false),
  ...workspace.getBlocksByType('sc_wpilib_encoder_trigger', false),
  ...workspace.getBlocksByType('sc_wpilib_imu_trigger', false),
];

const triggerConditionExpression = (
  trigger: Blockly.Block,
  generator: PythonGenerator,
) => {
  if (trigger.type === 'sc_rev_color_sensor_color_trigger') {
    return revColorSensorSeesColorExpression(trigger);
  }
  if (trigger.type === 'sc_rev_color_sensor_proximity_trigger') {
    const threshold = valueToCode(trigger, generator, 'THRESHOLD', '200');
    return `${revColorSensorReference(trigger)}.get_proximity() >= (${threshold})`;
  }
  if (trigger.type === 'sc_wpilib_digital_input_trigger') {
    return `${digitalInputReference(trigger)}.get()`;
  }
  if (trigger.type === 'sc_wpilib_analog_input_trigger') {
    const threshold = valueToCode(trigger, generator, 'THRESHOLD', '0');
    return `${analogInputReference(trigger)}.${analogInputMethod(trigger)}() >= (${threshold})`;
  }
  if (trigger.type === 'sc_wpilib_encoder_trigger') {
    const threshold = valueToCode(trigger, generator, 'THRESHOLD', '0');
    return `${encoderReference(trigger)}.${encoderMethod(trigger)}() >= (${threshold})`;
  }
  if (trigger.type === 'sc_wpilib_imu_trigger') {
    const threshold = valueToCode(trigger, generator, 'THRESHOLD', '0');
    return `${imuHeadingDegrees(generator)} >= (${threshold})`;
  }
  return valueToCode(trigger, generator, 'CONDITION', 'False');
};

/**
 * Assembles a single OpMode Python class from all of the opmode-scoped hat
 * blocks in the given workspace: the details hat (config + decorators), any
 * setup hats, any "on start" hats, and any trigger hats. Imports are emitted
 * once by the caller (see src/opmodes.ts).
 */
export const generateOpmodeClass = (
  workspace: Blockly.Workspace,
  generator: PythonGenerator,
): string => {
  resetBlockMethods();
  for (const proc of workspace.getBlocksByType(
    'procedures_defnoreturn',
    false,
  )) {
    generator.blockToCode(proc);
  }
  for (const proc of workspace.getBlocksByType('procedures_defreturn', false)) {
    generator.blockToCode(proc);
  }
  const details = workspace.getBlocksByType('sc_opmode_details', false)[0];
  const type = details?.getFieldValue('TYPE') || 'Teleop';
  const enabled = details ? details.getFieldValue('ENABLED') === 'TRUE' : true;
  const name = (details?.getFieldValue('NAME') || '').trim();
  const description = (details?.getFieldValue('DESCRIPTION') || '').trim();
  const className = pascalCaseIdentifier(name, 'MyOpMode');

  const setupSections: string[] = [];
  for (const hat of workspace.getBlocksByType('sc_on_setup', false)) {
    const setupCode = normalizeStatementIndentation(
      hat.getNextBlock()
        ? (generator.blockToCode(hat.getNextBlock()) as string)
        : '',
    );
    if (setupCode) setupSections.push(setupCode);
  }
  const setupCode = setupSections.join('\n');

  const triggerLines = buildTriggerLines(
    triggerBlocksInWorkspace(workspace),
    generator,
  );

  const startCommandStacks: string[][] = [];
  for (const hat of workspace.getBlocksByType('sc_on_start', false)) {
    startCommandStacks.push(commandLinesForNext(hat, generator, 'on_start'));
  }

  const decorators: string[] = [];
  if (enabled) {
    decorators.push(`@${OPMODE_TYPE_TO_DECORATOR[type] || 'teleop'}`);
  }

  const advancedMechanisms =
    getRobotMode() === 'advanced' ? [...getMechanisms()] : [];
  const advancedMechanismResources = new Map<string, MechanismResources>();
  for (const mechanism of advancedMechanisms) {
    advancedMechanismResources.set(mechanism.id, mechanismResources(mechanism));
  }
  const mechanismBindings = new Map<string, MechanismResourceBinding[]>(
    advancedMechanisms.map((mechanism) => [
      mechanism.id,
      mechanismResourceBindings(
        advancedMechanismResources.get(mechanism.id) || {
          sensors: [],
          extensions: [],
        },
      ),
    ]),
  );
  const mechanismSensorInitializers: SensorInitializer[] = [];
  for (const mechanism of advancedMechanisms) {
    mechanismSensorInitializers.push(
      ...(advancedMechanismResources.get(mechanism.id)?.sensors || []),
    );
  }

  const initBody: string[] = ['        super().__init__()'];
  initBody.push('');
  for (const gamepad of gamepadsInWorkspace(workspace)) {
    initBody.push(
      `        self.gamepad${gamepad} = wpilib.Gamepad(${gamepadPort(gamepad)})`,
    );
  }
  initBody.push(
    ...sensorInitLines(workspace, generator, mechanismSensorInitializers),
  );
  // Simple mode exposes motors directly to OpMode blocks. Advanced mode moves
  // construction into the owning subsystem class instead.
  if (getRobotMode() === 'simple') {
    for (const device of getDevices()) {
      const motor = safePythonIdentifier(device.name, 'drive_motor');
      initBody.push(
        `        self.${motor} = A301(${device.deviceId}, ${device.bus})`,
      );
    }
  }
  const extensionInstanceNames = extensionInstancePythonNames();
  for (const instance of getExtensionInstances()) {
    const name = extensionInstanceNames.get(instance.id) || 'object';
    const rootModule = instance.className.split('.')[0];
    if (rootModule) registerPythonImport(generator, rootModule);
    initBody.push(
      `        self.${name} = ${extensionInstanceClassExpression(instance)}(${instance.args})`,
    );
  }
  if (advancedMechanisms.length) {
    const mechanismNames = mechanismPythonNames();
    for (const mechanism of advancedMechanisms) {
      try {
        const name = mechanismNames.get(mechanism.id) || 'mechanism';
        const bindings = mechanismBindings.get(mechanism.id) || [];
        initBody.push(
          `        self.${name} = ${mechanismClassName(name)}(${bindings.map(({ target }) => `self.${target}`).join(', ')})`,
        );
        // Each subsystem's "when this subsystem starts" event runs beside the
        // OpMode's own start hats, just like separate Scratch event scripts.
        startCommandStacks.push([`self.${name}.on_start()`]);
      } catch (e) {
        throw new Error(
          `Crash generating subsystem instantiation for ${mechanism?.id}: ` +
            (e as Error).message,
        );
      }
    }
  }
  if (movementDriveNeeded(workspace)) {
    initBody.push(...drivetrainInitLines(movementDrivetrainConfig(workspace)));
  }

  const variables = workspace.getVariableMap().getAllVariables();
  if (variables.length) {
    initBody.push('');
    for (const variable of variables) {
      try {
        const varName = generator.getVariableName(variable.getId());
        const annotation = varTypeAnnotation(variable.getType());
        const defaultVal = varDefaultValue(variable.getType());
        if (annotation !== null) {
          initBody.push(
            `        self.${varName}: ${annotation} = ${defaultVal}`,
          );
        } else {
          initBody.push(`        self.${varName} = ${defaultVal}`);
        }
      } catch (e) {
        throw new Error(
          `Crash generating variable init for ${variable?.getName()}: ` +
            (e as Error).message,
        );
      }
    }
  }

  if (setupCode) initBody.push(indentCode(setupCode, 8));
  initBody.push('        self.main_command: Command | None = None');

  const startBody: string[] = [];
  if (triggerLines.length) startBody.push(...triggerLines, '');
  startBody.push(
    '        self.main_command = ' + startCommandExpression(startCommandStacks),
  );
  startBody.push('        self.main_command.schedule()');
  const blockMethodLines: string[] = [];
  blockMethodBodies.forEach((body, index) => {
    if (index > 0) blockMethodLines.push('');
    blockMethodLines.push(body);
  });

  const lines = [
    ...(description ? [`# ${description}`] : []),
    ...decorators,
    `class ${className}(wpilib.PeriodicOpMode):`,
    '    def __init__(self):',
    ...initBody,
    '',
    ...blockMethodLines,
    ...(blockMethodLines.length ? [''] : []),
    '    def start(self):',
    ...startBody,
    '',
    '    def periodic(self):',
    '        Scheduler.get_default().run()',
    '',
    '    def end(self):',
    '        if self.main_command:',
    '            self.main_command.cancel()',
    '            self.main_command = None',
  ];

  return lines.join('\n');
};

forBlock['sc_motor_set_power'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const throttle = powerToThrottle(block, generator, 'POWER');
  return `${deviceReference(block, generator)}.set_throttle(${throttle})\n`;
};

forBlock['sc_motor_run_for_seconds'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const motor = deviceReference(block, generator);
  const throttle = powerToThrottle(block, generator, 'POWER', '50');
  const seconds = valueToCode(block, generator, 'SECONDS', '1');
  return `${motor}.set_throttle(${throttle})\nawait wait(${seconds})\n${motor}.set_throttle(0)\n`;
};

forBlock['sc_motor_stop'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  return `${deviceReference(block, generator)}.set_throttle(0)\n`;
};

forBlock['sc_motor_set_velocity'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const velocity = valueToCode(block, generator, 'VELOCITY', '0');
  return `${deviceReference(block, generator)}.set_velocity(${velocity})\n`;
};

forBlock['sc_motor_set_position'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const position = valueToCode(block, generator, 'POSITION', '0');
  return `${deviceReference(block, generator)}.set_position(${position})\n`;
};

// The sc_motor_group* blocks were retired: migrateSerializedBlock() in
// opmodes.ts rewrites saved ones into per-motor commands, so no generator is
// needed (and none of them are in the toolbox any more).

forBlock['sc_mechanism_set_power'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const mechanism = getMechanism(block.getFieldValue('MECHANISM'));
  if (!mechanism) return '';
  const name = mechanismPythonNames().get(mechanism.id) || 'mechanism';
  const throttle = powerToThrottle(block, generator, 'POWER');
  return `self.${name}.set_power(${throttle})\n`;
};

forBlock['sc_mechanism_stop'] = function (block: Blockly.Block) {
  const mechanism = getMechanism(block.getFieldValue('MECHANISM'));
  if (!mechanism) return '';
  const name = mechanismPythonNames().get(mechanism.id) || 'mechanism';
  return `self.${name}.stop()\n`;
};

forBlock['sc_mechanism_run_command'] = function (block: Blockly.Block) {
  const mechanism = getMechanism(block.getFieldValue('MECHANISM'));
  const command = (block.getFieldValue('COMMAND') || '').trim();
  if (!mechanism || !command) return '';
  const name = mechanismPythonNames().get(mechanism.id) || 'mechanism';
  return `await self.${name}.${subsystemCommandMethodName(command)}()\n`;
};

forBlock['sc_drivetrain_arcade_drive'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const forward = powerToThrottle(block, generator, 'FORWARD');
  const turn = powerToThrottle(block, generator, 'TURN');
  return `${movementDriveReference()}.arcade_drive(${forward}, ${turn})\n`;
};

forBlock['sc_drivetrain_tank_drive'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const leftPower = powerToThrottle(block, generator, 'LEFT_POWER');
  const rightPower = powerToThrottle(block, generator, 'RIGHT_POWER');
  return `${movementDriveReference()}.tank_drive(${leftPower}, ${rightPower})\n`;
};

forBlock['sc_drivetrain_stop'] = function () {
  return `${movementDriveReference()}.stop_motor()\n`;
};

forBlock['sc_mecanum_drive'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const sideways = powerToThrottle(block, generator, 'SIDEWAYS');
  const forward = powerToThrottle(block, generator, 'FORWARD');
  const turn = powerToThrottle(block, generator, 'TURN');
  return `${movementDriveReference()}.drive_cartesian(${sideways}, ${forward}, ${turn})\n`;
};

forBlock['sc_mecanum_stop'] = function () {
  return `${movementDriveReference()}.stop_motor()\n`;
};

forBlock['sc_wait_seconds'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const seconds = valueToCode(block, generator, 'SECONDS', '1');
  return `await wait(${seconds})\n`;
};

forBlock['sc_repeat_commands'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const times = valueToCode(block, generator, 'TIMES', '2');
  const innerCommands = generator.statementToCode(block, 'COMMANDS');
  return `for _ in range(int(${times})):\n${innerCommands}${generator.INDENT}await yield_()\n`;
};

forBlock['sc_while_commands'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const condition = valueToCode(block, generator, 'CONDITION', 'True');
  const innerCommands = generator.statementToCode(block, 'COMMANDS');
  return `while ${condition}:\n${innerCommands}${generator.INDENT}await yield_()\n`;
};

forBlock['sc_parallel_commands'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const firstCommands =
    generator.statementToCode(block, 'FIRST') || `${generator.INDENT}pass\n`;
  const secondCommands =
    generator.statementToCode(block, 'SECOND') || `${generator.INDENT}pass\n`;
  const id = block.id.replace(/[^a-zA-Z0-9]/g, '');
  return `@no_requirements("parallel_0")\nasync def _parallel_${id}_0():\n${firstCommands}@no_requirements("parallel_1")\nasync def _parallel_${id}_1():\n${secondCommands}await Command.parallel(_parallel_${id}_0, _parallel_${id}_1).with_automatic_name()\n`;
};

forBlock['sc_race_commands'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const firstCommands =
    generator.statementToCode(block, 'FIRST') || `${generator.INDENT}pass\n`;
  const secondCommands =
    generator.statementToCode(block, 'SECOND') || `${generator.INDENT}pass\n`;
  const id = block.id.replace(/[^a-zA-Z0-9]/g, '');
  return `@no_requirements("race_0")\nasync def _race_${id}_0():\n${firstCommands}@no_requirements("race_1")\nasync def _race_${id}_1():\n${secondCommands}await Command.race(_race_${id}_0, _race_${id}_1).with_automatic_name()\n`;
};

forBlock['sc_deadline_commands'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const firstCommands =
    generator.statementToCode(block, 'DEADLINE') || `${generator.INDENT}pass\n`;
  const secondCommands =
    generator.statementToCode(block, 'OTHER') || `${generator.INDENT}pass\n`;
  const id = block.id.replace(/[^a-zA-Z0-9]/g, '');
  return `@no_requirements("deadline_0")\nasync def _deadline_${id}_0():\n${firstCommands}@no_requirements("deadline_1")\nasync def _deadline_${id}_1():\n${secondCommands}await Command.deadline(_deadline_${id}_0, _deadline_${id}_1).with_automatic_name()\n`;
};

forBlock['sc_wait_until'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const condition = valueToCode(block, generator, 'CONDITION', 'False');
  return `await wait_until(lambda: ${condition})\n`;
};

forBlock['sc_if'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  return pythonIfStatement(block, generator);
};

forBlock['sc_a301_sensor_value'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const motor = deviceReference(block, generator);
  const sensor = block.getFieldValue('SENSOR');
  const expressions: Record<string, string> = {
    ABSOLUTE_POSITION: `${motor}.get_absolute_encoder_position().get()`,
    BUS_VOLTAGE: `${motor}.get_bus_voltage().get()`,
    CURRENT: `${motor}.get_motor_current().get()`,
    POSITION: `${motor}.get_relative_encoder_position().get()`,
    POWER: `(${motor}.get_throttle() * 100)`,
    TEMPERATURE: `${motor}.get_motor_temperature().get()`,
    VELOCITY: `${motor}.get_encoder_velocity().get()`,
  };

  return [expressions[sensor] || expressions.VELOCITY, Order.FUNCTION_CALL];
};

forBlock['sc_operator_is_within'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const value = valueToCode(block, generator, 'VALUE', '0');
  const tolerance = valueToCode(block, generator, 'TOLERANCE', '0');
  const target = valueToCode(block, generator, 'TARGET', '0');
  return [
    `abs((${value}) - (${target})) <= abs(${tolerance})`,
    Order.RELATIONAL,
  ];
};

forBlock['sc_wpilib_digital_input'] = function (block: Blockly.Block) {
  return [`${digitalInputReference(block)}.get()`, Order.FUNCTION_CALL];
};

forBlock['sc_wpilib_analog_input_value'] = function (block: Blockly.Block) {
  return [
    `${analogInputReference(block)}.${analogInputMethod(block)}()`,
    Order.FUNCTION_CALL,
  ];
};

forBlock['sc_wpilib_encoder_value'] = function (block: Blockly.Block) {
  return [
    `${encoderReference(block)}.${encoderMethod(block)}()`,
    Order.FUNCTION_CALL,
  ];
};

forBlock['sc_wpilib_encoder_reset'] = function (block: Blockly.Block) {
  return `${encoderReference(block)}.reset()\n`;
};

forBlock['sc_wpilib_duty_cycle_encoder_value'] = function (
  block: Blockly.Block,
) {
  return [`${dutyCycleEncoderReference(block)}.get()`, Order.FUNCTION_CALL];
};

forBlock['sc_wpilib_duty_cycle_encoder_connected'] = function (
  block: Blockly.Block,
) {
  return [
    `${dutyCycleEncoderReference(block)}.is_connected()`,
    Order.FUNCTION_CALL,
  ];
};

forBlock['sc_wpilib_analog_encoder_value'] = function (block: Blockly.Block) {
  return [`${analogEncoderReference(block)}.get()`, Order.FUNCTION_CALL];
};

forBlock['sc_wpilib_analog_accelerometer_value'] = function (
  block: Blockly.Block,
) {
  return [
    `${analogAccelerometerReference(block)}.get_acceleration()`,
    Order.FUNCTION_CALL,
  ];
};

forBlock['sc_wpilib_analog_potentiometer_value'] = function (
  block: Blockly.Block,
) {
  return [`${analogPotentiometerReference(block)}.get()`, Order.FUNCTION_CALL];
};

forBlock['sc_wpilib_imu_value'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const reading = block.getFieldValue('READING');
  if (reading === 'TURN_RATE') {
    registerPythonImport(generator, 'math');
    return [
      `math.degrees(${IMU_REFERENCE}.get_gyro_rate_z())`,
      Order.FUNCTION_CALL,
    ];
  }
  const accelAxis: Record<string, string> = {
    ACCEL_X: 'get_accel_x',
    ACCEL_Y: 'get_accel_y',
    ACCEL_Z: 'get_accel_z',
  };
  if (accelAxis[reading]) {
    return [`${IMU_REFERENCE}.${accelAxis[reading]}()`, Order.FUNCTION_CALL];
  }
  return [imuHeadingDegrees(generator), Order.FUNCTION_CALL];
};

forBlock['sc_wpilib_imu_reset'] = function () {
  return `${IMU_REFERENCE}.reset_yaw()\n`;
};

forBlock['sc_wpilib_match_time'] = function () {
  return ['wpilib.Timer.get_match_time()', Order.FUNCTION_CALL];
};

forBlock['sc_wpilib_digital_output_set'] = function (block: Blockly.Block) {
  const value = block.getFieldValue('STATE') === 'OFF' ? 'False' : 'True';
  return `${digitalOutputReference(block)}.set(${value})\n`;
};

forBlock['sc_wpilib_smartdashboard_put'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const key = pythonStringLiteral(block.getFieldValue('KEY'));
  const value = valueToCode(block, generator, 'VALUE', '0');
  return `wpilib.SmartDashboard.put_number(${key}, ${value})\n`;
};

forBlock['sc_wpilib_smartdashboard_get'] = function (block: Blockly.Block) {
  const key = pythonStringLiteral(block.getFieldValue('KEY'));
  return [`wpilib.SmartDashboard.get_number(${key}, 0)`, Order.FUNCTION_CALL];
};

forBlock['sc_rev_color_sensor_value'] = function (block: Blockly.Block) {
  const sensor = revColorSensorReference(block);
  const reading = block.getFieldValue('READING');
  const expressions: Record<string, string> = {
    BLUE: `${sensor}.get_color().blue`,
    GREEN: `${sensor}.get_color().green`,
    IR: `${sensor}.get_ir()`,
    PROXIMITY: `${sensor}.get_proximity()`,
    RED: `${sensor}.get_color().red`,
  };

  return [expressions[reading] || expressions.PROXIMITY, Order.FUNCTION_CALL];
};

forBlock['sc_rev_color_sensor_status'] = function (block: Blockly.Block) {
  const sensor = revColorSensorReference(block);
  const method =
    block.getFieldValue('STATUS') === 'HAS_RESET'
      ? 'has_reset'
      : 'is_connected';
  return [`${sensor}.${method}()`, Order.FUNCTION_CALL];
};

forBlock['sc_rev_color_sensor_sees_color'] = function (block: Blockly.Block) {
  return [revColorSensorSeesColorExpression(block), Order.LOGICAL_AND];
};

forBlock['sc_gamepad_button'] = function (block: Blockly.Block) {
  const button = block.getFieldValue('BUTTON');
  const state = block.getFieldValue('STATE');
  const suffix = state === 'Held' ? '' : `_${state.toLowerCase()}`;
  return [
    `${gamepadReference(block)}.get_${gamepadButtonStem(button)}_button${suffix}()`,
    Order.FUNCTION_CALL,
  ];
};

forBlock['sc_gamepad_axis'] = function (block: Blockly.Block) {
  return [throttleToPercent(gamepadAnalogReading(block)), Order.MULTIPLICATIVE];
};

forBlock['sc_gamepad_trigger'] = function (block: Blockly.Block) {
  return [throttleToPercent(gamepadAnalogReading(block)), Order.MULTIPLICATIVE];
};

forBlock['sc_a301_advanced_call'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  return `${methodCall(block, generator)}\n`;
};

forBlock['sc_a301_advanced_value'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  return [methodCall(block, generator), Order.FUNCTION_CALL];
};

forBlock['sc_python_setup_line'] = function (block: Blockly.Block) {
  const code = (block.getFieldValue('CODE') || '').trim();
  return code ? `${code}\n` : 'pass\n';
};

forBlock['procedures_defnoreturn'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const funcName = generator.getProcedureName(block.getFieldValue('NAME'));
  const varModels = block.getVarModels();
  const args = varModels.map((m) => generator.getVariableName(m.getId()));
  const argString = args.length > 0 ? `, ${args.join(', ')}` : '';
  const stack = generator.statementToCode(block, 'STACK') || '    pass\n';

  if (args.length > 0) {
    const bodyCode = `        async def body():\n${indentCode(stack, 8)}`;
    const returnCode = `        return Command.no_requirements(body).named("${funcName.replace(/"/g, '\\"')}")\n`;
    const defCode = `    def ${funcName}(self${argString}):\n${bodyCode}${returnCode}`;
    blockMethodBodies.push(defCode);
  } else {
    const defCode = `    @no_requirements()\n    async def ${funcName}(self):\n${indentCode(stack, 4)}`;
    blockMethodBodies.push(defCode);
  }
  return null;
};

forBlock['procedures_callnoreturn'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const funcName = generator.getProcedureName(block.getFieldValue('NAME'));
  const args: string[] = [];
  let i = 0;
  while (block.getInput('ARG' + i)) {
    args.push(generator.valueToCode(block, 'ARG' + i, Order.NONE) || 'None');
    i++;
  }
  const argString = `(${args.join(', ')})`;
  return `await self.${funcName}${argString}\n`;
};

forBlock['procedures_defreturn'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const funcName = generator.getProcedureName(block.getFieldValue('NAME'));
  const varModels = block.getVarModels();
  const args = varModels.map((m) => generator.getVariableName(m.getId()));
  const argString = args.length > 0 ? `, ${args.join(', ')}` : '';
  const stack = generator.statementToCode(block, 'STACK') || '';
  const returnValue =
    generator.valueToCode(block, 'RETURN', Order.NONE) || 'None';
  const defCode = `    def ${funcName}(self${argString}):\n${stack ? indentCode(stack, 4) : ''}${generator.INDENT}return ${returnValue}\n`;
  blockMethodBodies.push(defCode);
  return null;
};

forBlock['procedures_callreturn'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const funcName = generator.getProcedureName(block.getFieldValue('NAME'));
  const args: string[] = [];
  let i = 0;
  while (block.getInput('ARG' + i)) {
    args.push(generator.valueToCode(block, 'ARG' + i, Order.NONE) || 'None');
    i++;
  }
  return [`self.${funcName}(${args.join(', ')})`, Order.FUNCTION_CALL];
};

forBlock['variables_get'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const varName = generator.getVariableName(block.getFieldValue('VAR'));
  return [`self.${varName}`, Order.ATOMIC];
};

forBlock['variables_set'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const argument0 = generator.valueToCode(block, 'VALUE', Order.NONE) || '0';
  const varName = generator.getVariableName(block.getFieldValue('VAR'));
  return `self.${varName} = ${argument0}\n`;
};

forBlock['math_change'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const argument0 =
    generator.valueToCode(block, 'DELTA', Order.ADDITIVE) || '0';
  const varName = generator.getVariableName(block.getFieldValue('VAR'));
  return `self.${varName} += ${argument0}\n`;
};

forBlock['variables_get_dynamic'] = forBlock['variables_get'];
forBlock['variables_set_dynamic'] = forBlock['variables_set'];
