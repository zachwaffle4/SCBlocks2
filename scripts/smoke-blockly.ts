import * as Blockly from 'blockly';
import 'blockly/blocks';
import {pythonGenerator} from 'blockly/python';
import {blocks} from '../src/blocks/text';
import {
  addDevice,
  registerDeviceField,
  serializeMotorGroupConfig,
  serializeMovementMotorsConfig,
  setDevices,
} from '../src/devices';
import {
  addMechanism,
  registerMechanismField,
  setMechanisms,
  updateMechanism,
} from '../src/mechanisms';
import {
  addExtensionInstance,
  registerExtensionInstanceField,
  setExtensionInstances,
} from '../src/extensionInstances';
import {forBlock, generateOpmodeClass} from '../src/generators/python';
import {
  addExtension,
  buildExtensionsFlyout,
  extensionBlocks,
  extensionForBlock,
  removeExtension,
} from '../src/extensions';
import {A301_CLASS_NAME} from '../src/generated/a301';
import {
  generateAllOpmodes,
  makeOpmodeState,
  migrateWorkspaceState,
  opmodeInfoFromState,
} from '../src/opmodes';
import {buildToolbox, toolbox} from '../src/toolbox';
import {setRobotMode} from '../src/robotMode';

const assert = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertIncludes = (haystack: string, needle: string) => {
  assert(haystack.includes(needle), `Expected generated code to include: ${needle}`);
};

registerDeviceField();
registerMechanismField();
registerExtensionInstanceField();
if (!Blockly.Blocks['sc_opmode_details']) {
  Blockly.common.defineBlocks(blocks);
}
if (!Blockly.Blocks['sc_ext_call']) {
  Blockly.common.defineBlocks(extensionBlocks);
}
Object.assign(pythonGenerator.forBlock, forBlock);
Object.assign(pythonGenerator.forBlock, extensionForBlock);

const workspace = new Blockly.Workspace();
// Motors live in the project-level registry now; adding one here makes it
// register automatically in every generated opmode.
const device = addDevice({name: 'drive_motor', bus: 3, deviceId: 0});

const numberBlock = (value: number, targetWorkspace = workspace) => {
  const block = targetWorkspace.newBlock('math_number');
  block.setFieldValue(String(value), 'NUM');
  return block;
};

const connectValue = (
  parent: Blockly.Block,
  inputName: string,
  child: Blockly.Block,
) => {
  const input = parent.getInput(inputName);
  assert(input?.connection, `${parent.type}.${inputName} is missing`);
  assert(child.outputConnection, `${child.type} has no output connection`);
  input!.connection!.connect(child.outputConnection!);
};

const connectStatement = (
  parent: Blockly.Block,
  inputName: string,
  child: Blockly.Block,
) => {
  const input = parent.getInput(inputName);
  assert(input?.connection, `${parent.type}.${inputName} is missing`);
  assert(child.previousConnection, `${child.type} has no previous connection`);
  input!.connection!.connect(child.previousConnection!);
};

// Event/trigger hats attach their command stack below via the next connection
// (they act as headers, not enclosing C-blocks).
const connectNext = (parent: Blockly.Block, child: Blockly.Block) => {
  assert(parent.nextConnection, `${parent.type} has no next connection`);
  assert(child.previousConnection, `${child.type} has no previous connection`);
  parent.nextConnection!.connect(child.previousConnection!);
};

const setDevice = (block: Blockly.Block) => {
  block.setFieldValue(device.id, 'DEVICE');
};

// ---------------------------------------------------------------------------
// Operators: custom tolerance predicate plus Blockly's absolute-value block.
// ---------------------------------------------------------------------------

const withinBlock = workspace.newBlock('sc_operator_is_within');
assert(
  withinBlock.getInputsInline(),
  'The is-within operator should keep its inputs inline',
);
connectValue(withinBlock, 'VALUE', numberBlock(12));
connectValue(withinBlock, 'TOLERANCE', numberBlock(2));
connectValue(withinBlock, 'TARGET', numberBlock(10));
pythonGenerator.init(workspace);
const withinCode = pythonGenerator.blockToCode(withinBlock);
assert(
  Array.isArray(withinCode),
  'The is-within operator should generate a value expression',
);
assertIncludes(withinCode[0], 'abs((12) - (10)) <= abs(2)');
withinBlock.dispose(true);

// ---------------------------------------------------------------------------
// Contextual if: command stacks compose Commands2 ConditionalCommands, while
// the direct setup path remains regular, properly indented Python control flow.
// ---------------------------------------------------------------------------

const ifWorkspace = new Blockly.Workspace();
const ifDetails = ifWorkspace.newBlock('sc_opmode_details');
ifDetails.setFieldValue('If Context', 'NAME');

const commandStart = ifWorkspace.newBlock('sc_on_start');
const commandIf = ifWorkspace.newBlock('sc_if') as Blockly.Block & {
  loadExtraState?: (state: {hasElse?: boolean}) => void;
};
assert(
  commandIf.getStyleName() === 'control_blocks',
  'The contextual if block should use the Control block style',
);
commandIf.loadExtraState?.({hasElse: true});
assert(commandIf.getInput('ELSE'), 'The if block should support an else branch');
const commandCondition = ifWorkspace.newBlock('logic_boolean');
commandCondition.setFieldValue('TRUE', 'BOOL');
connectValue(commandIf, 'IF0', commandCondition);
const thenPower = ifWorkspace.newBlock('sc_motor_set_power');
setDevice(thenPower);
connectValue(thenPower, 'POWER', numberBlock(25, ifWorkspace));
connectStatement(commandIf, 'DO0', thenPower);
const elsePower = ifWorkspace.newBlock('sc_motor_set_power');
setDevice(elsePower);
connectValue(elsePower, 'POWER', numberBlock(-25, ifWorkspace));
connectStatement(commandIf, 'ELSE', elsePower);
connectNext(commandStart, commandIf);

pythonGenerator.init(ifWorkspace);
const commandIfCode = generateOpmodeClass(ifWorkspace, pythonGenerator);
assertIncludes(commandIfCode, 'if True:');
assertIncludes(commandIfCode, 'max(-1, min(1, (25) / 100.0))');
assertIncludes(commandIfCode, 'max(-1, min(1, (-25) / 100.0))');
assertIncludes(commandIfCode, 'else:');

const setupHat = ifWorkspace.newBlock('sc_on_setup');
const setupIf = ifWorkspace.newBlock('sc_if') as Blockly.Block & {
  loadExtraState?: (state: {hasElse?: boolean}) => void;
};
setupIf.loadExtraState?.({hasElse: true});
const setupCondition = ifWorkspace.newBlock('logic_boolean');
setupCondition.setFieldValue('FALSE', 'BOOL');
connectValue(setupIf, 'IF0', setupCondition);
const setupThen = ifWorkspace.newBlock('sc_python_setup_line');
setupThen.setFieldValue('self.ready = True', 'CODE');
connectStatement(setupIf, 'DO0', setupThen);
const setupElse = ifWorkspace.newBlock('sc_python_setup_line');
setupElse.setFieldValue('self.ready = False', 'CODE');
connectStatement(setupIf, 'ELSE', setupElse);
setupHat.nextConnection!.connect(setupIf.previousConnection!);

pythonGenerator.init(ifWorkspace);
const setupIfCode = generateOpmodeClass(ifWorkspace, pythonGenerator);
assertIncludes(
  setupIfCode,
  '        if False:\n          self.ready = True\n        else:\n          self.ready = False',
);
ifWorkspace.dispose();

// ---------------------------------------------------------------------------
// OpMode: separate, opmode-scoped hat blocks (details / setup / start / trigger)
// assembled into one decorated class by generateOpmodeClass().
// ---------------------------------------------------------------------------

const details = workspace.newBlock('sc_opmode_details');
details.setFieldValue('Auto', 'TYPE');
details.setFieldValue('TRUE', 'ENABLED');
details.setFieldValue('Reach Zone', 'NAME');
details.setFieldValue('Comp', 'GROUP');

const startHat = workspace.newBlock('sc_on_start');
const runForSeconds = workspace.newBlock('sc_motor_run_for_seconds');
setDevice(runForSeconds);
connectValue(runForSeconds, 'POWER', numberBlock(50));
connectValue(runForSeconds, 'SECONDS', numberBlock(2));
connectNext(startHat, runForSeconds);

// Extension (escape hatch) block chained after the run command.
const extCall = workspace.newBlock('sc_ext_call');
extCall.setFieldValue('self.gyro', 'TARGET');
extCall.setFieldValue('reset', 'METHOD');
// ARGS is handled by mutator
runForSeconds.nextConnection!.connect(extCall.previousConnection!);

// A second start hat should run beside the first one, not after it.
const secondStartHat = workspace.newBlock('sc_on_start');
const secondStartStop = workspace.newBlock('sc_motor_stop');
setDevice(secondStartStop);
connectNext(secondStartHat, secondStartStop);

// Opmode-scoped trigger with any boolean condition.
const trigger = workspace.newBlock('sc_trigger');
trigger.setFieldValue('whileTrue', 'MODE');
const triggerCond = workspace.newBlock('logic_boolean');
triggerCond.setFieldValue('TRUE', 'BOOL');
connectValue(trigger, 'CONDITION', triggerCond);
const triggerStop = workspace.newBlock('sc_motor_stop');
setDevice(triggerStop);
connectNext(trigger, triggerStop);

// Hand-wrapped WPILib sensor blocks auto-create their sensor objects in
// __init__ and generate friendly reporter / command expressions.
const sensorTrigger = workspace.newBlock('sc_trigger');
const digitalInput = workspace.newBlock('sc_wpilib_digital_input');
digitalInput.setFieldValue('2', 'CHANNEL');
connectValue(sensorTrigger, 'CONDITION', digitalInput);
const encoderReset = workspace.newBlock('sc_wpilib_encoder_reset');
encoderReset.setFieldValue('0', 'A_CHANNEL');
encoderReset.setFieldValue('1', 'B_CHANNEL');
connectNext(sensorTrigger, encoderReset);

const analogInput = workspace.newBlock('sc_wpilib_analog_input_value');
analogInput.setFieldValue('3', 'CHANNEL');
analogInput.setFieldValue('VALUE', 'READING');
pythonGenerator.init(workspace);
const analogInputCode = pythonGenerator.blockToCode(analogInput);
assert(
  Array.isArray(analogInputCode),
  'The analog input block should generate a value expression',
);
assertIncludes(analogInputCode[0], 'self.analog_input_3.getValue()');
analogInput.dispose(true);

const revStatusTrigger = workspace.newBlock('sc_trigger');
const revConnected = workspace.newBlock('sc_rev_color_sensor_status');
revConnected.setFieldValue('MXP', 'PORT');
revConnected.setFieldValue('CONNECTED', 'STATUS');
connectValue(revStatusTrigger, 'CONDITION', revConnected);

const revColorValue = workspace.newBlock('sc_rev_color_sensor_value');
revColorValue.setFieldValue('MXP', 'PORT');
revColorValue.setFieldValue('RED', 'READING');
assert(
  revColorValue.getColour().toLowerCase() === '#ff5418',
  'REV color sensor extension blocks should use the REV orange-red',
);
pythonGenerator.init(workspace);
const revColorCode = pythonGenerator.blockToCode(revColorValue);
assert(
  Array.isArray(revColorCode),
  'The REV color sensor value block should generate a value expression',
);
assertIncludes(revColorCode[0], 'self.rev_color_sensor_mxp.getColor().red');
revColorValue.dispose(true);

const revColorTrigger = workspace.newBlock('sc_rev_color_sensor_color_trigger');
revColorTrigger.setFieldValue('MXP', 'PORT');
const revColorField = revColorTrigger.getField('COLOR');
assert(
  revColorField?.constructor.name === 'FieldColourSlider',
  'The REV color trigger should use the RGB slider colour field',
);
revColorTrigger.setFieldValue('rgb(0, 255, 0)', 'COLOR');
assert(
  revColorTrigger.getFieldValue('COLOR') === '#00ff00',
  'RGB colour values should be stored as hex',
);
revColorTrigger.setFieldValue('whileTrue', 'MODE');
const revColorStop = workspace.newBlock('sc_motor_stop');
setDevice(revColorStop);
connectNext(revColorTrigger, revColorStop);

const revSeesColor = workspace.newBlock('sc_rev_color_sensor_sees_color');
revSeesColor.setFieldValue('MXP', 'PORT');
revSeesColor.setFieldValue('#0000ff', 'COLOR');
pythonGenerator.init(workspace);
const revSeesColorCode = pythonGenerator.blockToCode(revSeesColor);
assert(
  Array.isArray(revSeesColorCode),
  'The REV sees-color block should generate a boolean expression',
);
assertIncludes(
  revSeesColorCode[0],
  'abs(self.rev_color_sensor_mxp.getColor().blue - 1) <= 0.25',
);
revSeesColor.dispose(true);

const revProximityTrigger = workspace.newBlock(
  'sc_rev_color_sensor_proximity_trigger',
);
revProximityTrigger.setFieldValue('MXP', 'PORT');
connectValue(revProximityTrigger, 'THRESHOLD', numberBlock(250));
const revProximityStop = workspace.newBlock('sc_motor_stop');
setDevice(revProximityStop);
connectNext(revProximityTrigger, revProximityStop);

// Dedicated WPILib sensor triggers build their sensor object in __init__ and
// use it in the Trigger condition, just like the REV sensor triggers.
const digitalInputTrigger = workspace.newBlock('sc_wpilib_digital_input_trigger');
digitalInputTrigger.setFieldValue(4, 'CHANNEL');
const digitalInputTriggerStop = workspace.newBlock('sc_motor_stop');
setDevice(digitalInputTriggerStop);
connectNext(digitalInputTrigger, digitalInputTriggerStop);

const encoderTrigger = workspace.newBlock('sc_wpilib_encoder_trigger');
encoderTrigger.setFieldValue('RATE', 'READING');
connectValue(encoderTrigger, 'THRESHOLD', numberBlock(5));
const encoderTriggerStop = workspace.newBlock('sc_motor_stop');
setDevice(encoderTriggerStop);
connectNext(encoderTrigger, encoderTriggerStop);

pythonGenerator.init(workspace);
const opmodeCode = generateOpmodeClass(workspace, pythonGenerator);
assertIncludes(opmodeCode, '@autonomous');
assertIncludes(opmodeCode, 'class ReachZone(wpilib.PeriodicOpMode):');
assertIncludes(opmodeCode, 'def __init__(self):');
assertIncludes(opmodeCode, 'def start(self):');
assertIncludes(opmodeCode, 'self.drive_motor = A301(0, 3)');
assertIncludes(opmodeCode, 'self.digital_input_2 = wpilib.DigitalInput(2)');
assertIncludes(opmodeCode, 'self.encoder_0_1 = wpilib.Encoder(0, 1)');
assertIncludes(
  opmodeCode,
  'self.rev_color_sensor_mxp = rev.ColorSensorV3(wpilib.I2C.Port.PORT_1)',
);
assertIncludes(opmodeCode, 'self.digital_input_2.get()');
assertIncludes(opmodeCode, 'self.encoder_0_1.reset()');
assertIncludes(opmodeCode, 'self.rev_color_sensor_mxp.isConnected()');
assertIncludes(
  opmodeCode,
  'abs(self.rev_color_sensor_mxp.getColor().green - 1) <= 0.25',
);
assertIncludes(
  opmodeCode,
  'self.rev_color_sensor_mxp.getProximity() >= (250)',
);
assertIncludes(opmodeCode, 'self.digital_input_4 = wpilib.DigitalInput(4)');
assertIncludes(opmodeCode, 'Trigger(lambda: self.digital_input_4.get())');
assertIncludes(opmodeCode, 'self.encoder_0_1.getRate() >= (5)');
assertIncludes(opmodeCode, 'self.main_command: Command | None = None');
assertIncludes(opmodeCode, 'Scheduler.get_default().run()');
assertIncludes(opmodeCode, 'self.gyro.reset()');
assertIncludes(opmodeCode, 'Command.no_requirements().executing(self.block_');
assertIncludes(opmodeCode, 'self.main_command = Command.parallel(');
assertIncludes(opmodeCode, 'Trigger(lambda:');
assertIncludes(opmodeCode, 'trigger_1.while_true(');

// A disabled opmode still generates the class but no registration decorator.
details.setFieldValue('FALSE', 'ENABLED');
pythonGenerator.init(workspace);
const disabledCode = generateOpmodeClass(workspace, pythonGenerator);
assert(
  !disabledCode.includes('@autonomous'),
  'Disabled opmode should not emit a type decorator',
);
details.setFieldValue('TRUE', 'ENABLED');
const fullSensorCode = generateAllOpmodes([
  {id: 'sensor-imports', state: Blockly.serialization.workspaces.save(workspace)},
]);
assertIncludes(fullSensorCode, 'import rev');

// ---------------------------------------------------------------------------
// Gamepad wrappers: reading a gamepad button/axis/trigger creates the matching
// wpilib.Gamepad in __init__ and uses that object in trigger conditions.
// ---------------------------------------------------------------------------

const gamepadTrigger = workspace.newBlock('sc_trigger');
const gamepadButton = workspace.newBlock('sc_gamepad_button');
gamepadButton.setFieldValue('2', 'GAMEPAD');
gamepadButton.setFieldValue('EastFace', 'BUTTON');
gamepadButton.setFieldValue('Pressed', 'STATE');
connectValue(gamepadTrigger, 'CONDITION', gamepadButton);
const gamepadStop = workspace.newBlock('sc_motor_stop');
setDevice(gamepadStop);
connectNext(gamepadTrigger, gamepadStop);

pythonGenerator.init(workspace);
const gamepadCode = generateOpmodeClass(workspace, pythonGenerator);
assertIncludes(gamepadCode, 'self.gamepad2 = wpilib.Gamepad(1)');
assertIncludes(gamepadCode, 'self.gamepad2.getEastFaceButtonPressed()');
gamepadTrigger.dispose(true);

// The gamepad category is Teleop-only: present when requested, absent from the
// default toolbox.
const teleopCategoryNames = buildToolbox({includeGamepad: true}).contents
  .filter((item) => item.kind === 'category')
  .map((item) => (item as {name?: string}).name);
assert(
  teleopCategoryNames.includes('Gamepad'),
  'Teleop toolbox should include the Gamepad category',
);

// ---------------------------------------------------------------------------
// Escape hatch: generated API must NOT be in the default toolbox.
// ---------------------------------------------------------------------------

const categoryNames = toolbox.contents
  .filter((item) => item.kind === 'category')
  .map((item) => (item as {name?: string}).name);
// OpModes are tabs (one workspace + hat block each), not a toolbox category.
assert(!categoryNames.includes('OpModes'), 'OpModes should be tabs, not a category');
assert(
  !categoryNames.includes('Gamepad'),
  'Default toolbox must not include the Gamepad category (Teleop-only)',
);
assert(
  !categoryNames.includes('WPILib Sensors'),
  'Default toolbox must not include the WPILib Sensors extension category',
);
assert(
  !categoryNames.includes('REV Sensors'),
  'Default toolbox must not include the REV Sensors extension category',
);

const sensorsCategoryNames = buildToolbox({
  includeGamepad: false,
  includeWpilibSensors: true,
}).contents
  .filter((item) => item.kind === 'category')
  .map((item) => (item as {name?: string}).name);
assert(
  sensorsCategoryNames.includes('WPILib Sensors'),
  'WPILib Sensors should appear after adding the curated extension',
);
const sensorsToolbox = JSON.stringify(
  buildToolbox({includeGamepad: false, includeWpilibSensors: true}),
);
assertIncludes(sensorsToolbox, 'sc_wpilib_digital_input');
assertIncludes(sensorsToolbox, 'sc_wpilib_encoder_reset');
assert(
  !sensorsToolbox.includes('sc_rev_color_sensor_value'),
  'WPILib Sensors should not include REV sensor blocks',
);

const revSensorsCategoryNames = buildToolbox({
  includeGamepad: false,
  includeRevSensors: true,
}).contents
  .filter((item) => item.kind === 'category')
  .map((item) => (item as {name?: string}).name);
assert(
  revSensorsCategoryNames.includes('REV Sensors'),
  'REV Sensors should appear after adding the separate curated extension',
);
const revSensorsToolbox = JSON.stringify(
  buildToolbox({includeGamepad: false, includeRevSensors: true}),
);
assertIncludes(revSensorsToolbox, 'sc_rev_color_sensor_value');
assertIncludes(revSensorsToolbox, 'sc_rev_color_sensor_status');
assertIncludes(revSensorsToolbox, 'sc_rev_color_sensor_color_trigger');
assertIncludes(revSensorsToolbox, 'sc_rev_color_sensor_sees_color');
assertIncludes(revSensorsToolbox, 'sc_rev_color_sensor_proximity_trigger');

const extensionsCategory = toolbox.contents.find(
  (item) => item.kind === 'category' && (item as {name?: string}).name === 'Extensions',
);
assert(extensionsCategory, 'Missing Extensions category');
assert(
  'custom' in (extensionsCategory as object),
  'Extensions category should be a dynamic (custom) category, not static blocks',
);
assert(
  !categoryNames.includes('Advanced APIs'),
  'Generated API blocks must not be in the default toolbox',
);

const operatorsCategory = toolbox.contents.find(
  (item) =>
    item.kind === 'category' && (item as {name?: string}).name === 'Operators',
);
const operatorBlocks = JSON.stringify(operatorsCategory ?? {});
assertIncludes(operatorBlocks, '"type":"math_single"');
assertIncludes(operatorBlocks, '"OP":"ABS"');
assertIncludes(operatorBlocks, 'sc_operator_is_within');

const serialized = JSON.stringify(toolbox);
assert(
  !serialized.includes('sc_ext_call') &&
    !serialized.includes('sc_ext_value') &&
    !serialized.includes('sc_ext_enum'),
  'Escape-hatch blocks must not be baked into the default toolbox definition',
);

addExtension(A301_CLASS_NAME);
const a301Flyout = JSON.stringify(buildExtensionsFlyout());
assertIncludes(a301Flyout, 'sc_a301_advanced_call');
assertIncludes(a301Flyout, 'sc_a301_advanced_value');
assert(
  !a301Flyout.includes('sc_ext_call') && !a301Flyout.includes('sc_ext_value'),
  'Loading rev.A301 should use the A301 motor-aware blocks, not generic target fields',
);
removeExtension(A301_CLASS_NAME);

// ---------------------------------------------------------------------------
// Motors: managed through the project registry, registered automatically, and
// no longer a toolbox category.
// ---------------------------------------------------------------------------

assert(
  !categoryNames.includes('Devices'),
  'Devices should no longer be a toolbox category (motors are UI-managed)',
);
assert(
  !Blockly.Blocks['sc_a301_motor'],
  'The manual register-motor block should be removed',
);

// Motor blocks pick a motor through the custom field_device dropdown.
const powerBlock = workspace.newBlock('sc_motor_set_power');
assert(
  powerBlock.getField('DEVICE')?.constructor.name === 'FieldDevice',
  'Motor blocks should use the FieldDevice dropdown',
);
powerBlock.dispose(true);

// Adding a second motor makes it auto-register in generated opmodes too.
addDevice({name: 'arm_motor', bus: 7, deviceId: 1});
const registrationCheck = generateAllOpmodes([
  {id: 'reg', state: makeOpmodeState('Teleop', 'Drive')},
]);
assertIncludes(registrationCheck, 'from commands3 import *');

assertIncludes(registrationCheck, 'from rev import A301');
assertIncludes(registrationCheck, 'from robot import teleop');
assert(
  !registrationCheck.includes('class A301:'),
  'Generated code should import the real rev.A301 class instead of emitting a stub',
);
assertIncludes(registrationCheck, 'self.drive_motor = A301(0, 3)');
assertIncludes(registrationCheck, 'self.arm_motor = A301(1, 7)');

// Clearing the registry means no motors are registered.
setDevices([]);
const emptyCheck = generateAllOpmodes([
  {id: 'empty', state: makeOpmodeState('Teleop', 'Drive')},
]);
assert(
  !emptyCheck.includes(' = A301('),
  'No motors should be registered when the registry is empty',
);
setDevices([device]);

// Older saved projects could contain a numeric A301 sensor block directly in a
// Boolean condition socket. Migrate that shape before Blockly tries to load it.
const staleSensorConditionState = makeOpmodeState('Teleop', 'Sensor Check');
(
  staleSensorConditionState as {
    blocks: {blocks: Array<Record<string, unknown>>};
  }
).blocks.blocks.push({
  type: 'sc_trigger',
  inputs: {
    CONDITION: {
      block: {
        type: 'sc_a301_sensor_value',
        fields: {
          DEVICE: device.id,
          SENSOR: 'VELOCITY',
        },
      },
    },
  },
  next: {
    block: {
      type: 'sc_motor_stop',
      fields: {
        DEVICE: device.id,
      },
    },
  },
});
const migratedSensorCondition = migrateWorkspaceState(
  staleSensorConditionState,
) as {blocks: {blocks: Array<{type?: string; inputs?: Record<string, {block?: {type?: string}}>}>}};
const migratedTrigger = migratedSensorCondition.blocks.blocks.find(
  (block) => block.type === 'sc_trigger',
);
assert(
  migratedTrigger?.inputs?.CONDITION?.block?.type === 'logic_compare',
  'Stale numeric sensor condition should be wrapped in a comparison',
);
const migratedWorkspace = new Blockly.Workspace();
Blockly.serialization.workspaces.load(migratedSensorCondition, migratedWorkspace);
migratedWorkspace.dispose();

const migratedCode = generateAllOpmodes([
  {id: 'stale-sensor', state: staleSensorConditionState},
]);
assertIncludes(migratedCode, 'Trigger(lambda:');
assertIncludes(migratedCode, 'self.drive_motor.getEncoderVelocity().get() > 0');

// ---------------------------------------------------------------------------
// Drivetrain wrappers: one set-movement-motors block owns the motor choices,
// and drive call blocks only supply movement values.
// ---------------------------------------------------------------------------

const rightMotor = addDevice({name: 'right_motor', bus: 4, deviceId: 2});
const rearLeftMotor = addDevice({name: 'rear_left_motor', bus: 5, deviceId: 3});
const frontRightMotor = addDevice({name: 'front_right_motor', bus: 6, deviceId: 4});
const rearRightMotor = addDevice({name: 'rear_right_motor', bus: 7, deviceId: 5});

const drivetrainWorkspace = new Blockly.Workspace();
const movementMotors = drivetrainWorkspace.newBlock('sc_movement_motors');
movementMotors.setFieldValue(
  serializeMovementMotorsConfig({
    kind: 'differential',
    leftDeviceId: device.id,
    rightDeviceId: rightMotor.id,
  }),
  'MOTORS',
);
assert(
  movementMotors.getField('MOTORS')?.constructor.name === 'FieldMovementMotors',
  'Movement motors block should use the popover summary field',
);

const drivetrainStart = drivetrainWorkspace.newBlock('sc_on_start');
const arcadeDrive = drivetrainWorkspace.newBlock('sc_drivetrain_arcade_drive');
assert(!arcadeDrive.getField('LEFT_DEVICE'), 'Drive blocks should not pick motors');
connectValue(arcadeDrive, 'FORWARD', numberBlock(30, drivetrainWorkspace));
connectValue(arcadeDrive, 'TURN', numberBlock(15, drivetrainWorkspace));
connectNext(drivetrainStart, arcadeDrive);

pythonGenerator.init(drivetrainWorkspace);
const drivetrainCode = generateOpmodeClass(drivetrainWorkspace, pythonGenerator);
assertIncludes(drivetrainCode, 'self.right_motor = A301(2, 4)');
assertIncludes(drivetrainCode, 'self.movement_drive = wpilib.DifferentialDrive(');
assertIncludes(drivetrainCode, 'lambda output: self.drive_motor.setThrottle(output),');
assertIncludes(drivetrainCode, 'lambda output: self.right_motor.setThrottle(output),');
assertIncludes(drivetrainCode, 'self.movement_drive.arcadeDrive(max(-1, min(1, (30) / 100.0)), max(-1, min(1, (15) / 100.0)))');

movementMotors.setFieldValue(
  serializeMovementMotorsConfig({
    kind: 'mecanum',
    frontLeftDeviceId: device.id,
    rearLeftDeviceId: rearLeftMotor.id,
    frontRightDeviceId: frontRightMotor.id,
    rearRightDeviceId: rearRightMotor.id,
  }),
  'MOTORS',
);
arcadeDrive.dispose(true);
const mecanumDrive = drivetrainWorkspace.newBlock('sc_mecanum_drive');
connectValue(mecanumDrive, 'SIDEWAYS', numberBlock(10, drivetrainWorkspace));
connectValue(mecanumDrive, 'FORWARD', numberBlock(20, drivetrainWorkspace));
connectValue(mecanumDrive, 'TURN', numberBlock(5, drivetrainWorkspace));
connectNext(drivetrainStart, mecanumDrive);

pythonGenerator.init(drivetrainWorkspace);
const mecanumCode = generateOpmodeClass(drivetrainWorkspace, pythonGenerator);
assertIncludes(mecanumCode, 'self.rear_left_motor = A301(3, 5)');
assertIncludes(mecanumCode, 'self.front_right_motor = A301(4, 6)');
assertIncludes(mecanumCode, 'self.rear_right_motor = A301(5, 7)');
assertIncludes(mecanumCode, 'self.movement_drive = wpilib.MecanumDrive(');
assertIncludes(mecanumCode, 'lambda output: self.rear_left_motor.setThrottle(output),');
assertIncludes(mecanumCode, 'lambda output: self.front_right_motor.setThrottle(output),');
assertIncludes(mecanumCode, 'lambda output: self.rear_right_motor.setThrottle(output),');
assertIncludes(mecanumCode, 'self.movement_drive.driveCartesian(max(-1, min(1, (10) / 100.0)), max(-1, min(1, (20) / 100.0)), max(-1, min(1, (5) / 100.0)))');
drivetrainWorkspace.dispose();

const motionCategory = toolbox.contents.find(
  (item) => item.kind === 'category' && (item as {name?: string}).name === 'Motors',
);
const motionBlocks = JSON.stringify(motionCategory ?? {});
assertIncludes(motionBlocks, 'sc_motor_set_power');
assertIncludes(motionBlocks, 'sc_motor_run_for_seconds');
assertIncludes(motionBlocks, 'sc_motor_stop');
assert(
  !motionBlocks.includes('sc_movement_motors') &&
    !motionBlocks.includes('sc_drivetrain_arcade_drive'),
  'Motors should keep motor blocks and not include drivetrain movement blocks',
);

const movementCategory = toolbox.contents.find(
  (item) =>
    item.kind === 'category' && (item as {name?: string}).name === 'Movement',
);
const movementBlocks = JSON.stringify(movementCategory ?? {});
assertIncludes(movementBlocks, 'sc_movement_motors');
assertIncludes(movementBlocks, 'sc_drivetrain_arcade_drive');
assertIncludes(movementBlocks, 'sc_drivetrain_tank_drive');
assertIncludes(movementBlocks, 'sc_drivetrain_stop');
assertIncludes(movementBlocks, 'sc_mecanum_drive');
assertIncludes(movementBlocks, 'sc_mecanum_stop');

// ---------------------------------------------------------------------------
// OpMode tabs: each tab is its own workspace + hat block, generating its own
// class. Two tabs => two classes.
// ---------------------------------------------------------------------------

const teleopTab = {id: 'a', state: makeOpmodeState('Teleop', 'Drive')};
const autoTab = {id: 'b', state: makeOpmodeState('Auto', 'Score')};
assert(opmodeInfoFromState(teleopTab.state).type === 'Teleop', 'Bad tab info parse');
assert(opmodeInfoFromState(autoTab.state).name === 'Score', 'Bad tab name parse');

const multiCode = generateAllOpmodes([teleopTab, autoTab]);
assertIncludes(multiCode, 'class Drive(wpilib.PeriodicOpMode):');
assertIncludes(multiCode, 'class Score(wpilib.PeriodicOpMode):');
assertIncludes(multiCode, '@teleop');
assertIncludes(multiCode, '@autonomous');
assertIncludes(multiCode, 'from robot import autonomous, teleop');

// ---------------------------------------------------------------------------
// Newly hand-wrapped WPILib APIs: the onboard IMU (gyro), match time, digital
// outputs and SmartDashboard telemetry. The IMU is a singleton built once in
// __init__; angles are surfaced in degrees.
// ---------------------------------------------------------------------------

const wpilibExtrasWorkspace = new Blockly.Workspace();
const extrasDetails = wpilibExtrasWorkspace.newBlock('sc_opmode_details');
extrasDetails.setFieldValue('Auto', 'TYPE');
extrasDetails.setFieldValue('TRUE', 'ENABLED');
extrasDetails.setFieldValue('Sensors Extra', 'NAME');

// IMU heading trigger drives a command stack.
const imuTrigger = wpilibExtrasWorkspace.newBlock('sc_wpilib_imu_trigger');
imuTrigger.setFieldValue('onTrue', 'MODE');
const imuThreshold = numberBlock(90, wpilibExtrasWorkspace);
connectValue(imuTrigger, 'THRESHOLD', imuThreshold);
const imuReset = wpilibExtrasWorkspace.newBlock('sc_wpilib_imu_reset');
connectNext(imuTrigger, imuReset);

// An "on start" stack: publish the IMU heading and match time to the dashboard.
const extrasStart = wpilibExtrasWorkspace.newBlock('sc_on_start');
const dashboardPut = wpilibExtrasWorkspace.newBlock('sc_wpilib_smartdashboard_put');
dashboardPut.setFieldValue('heading', 'KEY');
const imuHeading = wpilibExtrasWorkspace.newBlock('sc_wpilib_imu_value');
imuHeading.setFieldValue('HEADING', 'READING');
connectValue(dashboardPut, 'VALUE', imuHeading);
connectNext(extrasStart, dashboardPut);
const digitalOut = wpilibExtrasWorkspace.newBlock('sc_wpilib_digital_output_set');
digitalOut.setFieldValue('2', 'CHANNEL');
digitalOut.setFieldValue('ON', 'STATE');
dashboardPut.nextConnection!.connect(digitalOut.previousConnection!);

// Standalone value blocks: match time and the dashboard reader.
const matchTime = wpilibExtrasWorkspace.newBlock('sc_wpilib_match_time');
pythonGenerator.init(wpilibExtrasWorkspace);
const matchTimeCode = pythonGenerator.blockToCode(matchTime);
assert(Array.isArray(matchTimeCode), 'Match time should be a value expression');
assertIncludes(matchTimeCode[0], 'wpilib.Timer.getMatchTime()');
matchTime.dispose(true);

const dashboardGet = wpilibExtrasWorkspace.newBlock('sc_wpilib_smartdashboard_get');
dashboardGet.setFieldValue('target', 'KEY');
pythonGenerator.init(wpilibExtrasWorkspace);
const dashboardGetCode = pythonGenerator.blockToCode(dashboardGet);
assert(Array.isArray(dashboardGetCode), 'Dashboard get should be a value expression');
assertIncludes(dashboardGetCode[0], 'wpilib.SmartDashboard.getNumber("target", 0)');
dashboardGet.dispose(true);

pythonGenerator.init(wpilibExtrasWorkspace);
const extrasCode = generateOpmodeClass(wpilibExtrasWorkspace, pythonGenerator);
assertIncludes(
  extrasCode,
  'self.imu = wpilib.OnboardIMU(wpilib.OnboardIMU.MountOrientation.FLAT)',
);
assertIncludes(extrasCode, 'self.digital_output_2 = wpilib.DigitalOutput(2)');
assertIncludes(extrasCode, 'Trigger(lambda: math.degrees(self.imu.getYaw()) >= (90))');
assertIncludes(extrasCode, 'self.imu.reset()');
assertIncludes(extrasCode, 'wpilib.SmartDashboard.putNumber("heading", math.degrees(self.imu.getYaw()))');
assertIncludes(extrasCode, 'self.digital_output_2.set(True)');

// The IMU is a singleton: exactly one OnboardIMU construction even though three
// IMU blocks (trigger, reset, value) reference it.
assert(
  extrasCode.split('wpilib.OnboardIMU(').length - 1 === 1,
  'The onboard IMU should be constructed exactly once',
);

// Using the IMU pulls in `import math` for the degree conversion.
const extrasFullCode = generateAllOpmodes([
  {
    id: 'wpilib-extras',
    state: Blockly.serialization.workspaces.save(wpilibExtrasWorkspace),
  },
]);
assertIncludes(extrasFullCode, 'import math');
wpilibExtrasWorkspace.dispose();

// ---------------------------------------------------------------------------
// Advanced mode: a subsystem owns its motors and has its own Scratch-style
// event workspace. Command-event hats become Command factories that an OpMode
// selects through the subsystem/command block.
// ---------------------------------------------------------------------------

setRobotMode('advanced');
setMechanisms([]);
const legacySubsystem = addMechanism({
  name: 'legacy intake',
  motorIds: [device.id, rightMotor.id],
  state: {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'sc_subsystem_on_command',
          fields: {COMMAND: 'run'},
          next: {
            block: {
              type: 'sc_subsystem_set_power',
              inputs: {
                POWER: {
                  shadow: {type: 'math_number', fields: {NUM: 50}},
                },
              },
              next: {block: {type: 'sc_subsystem_stop'}},
            },
          },
        },
      ],
    },
  },
});
const migratedLegacyState = JSON.stringify(legacySubsystem.state);
assert(
  !migratedLegacyState.includes('sc_subsystem_set_power') &&
    !migratedLegacyState.includes('sc_subsystem_stop'),
  'Saved implicit subsystem-motor blocks should migrate to explicit groups',
);
assertIncludes(migratedLegacyState, 'sc_motor_group_set_power');
assertIncludes(migratedLegacyState, device.id);
assertIncludes(migratedLegacyState, rightMotor.id);
setMechanisms([]);
const intake = addMechanism({
  name: 'intake',
  motorIds: [device.id, rightMotor.id],
});
const makeMotorGroup = (targetWorkspace: Blockly.Workspace) => {
  const group = targetWorkspace.newBlock('sc_motor_group');
  group.setFieldValue(
    serializeMotorGroupConfig([device.id, rightMotor.id]),
    'MOTORS',
  );
  return group;
};
const subsystemWorkspace = new Blockly.Workspace();
const subsystemStart = subsystemWorkspace.newBlock('sc_subsystem_on_start');
const subsystemStartPower = subsystemWorkspace.newBlock('sc_motor_group_set_power');
connectValue(subsystemStartPower, 'GROUP', makeMotorGroup(subsystemWorkspace));
connectValue(subsystemStartPower, 'POWER', numberBlock(15, subsystemWorkspace));
connectNext(subsystemStart, subsystemStartPower);
const subsystemCommand = subsystemWorkspace.newBlock('sc_subsystem_on_command');
subsystemCommand.setFieldValue('intake_piece', 'COMMAND');
const subsystemPower = subsystemWorkspace.newBlock('sc_motor_group_set_power');
connectValue(subsystemPower, 'GROUP', makeMotorGroup(subsystemWorkspace));
connectValue(subsystemPower, 'POWER', numberBlock(65, subsystemWorkspace));
const subsystemStop = subsystemWorkspace.newBlock('sc_motor_group_stop');
connectValue(subsystemStop, 'GROUP', makeMotorGroup(subsystemWorkspace));
connectNext(subsystemCommand, subsystemPower);
subsystemPower.nextConnection!.connect(subsystemStop.previousConnection!);
const subsystemMotorPower = subsystemWorkspace.newBlock('sc_motor_set_power');
subsystemMotorPower.setFieldValue(device.id, 'DEVICE');
connectValue(subsystemMotorPower, 'POWER', numberBlock(40, subsystemWorkspace));
subsystemStop.nextConnection!.connect(subsystemMotorPower.previousConnection!);
const subsystemMovement = subsystemWorkspace.newBlock('sc_movement_motors');
subsystemMovement.setFieldValue(
  serializeMovementMotorsConfig({
    kind: 'differential',
    leftDeviceId: device.id,
    rightDeviceId: rightMotor.id,
  }),
  'MOTORS',
);
const subsystemDrive = subsystemWorkspace.newBlock('sc_drivetrain_arcade_drive');
connectValue(subsystemDrive, 'FORWARD', numberBlock(30, subsystemWorkspace));
connectValue(subsystemDrive, 'TURN', numberBlock(5, subsystemWorkspace));
subsystemMotorPower.nextConnection!.connect(subsystemDrive.previousConnection!);
updateMechanism(intake.id, {
  state: Blockly.serialization.workspaces.save(subsystemWorkspace),
});

const mechanismWorkspace = new Blockly.Workspace();
const mechanismDetails = mechanismWorkspace.newBlock('sc_opmode_details');
mechanismDetails.setFieldValue('Mechanism Test', 'NAME');
const mechanismStart = mechanismWorkspace.newBlock('sc_on_start');
const runIntake = mechanismWorkspace.newBlock('sc_mechanism_run_command');
runIntake.setFieldValue(intake.id, 'MECHANISM');
runIntake.setFieldValue('intake_piece', 'COMMAND');
connectNext(mechanismStart, runIntake);
pythonGenerator.init(mechanismWorkspace);
const mechanismCode = generateOpmodeClass(mechanismWorkspace, pythonGenerator);
assertIncludes(mechanismCode, 'self.intake = IntakeSubsystem()');
assertIncludes(mechanismCode, 'self.intake.on_start()');
assertIncludes(mechanismCode, 'self.intake.command_intake_piece()');
const mechanismFile = generateAllOpmodes([
  {id: 'mechanism-test', state: Blockly.serialization.workspaces.save(mechanismWorkspace)},
]);
assertIncludes(mechanismFile, 'class IntakeSubsystem(Mechanism):');
assertIncludes(mechanismFile, 'self.drive_motor = A301(0, 3)');
assertIncludes(mechanismFile, 'self.right_motor = A301(2, 4)');
assertIncludes(mechanismFile, 'self._motors = [self.drive_motor, self.right_motor]');
assertIncludes(mechanismFile, 'self.movement_drive = wpilib.DifferentialDrive(');
assertIncludes(mechanismFile, 'def on_start(self):');
assertIncludes(mechanismFile, 'def command_intake_piece(self):');
assertIncludes(mechanismFile, 'def set_motor_group_power(self, motors, power):');
assertIncludes(mechanismFile, 'for _motor in (self.drive_motor, self.right_motor):');
assertIncludes(mechanismFile, '_motor.setThrottle(max(-1, min(1, (65) / 100.0)))');
assertIncludes(mechanismFile, 'for _motor in (self.drive_motor, self.right_motor):');
assertIncludes(mechanismFile, '_motor.setThrottle(0)');
assertIncludes(mechanismFile, 'self.drive_motor.setThrottle(max(-1, min(1, (40) / 100.0)))');
assertIncludes(mechanismFile, 'self.movement_drive.arcadeDrive(max(-1, min(1, (30) / 100.0)), max(-1, min(1, (5) / 100.0)))');
const advancedToolbox = JSON.stringify(
  buildToolbox({includeGamepad: false, robotMode: 'advanced'}),
);
assertIncludes(advancedToolbox, 'sc_mechanism_run_command');
assert(
  !advancedToolbox.includes('sc_motor_set_power'),
  'Advanced OpMode toolbox should not bypass owned subsystem motors',
);
const subsystemToolbox = JSON.stringify(
  buildToolbox({includeGamepad: false, editor: 'subsystem', robotMode: 'advanced'}),
);
assertIncludes(subsystemToolbox, 'sc_subsystem_on_command');
assertIncludes(subsystemToolbox, 'sc_motor_group');
assertIncludes(subsystemToolbox, 'sc_motor_group_set_power');
assertIncludes(subsystemToolbox, 'sc_motor_group_stop');
assert(
  !subsystemToolbox.includes('sc_subsystem_set_power'),
  'Subsystem toolbox should not expose an implicit “my motors” command',
);
assertIncludes(subsystemToolbox, 'sc_motor_set_power');
assertIncludes(subsystemToolbox, 'sc_motor_run_for_seconds');
assertIncludes(subsystemToolbox, 'sc_motor_stop');
assertIncludes(subsystemToolbox, 'sc_motor_set_velocity');
assertIncludes(subsystemToolbox, 'sc_motor_set_position');
assertIncludes(subsystemToolbox, 'sc_movement_motors');
assertIncludes(subsystemToolbox, 'sc_drivetrain_arcade_drive');
assertIncludes(subsystemToolbox, 'sc_drivetrain_tank_drive');
assertIncludes(subsystemToolbox, 'sc_drivetrain_stop');
assertIncludes(subsystemToolbox, 'sc_mecanum_drive');
assertIncludes(subsystemToolbox, 'sc_mecanum_stop');
subsystemWorkspace.dispose();
mechanismWorkspace.dispose();
setMechanisms([]);
setRobotMode('simple');

// In Simple mode, the same explicit group compiles to a readable method with a
// loop, instead of relying on a hidden subsystem-wide motor selection.
const motorGroupWorkspace = new Blockly.Workspace();
const motorGroupDetails = motorGroupWorkspace.newBlock('sc_opmode_details');
motorGroupDetails.setFieldValue('Motor Group Test', 'NAME');
const motorGroupStart = motorGroupWorkspace.newBlock('sc_on_start');
const motorGroupPower = motorGroupWorkspace.newBlock('sc_motor_group_set_power');
connectValue(motorGroupPower, 'GROUP', makeMotorGroup(motorGroupWorkspace));
connectValue(motorGroupPower, 'POWER', numberBlock(70, motorGroupWorkspace));
connectNext(motorGroupStart, motorGroupPower);
pythonGenerator.init(motorGroupWorkspace);
const motorGroupCode = generateOpmodeClass(motorGroupWorkspace, pythonGenerator);
assertIncludes(motorGroupCode, 'def block_on_start(self):');
assertIncludes(motorGroupCode, 'for _motor in (self.drive_motor, self.right_motor):');
assertIncludes(motorGroupCode, '_motor.setThrottle(max(-1, min(1, (70) / 100.0))');
motorGroupWorkspace.dispose();

// ---------------------------------------------------------------------------
// Advanced libraries: named project objects replace the old free-text target.
// The object is constructed in every OpMode and instance blocks use its stable
// id, so a rename cannot silently point a block at a different RobotPy object.
// ---------------------------------------------------------------------------

setExtensionInstances([]);
const matchTimer = addExtensionInstance({
  className: 'wpilib.Timer',
  name: 'match_timer',
});
const extensionWorkspace = new Blockly.Workspace();
const extensionDetails = extensionWorkspace.newBlock('sc_opmode_details');
extensionDetails.setFieldValue('Library Test', 'NAME');
const extensionStart = extensionWorkspace.newBlock('sc_on_start');
const extensionCall = extensionWorkspace.newBlock('sc_ext_instance_call');
assert(
  extensionCall.getField('INSTANCE')?.constructor.name === 'FieldExtensionInstance',
  'Advanced instance calls should use the named-object dropdown',
);
extensionCall.setFieldValue('wpilib.Timer', 'CLASS');
extensionCall.setFieldValue(matchTimer.id, 'INSTANCE');
extensionCall.setFieldValue('restart', 'METHOD');
// ARGS is handled by mutator
connectNext(extensionStart, extensionCall);
pythonGenerator.init(extensionWorkspace);
const extensionCode = generateOpmodeClass(extensionWorkspace, pythonGenerator);
assertIncludes(extensionCode, 'self.match_timer = wpilib.Timer()');
assertIncludes(extensionCode, 'self.match_timer.restart()');
const extensionFile = generateAllOpmodes([
  {id: 'library-test', state: Blockly.serialization.workspaces.save(extensionWorkspace)},
]);
assertIncludes(extensionFile, 'import wpilib');
assertIncludes(extensionFile, 'Command.no_requirements().executing(self.block_on_start)');
extensionWorkspace.dispose();
setExtensionInstances([]);

// The WPILib Outputs curated extension is its own toolbox category, absent by
// default and present once added.
assert(
  !categoryNames.includes('WPILib Outputs'),
  'Default toolbox must not include the WPILib Outputs extension category',
);
const outputsCategoryNames = buildToolbox({
  includeGamepad: false,
  includeWpilibOutputs: true,
}).contents
  .filter((item) => item.kind === 'category')
  .map((item) => (item as {name?: string}).name);
assert(
  outputsCategoryNames.includes('WPILib Outputs'),
  'WPILib Outputs should appear after adding the curated extension',
);
const outputsToolbox = JSON.stringify(
  buildToolbox({includeGamepad: false, includeWpilibOutputs: true}),
);
assertIncludes(outputsToolbox, 'sc_wpilib_digital_output_set');
assertIncludes(outputsToolbox, 'sc_wpilib_smartdashboard_put');
assertIncludes(outputsToolbox, 'sc_wpilib_smartdashboard_get');
assert(
  !outputsToolbox.includes('sc_wpilib_digital_input'),
  'WPILib Outputs should not include the WPILib Sensors input blocks',
);

// The onboard IMU / match-time blocks ride along in the WPILib Sensors category.
assertIncludes(sensorsToolbox, 'sc_wpilib_imu_value');
assertIncludes(sensorsToolbox, 'sc_wpilib_match_time');

workspace.dispose();
console.log('Blockly smoke check passed');
