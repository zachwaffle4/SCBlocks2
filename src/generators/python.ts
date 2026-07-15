/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Blockly from 'blockly/core';
import {Order, pythonGenerator, type PythonGenerator} from 'blockly/python';
import {getA301Method} from '../generated/a301';
import {
  getDevice,
  getDevices,
  normalizeMovementMotorsConfig,
  parseMotorGroupConfig,
  parseMovementMotorsConfig,
  type MovementMotorsConfig,
} from '../devices';
import {
  getMechanism,
  getMechanisms,
  mechanismCommandNames,
  type Mechanism,
} from '../mechanisms';
import {getRobotMode} from '../robotMode';
import {
  getExtensionInstances,
  type ExtensionInstance,
} from '../extensionInstances';

// Export all the code generators for our custom blocks,
// but don't register them with Blockly yet.
// This file has no side effects!
export const forBlock = Object.create(null);

type GeneratorDefinitions = {definitions_: Record<string, string>};

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

export const safePythonIdentifier = (value: string | null, fallback: string) => {
  const cleaned = (value || fallback)
    .trim()
    .replace(/\W+/g, '_')
    .replace(/^_+|_+$/g, '');
  const identifier = cleaned || fallback;
  const withValidStart = /^\d/.test(identifier) ? `motor_${identifier}` : identifier;
  return pythonKeywords.has(withValidStart) ? `${withValidStart}_value` : withValidStart;
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

// A group inside a subsystem may only reference its owned motors. The field
// keeps an out-of-scope selection visible so the student can remove it, while
// generation omits it instead of producing a reference the subsystem lacks.
let generatingSubsystemMotorIds: ReadonlySet<string> | null = null;

const motorGroupExpression = (block: Blockly.Block) => {
  const motorIds = parseMotorGroupConfig(block.getFieldValue('MOTORS'));
  const motors = motorIds
    .filter(
      (id) =>
        generatingSubsystemMotorIds === null ||
        generatingSubsystemMotorIds.has(id),
    )
    .map((id) => getDevice(id))
    .filter((device): device is NonNullable<typeof device> => Boolean(device))
    .map((device) => `self.${safePythonIdentifier(device.name, 'motor')}`);
  return motors.length === 1 ? `(${motors[0]},)` : `(${motors.join(', ')})`;
};

const valueToCode = (
  block: Blockly.Block,
  generator: PythonGenerator,
  inputName: string,
  fallback: string,
) => generator.valueToCode(block, inputName, Order.NONE) || fallback;

const compactStatementLines = (code: string) =>
  code
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

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

const indentLines = (lines: string[], spaces: number) => {
  const indent = ' '.repeat(spaces);
  return lines.map((line) => `${indent}${line}`).join('\n');
};

const indentCode = (code: string, spaces: number) => {
  const indent = ' '.repeat(spaces);
  return code
    .split('\n')
    .map((line) => (line ? `${indent}${line}` : ''))
    .join('\n');
};

const stripCommandComma = (line: string) => line.replace(/,\s*$/, '');

const percentToThrottle = (power: string) =>
  `max(-1, min(1, (${power}) / 100.0))`;

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
  let cleanBaseName = baseName.replace(/^self\./, '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase() || 'block';
  if (!cleanBaseName.startsWith('block_')) {
    cleanBaseName = `block_${cleanBaseName}`;
  }
  
  const count = (blockMethodNameCounts.get(cleanBaseName) || 0) + 1;
  blockMethodNameCounts.set(cleanBaseName, count);
  
  const name = count > 1 ? `${cleanBaseName}_${count}` : cleanBaseName;
  
  blockMethodBodies.push(`    async def ${name}(self):\n${indentCode(statement.trim() ? statement : 'pass\n', 8)}`);
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
  return `Command.no_requirements().executing(${registerBlockMethod(pythonCall + '\n')})`;
};

const instantCommand = (pythonCall: string) =>
  `${instantCommandExpr(pythonCall)},\n`;

const methodCall = (block: Blockly.Block, generator: PythonGenerator) => {
  const method = getA301Method(block.getFieldValue('METHOD'));
  const args = (block.getFieldValue('ARGS') || '').trim();
  return `${deviceReference(block, generator)}.${method.name}(${args})`;
};

const commandLinesForStatement = (
  block: Blockly.Block,
  generator: PythonGenerator,
  inputName: string,
) => compactStatementLines(generator.statementToCode(block, inputName));

const commandLinesForNext = (
  block: Blockly.Block,
  generator: PythonGenerator,
  baseName = 'block'
) => {
  const next = block.getNextBlock();
  if (!next) return [];
  const code = generator.blockToCode(next);
  const codeStr = Array.isArray(code) ? code[0] : code;
  const method = registerBlockMethod((codeStr || '').trim() ? codeStr : 'pass\n', baseName);
  return [method];
};

const commandGroupExpression = (commands: string[], name?: string) =>
  commands.length
    ? `Command.no_requirements().executing(${commands[0]}).named(${name ? `"${name.replace(/"/g, '\\"')}"` : `"${commands[0]}"`})`
    : `Command.no_requirements().executing(lambda: None).named("empty")`;

const isSetupControlFlow = (block: Blockly.Block) =>
  block.getRootBlock().type === 'sc_on_setup';

const pythonIfStatement = (block: Blockly.Block, generator: PythonGenerator) => {
  let code = '';
  let index = 0;
  while (block.getInput(`IF${index}`)) {
    const condition = valueToCode(block, generator, `IF${index}`, 'False');
    const branch =
      generator.statementToCode(block, `DO${index}`) || `${generator.INDENT}pass\n`;
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

const conditionalCommandExpression = (
  block: Blockly.Block,
  generator: PythonGenerator,
) => {
  let otherwise = commandGroupExpression(
    block.getInput('ELSE')
      ? commandLinesForStatement(block, generator, 'ELSE')
      : [],
  );
  let index = 0;
  while (block.getInput(`IF${index}`)) index += 1;

  while (index > 0) {
    index -= 1;
    const condition = valueToCode(block, generator, `IF${index}`, 'False');
    const whenTrue = commandGroupExpression(
      commandLinesForStatement(block, generator, `DO${index}`),
    );
    otherwise = `_run_conditional(${whenTrue}, ${otherwise}, lambda: ${condition})`;
  }

  return otherwise;
};

const mainCommandExpression = (commands: string[]) => {
  if (!commands.length) {
    return `Command.no_requirements().executing(lambda: None).named("main")`;
  }
  return `Command.no_requirements().executing(${commands[0]}).named("main")`;
};

const startCommandExpression = (commandStacks: string[][]) => {
  if (!commandStacks.length) return `Command.no_requirements().executing(lambda: None).named("start")`;
  if (commandStacks.length === 1) return mainCommandExpression(commandStacks[0]);

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

export const extensionInstanceReference = (instance: ExtensionInstance) =>
  `self.${extensionInstancePythonNames().get(instance.id) || safePythonIdentifier(instance.name, 'object')}`;

const subsystemEventStacks = (mechanism: Mechanism) => {
  const workspace = new Blockly.Workspace();
  const commandStacks = new Map<string, string[]>();
  let startCommands: string[] = [];
  let drivetrain: DrivetrainConfig | null = null;
  const previousGeneratingSubsystemCommand = generatingSubsystemCommand;
  const previousGeneratingSubsystemMotorIds = generatingSubsystemMotorIds;
  generatingSubsystemCommand = true;
  generatingSubsystemMotorIds = new Set(mechanism.motorIds);
  try {
    Blockly.serialization.workspaces.load(mechanism.state, workspace);
    pythonGenerator.init(workspace);
    if (movementDriveNeeded(workspace)) {
      drivetrain = movementDrivetrainConfig(workspace);
    }
    for (const hat of workspace.getBlocksByType('sc_subsystem_on_start', false)) {
      startCommands.push(...commandLinesForNext(hat, pythonGenerator, 'on_start'));
    }
    for (const hat of workspace.getBlocksByType('sc_subsystem_on_command', false)) {
      const command = (hat.getFieldValue('COMMAND') || '').trim();
      if (command && !commandStacks.has(command)) {
        commandStacks.set(command, commandLinesForNext(hat, pythonGenerator, command));
      }
    }
  } catch (error) {
    console.warn(`Skipping invalid subsystem workspace for ${mechanism.name}:`, error);
  } finally {
    generatingSubsystemCommand = previousGeneratingSubsystemCommand;
    generatingSubsystemMotorIds = previousGeneratingSubsystemMotorIds;
    workspace.dispose();
  }
  return {startCommands, commandStacks, drivetrain};
};

/**
 * Project-level commands3 subsystem classes. Advanced mode gives every
 * subsystem its own Scratch-style event workspace; its command hats become
 * reusable Command factories on this class.
 */
export const generateMechanismDefinitions = () => {
  if (getRobotMode() !== 'advanced') return '';
  const definitions: string[] = [];
  const names = mechanismPythonNames();
  for (const mechanism of getMechanisms()) {
    resetBlockMethods();
    const events = subsystemEventStacks(mechanism);
    const motors = mechanismDevices(mechanism);
    const motorReferences = motors.map(
      (motor) => `self.${safePythonIdentifier(motor.name, 'motor')}`,
    );
    definitions.push(
      `class ${mechanismClassName(names.get(mechanism.id) || mechanism.name)}(Mechanism):`,
      '    def __init__(self):',
      `        super().__init__("${mechanismClassName(names.get(mechanism.id) || mechanism.name)}")`,
      ...motors.map(
        (motor) =>
          `        self.${safePythonIdentifier(motor.name, 'motor')} = A301(${motor.deviceId}, ${motor.bus})`,
      ),
      `        self._motors = [${motorReferences.join(', ')}]`,
      ...(events.drivetrain ? drivetrainInitLines(events.drivetrain) : []),
      '',
      '    def set_power(self, power):',
      '        for motor in self._motors:',
      '            motor.setThrottle(power)',
      '',
      '    def stop(self):',
      '        self.set_power(0)',
      '',
      '    def set_motor_group_power(self, motors, power):',
      '        for motor in motors:',
      '            motor.setThrottle(power)',
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
    `lambda output: self.${motorName}.setThrottle(output)`;

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

const gamepadsInWorkspace = (workspace: Blockly.Workspace) => {
  const gamepads = new Set<string>();
  for (const type of GAMEPAD_BLOCK_TYPES) {
    for (const block of workspace.getBlocksByType(type, false)) {
      gamepads.add(gamepadNumber(block));
    }
  }
  return [...gamepads].sort();
};

const intField = (block: Blockly.Block, fieldName: string, fallback: number) => {
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
  block.getFieldValue('READING') === 'VALUE' ? 'getValue' : 'getVoltage';

const encoderChannels = (block: Blockly.Block) =>
  [
    intField(block, 'A_CHANNEL', 0),
    intField(block, 'B_CHANNEL', 1),
  ] as const;

const encoderReference = (block: Blockly.Block) =>
  sensorReference('encoder', ...encoderChannels(block));

// wpilib.Encoder getter for the block's READING field. Shared by the value read
// block and the encoder trigger.
const encoderMethod = (block: Blockly.Block) => {
  const reading = block.getFieldValue('READING');
  return reading === 'RATE' ? 'getRate' : reading === 'COUNT' ? 'get' : 'getDistance';
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
  return `math.degrees(${IMU_REFERENCE}.getYaw())`;
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
    `abs(${sensor}.getColor().red - ${target.red}) <= ${tolerance}`,
    `abs(${sensor}.getColor().green - ${target.green}) <= ${tolerance}`,
    `abs(${sensor}.getColor().blue - ${target.blue}) <= ${tolerance}`,
  ].join(' and ');
};

const sensorInitLines = (
  workspace: Blockly.Workspace,
  generator: PythonGenerator,
) => {
  const lines = new Map<string, string>();
  const add = (name: string, expression: string) => {
    if (!lines.has(name)) {
      lines.set(name, `        self.${name} = ${expression}`);
    }
  };

  for (const type of ['sc_wpilib_digital_input', 'sc_wpilib_digital_input_trigger']) {
    for (const block of workspace.getBlocksByType(type, false)) {
      const channel = intField(block, 'CHANNEL', 0);
      add(sensorObjectName('digital_input', channel), `wpilib.DigitalInput(${channel})`);
    }
  }
  for (const type of ['sc_wpilib_analog_input_value', 'sc_wpilib_analog_input_trigger']) {
    for (const block of workspace.getBlocksByType(type, false)) {
      const channel = intField(block, 'CHANNEL', 0);
      add(sensorObjectName('analog_input', channel), `wpilib.AnalogInput(${channel})`);
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
  for (const block of workspace.getBlocksByType('sc_wpilib_analog_encoder_value', false)) {
    const channel = intField(block, 'CHANNEL', 0);
    add(sensorObjectName('analog_encoder', channel), `wpilib.AnalogEncoder(${channel})`);
  }
  for (const block of workspace.getBlocksByType('sc_wpilib_analog_accelerometer_value', false)) {
    const channel = intField(block, 'CHANNEL', 0);
    add(
      sensorObjectName('analog_accelerometer', channel),
      `wpilib.AnalogAccelerometer(${channel})`,
    );
  }
  for (const block of workspace.getBlocksByType('sc_wpilib_analog_potentiometer_value', false)) {
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
      add(
        'imu',
        'wpilib.OnboardIMU(wpilib.OnboardIMU.MountOrientation.FLAT)',
      );
    }
  }
  for (const block of workspace.getBlocksByType('sc_wpilib_digital_output_set', false)) {
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
      registerPythonImport(generator, 'rev');
      const key = i2cPortKey(block);
      add(
        `rev_color_sensor_${key}`,
        `rev.ColorSensorV3(${i2cPortExpression(block)})`,
      );
    }
  }

  return [...lines.values()];
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
      `        ${name}.${mode}(${commandGroupExpression(commands, condition)})`,
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
    return `${revColorSensorReference(trigger)}.getProximity() >= (${threshold})`;
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
  const details = workspace.getBlocksByType('sc_opmode_details', false)[0];
  const type = details?.getFieldValue('TYPE') || 'Teleop';
  const enabled = details ? details.getFieldValue('ENABLED') === 'TRUE' : true;
  const name = (details?.getFieldValue('NAME') || '').trim();
  const description = (details?.getFieldValue('DESCRIPTION') || '').trim();
  const className = pascalCaseIdentifier(name, 'MyOpMode');

  const setupSections: string[] = [];
  for (const hat of workspace.getBlocksByType('sc_on_setup', false)) {
    const setupCode = normalizeStatementIndentation(
      generator.statementToCode(hat, 'SETUP'),
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

  const initBody: string[] = ['        super().__init__()'];
  initBody.push('');
  for (const gamepad of gamepadsInWorkspace(workspace)) {
    initBody.push(
      `        self.gamepad${gamepad} = wpilib.Gamepad(${gamepadPort(gamepad)})`,
    );
  }
  initBody.push(...sensorInitLines(workspace, generator));
  // Simple mode exposes motors directly to OpMode blocks. Advanced mode moves
  // construction into the owning subsystem class instead.
  if (getRobotMode() === 'simple') {
    for (const device of getDevices()) {
      const motor = safePythonIdentifier(device.name, 'drive_motor');
      initBody.push(`        self.${motor} = A301(${device.deviceId}, ${device.bus})`);
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
  if (getRobotMode() === 'advanced') {
    const mechanismNames = mechanismPythonNames();
    for (const mechanism of getMechanisms()) {
      const name = mechanismNames.get(mechanism.id) || 'mechanism';
      initBody.push(
        `        self.${name} = ${mechanismClassName(name)}()`,
      );
      // Each subsystem's "when this subsystem starts" event runs beside the
      // OpMode's own start hats, just like separate Scratch event scripts.
      startCommandStacks.push([`self.${name}.on_start()`]);
    }
  }
  if (movementDriveNeeded(workspace)) {
    initBody.push(...drivetrainInitLines(movementDrivetrainConfig(workspace)));
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
  const power = valueToCode(block, generator, 'POWER', '0');
  return `${deviceReference(block, generator)}.setThrottle(${percentToThrottle(power)})\n`;
};

forBlock['sc_motor_run_for_seconds'] = function (block: Blockly.Block, generator: PythonGenerator) {
  const motor = deviceReference(block, generator);
  const power = valueToCode(block, generator, 'POWER', '50');
  const seconds = valueToCode(block, generator, 'SECONDS', '1');
  return `${motor}.setThrottle(${percentToThrottle(power)})\nawait wait(${seconds})\n${motor}.setThrottle(0)\n`;
};

forBlock['sc_motor_stop'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  return `${deviceReference(block, generator)}.setThrottle(0)\n`;
};

forBlock['sc_motor_set_velocity'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const velocity = valueToCode(block, generator, 'VELOCITY', '0');
  return `${deviceReference(block, generator)}.setVelocity(${velocity})\n`;
};

forBlock['sc_motor_set_position'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const position = valueToCode(block, generator, 'POSITION', '0');
  return `${deviceReference(block, generator)}.setPosition(${position})\n`;
};

forBlock['sc_motor_group'] = function (block: Blockly.Block) {
  return [motorGroupExpression(block), Order.ATOMIC];
};

const motorGroupPowerCommand = (
  block: Blockly.Block,
  generator: PythonGenerator,
  power: string,
) => {
  const group = valueToCode(block, generator, 'GROUP', '()');
  return `for _motor in ${group}:\n    _motor.setThrottle(${power})\n`;
};

forBlock['sc_motor_group_set_power'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const power = valueToCode(block, generator, 'POWER', '0');
  return motorGroupPowerCommand(block, generator, percentToThrottle(power));
};

forBlock['sc_motor_group_stop'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  return motorGroupPowerCommand(block, generator, '0');
};

forBlock['sc_mechanism_set_power'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const mechanism = getMechanism(block.getFieldValue('MECHANISM'));
  if (!mechanism) return '';
  const name = mechanismPythonNames().get(mechanism.id) || 'mechanism';
  const power = valueToCode(block, generator, 'POWER', '0');
  return `self.${name}.set_power(${percentToThrottle(power)})\n`;
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
  return `self.${name}.${subsystemCommandMethodName(command)}()\n`;
};

forBlock['sc_drivetrain_arcade_drive'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const forward = valueToCode(block, generator, 'FORWARD', '0');
  const turn = valueToCode(block, generator, 'TURN', '0');
  return `${movementDriveReference()}.arcadeDrive(${percentToThrottle(forward)}, ${percentToThrottle(turn)})\n`;
};

forBlock['sc_drivetrain_tank_drive'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const leftPower = valueToCode(block, generator, 'LEFT_POWER', '0');
  const rightPower = valueToCode(block, generator, 'RIGHT_POWER', '0');
  return `${movementDriveReference()}.tankDrive(${percentToThrottle(leftPower)}, ${percentToThrottle(rightPower)})\n`;
};

forBlock['sc_drivetrain_stop'] = function (block: Blockly.Block) {
  return `${movementDriveReference()}.stop()\n`;
};

forBlock['sc_mecanum_drive'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const sideways = valueToCode(block, generator, 'SIDEWAYS', '0');
  const forward = valueToCode(block, generator, 'FORWARD', '0');
  const turn = valueToCode(block, generator, 'TURN', '0');
  return `${movementDriveReference()}.driveCartesian(${percentToThrottle(sideways)}, ${percentToThrottle(forward)}, ${percentToThrottle(turn)})\n`;
};

forBlock['sc_mecanum_stop'] = function (block: Blockly.Block) {
  return `${movementDriveReference()}.stop()\n`;
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
  const innerCommands = generator.statementToCode(block, 'COMMANDS') || `${generator.INDENT}pass\n`;
  return `for _ in range(int(${times})):\n${innerCommands}`;
};

forBlock['sc_parallel_commands'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const firstCommands = generator.statementToCode(block, 'DO0') || `${generator.INDENT}pass\n`;
  const secondCommands = generator.statementToCode(block, 'DO1') || `${generator.INDENT}pass\n`;
  const id = block.id.replace(/[^a-zA-Z0-9]/g, '');
  return `async def _parallel_${id}_0():\n${firstCommands}async def _parallel_${id}_1():\n${secondCommands}await await_all([Command.no_requirements().executing(_parallel_${id}_0), Command.no_requirements().executing(_parallel_${id}_1)])\n`;
};

forBlock['sc_race_commands'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const firstCommands = generator.statementToCode(block, 'DO0') || `${generator.INDENT}pass\n`;
  const secondCommands = generator.statementToCode(block, 'DO1') || `${generator.INDENT}pass\n`;
  const id = block.id.replace(/[^a-zA-Z0-9]/g, '');
  return `async def _race_${id}_0():\n${firstCommands}async def _race_${id}_1():\n${secondCommands}await await_any([Command.no_requirements().executing(_race_${id}_0), Command.no_requirements().executing(_race_${id}_1)])\n`;
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
    ABSOLUTE_POSITION: `${motor}.getAbsoluteEncoderPosition().get()`,
    BUS_VOLTAGE: `${motor}.getBusVoltage().get()`,
    CURRENT: `${motor}.getMotorCurrent().get()`,
    POSITION: `${motor}.getRelativeEncoderPosition().get()`,
    POWER: `(${motor}.getThrottle() * 100)`,
    TEMPERATURE: `${motor}.getMotorTemperature().get()`,
    VELOCITY: `${motor}.getEncoderVelocity().get()`,
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
    `${dutyCycleEncoderReference(block)}.isConnected()`,
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
    `${analogAccelerometerReference(block)}.getAcceleration()`,
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
    return [`math.degrees(${IMU_REFERENCE}.getGyroRateZ())`, Order.FUNCTION_CALL];
  }
  const accelAxis: Record<string, string> = {
    ACCEL_X: 'getAccelX',
    ACCEL_Y: 'getAccelY',
    ACCEL_Z: 'getAccelZ',
  };
  if (accelAxis[reading]) {
    return [`${IMU_REFERENCE}.${accelAxis[reading]}()`, Order.FUNCTION_CALL];
  }
  return [imuHeadingDegrees(generator), Order.FUNCTION_CALL];
};

forBlock['sc_wpilib_imu_reset'] = function () {
  return `${IMU_REFERENCE}.reset()\n`;
};

forBlock['sc_wpilib_match_time'] = function () {
  return ['wpilib.Timer.getMatchTime()', Order.FUNCTION_CALL];
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
  return `wpilib.SmartDashboard.putNumber(${key}, ${value})\n`;
};

forBlock['sc_wpilib_smartdashboard_get'] = function (block: Blockly.Block) {
  const key = pythonStringLiteral(block.getFieldValue('KEY'));
  return [`wpilib.SmartDashboard.getNumber(${key}, 0)`, Order.FUNCTION_CALL];
};

forBlock['sc_rev_color_sensor_value'] = function (block: Blockly.Block) {
  const sensor = revColorSensorReference(block);
  const reading = block.getFieldValue('READING');
  const expressions: Record<string, string> = {
    BLUE: `${sensor}.getColor().blue`,
    GREEN: `${sensor}.getColor().green`,
    IR: `${sensor}.getIR()`,
    PROXIMITY: `${sensor}.getProximity()`,
    RED: `${sensor}.getColor().red`,
  };

  return [expressions[reading] || expressions.PROXIMITY, Order.FUNCTION_CALL];
};

forBlock['sc_rev_color_sensor_status'] = function (block: Blockly.Block) {
  const sensor = revColorSensorReference(block);
  const method =
    block.getFieldValue('STATUS') === 'HAS_RESET' ? 'hasReset' : 'isConnected';
  return [`${sensor}.${method}()`, Order.FUNCTION_CALL];
};

forBlock['sc_rev_color_sensor_sees_color'] = function (block: Blockly.Block) {
  return [revColorSensorSeesColorExpression(block), Order.LOGICAL_AND];
};

forBlock['sc_gamepad_button'] = function (block: Blockly.Block) {
  const button = block.getFieldValue('BUTTON');
  const state = block.getFieldValue('STATE');
  const suffix = state === 'Held' ? '' : state;
  return [
    `${gamepadReference(block)}.get${button}Button${suffix}()`,
    Order.FUNCTION_CALL,
  ];
};

forBlock['sc_gamepad_axis'] = function (block: Blockly.Block) {
  const axis = block.getFieldValue('AXIS');
  return [`${gamepadReference(block)}.get${axis}()`, Order.FUNCTION_CALL];
};

forBlock['sc_gamepad_trigger'] = function (block: Blockly.Block) {
  const side = block.getFieldValue('SIDE');
  return [
    `${gamepadReference(block)}.get${side}TriggerAxis()`,
    Order.FUNCTION_CALL,
  ];
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
