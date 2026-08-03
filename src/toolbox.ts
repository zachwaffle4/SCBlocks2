import { EXTENSIONS_TOOLBOX_CATEGORY } from './extensions';
import { SC_TYPED_VARIABLE_CATEGORY } from './variableCategory';

type ToolboxInput = {
  shadow?: ToolboxBlock;
  block?: ToolboxBlock;
};

type ToolboxBlock = {
  kind: 'block';
  type: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, ToolboxInput>;
  next?: {
    block: ToolboxBlock;
  };
};

const categoryCss = (name: string) => ({
  row: `blocklyToolboxCategory systemcore-category systemcore-category-${name}`,
});

const numberShadow = (value: number): ToolboxBlock => ({
  kind: 'block',
  type: 'math_number',
  fields: {
    NUM: value,
  },
});

const booleanBlock = (value = 'TRUE'): ToolboxBlock => ({
  kind: 'block',
  type: 'logic_boolean',
  fields: { BOOL: value },
});

const absoluteValueBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'math_single',
  fields: {
    OP: 'ABS',
  },
  inputs: {
    NUM: {
      shadow: numberShadow(-1),
    },
  },
});

const isWithinBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_operator_is_within',
  inputs: {
    VALUE: {
      shadow: numberShadow(0),
    },
    TOLERANCE: {
      shadow: numberShadow(1),
    },
    TARGET: {
      shadow: numberShadow(0),
    },
  },
});

// Motor blocks in the flyout leave DEVICE unset so the field defaults to the
// first registered motor (the motor list is managed in the Motors modal).
const runForSecondsBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_motor_run_for_seconds',
  inputs: {
    POWER: {
      shadow: numberShadow(40),
    },
    SECONDS: {
      shadow: numberShadow(1),
    },
  },
});

const stopMotorBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_motor_stop',
});

const setMotorPowerBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_motor_set_power',
  inputs: {
    POWER: {
      shadow: numberShadow(50),
    },
  },
});

const setMotorVelocityBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_motor_set_velocity',
  inputs: {
    VELOCITY: {
      shadow: numberShadow(1200),
    },
  },
});

const setMotorPositionBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_motor_set_position',
  inputs: {
    POSITION: {
      shadow: numberShadow(2),
    },
  },
});

const runMechanismCommandBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_mechanism_run_command',
});

const defaultOpmodeCommandBlock = (robotMode: 'simple' | 'advanced') =>
  robotMode === 'simple' ? runForSecondsBlock() : runMechanismCommandBlock();

const defaultOpmodeConditionBlock = (robotMode: 'simple' | 'advanced') =>
  robotMode === 'simple' ? sensorGreaterThanBlock(0) : booleanBlock();

const ifBlock = (condition: ToolboxBlock): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_if',
  inputs: {
    IF0: { block: condition },
  },
});

const movementMotorsBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_movement_motors',
});

const arcadeDriveBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_drivetrain_arcade_drive',
  inputs: {
    FORWARD: {
      shadow: numberShadow(40),
    },
    TURN: {
      shadow: numberShadow(0),
    },
  },
});

const tankDriveBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_drivetrain_tank_drive',
  inputs: {
    LEFT_POWER: {
      shadow: numberShadow(40),
    },
    RIGHT_POWER: {
      shadow: numberShadow(40),
    },
  },
});

const stopDrivetrainBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_drivetrain_stop',
});

const mecanumDriveBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_mecanum_drive',
  inputs: {
    SIDEWAYS: {
      shadow: numberShadow(0),
    },
    FORWARD: {
      shadow: numberShadow(40),
    },
    TURN: {
      shadow: numberShadow(0),
    },
  },
});

const stopMecanumBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_mecanum_stop',
});

const sensorValueBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_a301_sensor_value',
});

const digitalInputBlock = (channel = 0): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_digital_input',
  fields: {
    CHANNEL: channel,
  },
});

const analogInputBlock = (channel = 0): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_analog_input_value',
  fields: {
    CHANNEL: channel,
    READING: 'VOLTAGE',
  },
});

const encoderValueBlock = (aChannel = 0, bChannel = 1): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_encoder_value',
  fields: {
    A_CHANNEL: aChannel,
    B_CHANNEL: bChannel,
    READING: 'DISTANCE',
  },
});

const encoderResetBlock = (aChannel = 0, bChannel = 1): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_encoder_reset',
  fields: {
    A_CHANNEL: aChannel,
    B_CHANNEL: bChannel,
  },
});

const dutyCycleEncoderValueBlock = (channel = 0): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_duty_cycle_encoder_value',
  fields: {
    CHANNEL: channel,
  },
});

const dutyCycleEncoderConnectedBlock = (channel = 0): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_duty_cycle_encoder_connected',
  fields: {
    CHANNEL: channel,
  },
});

const analogEncoderBlock = (channel = 0): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_analog_encoder_value',
  fields: {
    CHANNEL: channel,
  },
});

const analogAccelerometerBlock = (channel = 0): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_analog_accelerometer_value',
  fields: {
    CHANNEL: channel,
  },
});

const analogPotentiometerBlock = (channel = 0): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_analog_potentiometer_value',
  fields: {
    CHANNEL: channel,
  },
});

const digitalInputTriggerBlock = (channel = 0): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_digital_input_trigger',
  fields: {
    CHANNEL: channel,
    MODE: 'onTrue',
  },
});

const analogInputTriggerBlock = (channel = 0): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_analog_input_trigger',
  fields: {
    CHANNEL: channel,
    READING: 'VOLTAGE',
    MODE: 'onTrue',
  },
  inputs: {
    THRESHOLD: {
      shadow: numberShadow(1),
    },
  },
});

const encoderTriggerBlock = (aChannel = 0, bChannel = 1): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_encoder_trigger',
  fields: {
    A_CHANNEL: aChannel,
    B_CHANNEL: bChannel,
    READING: 'DISTANCE',
    MODE: 'onTrue',
  },
  inputs: {
    THRESHOLD: {
      shadow: numberShadow(10),
    },
  },
});

const imuValueBlock = (reading = 'HEADING'): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_imu_value',
  fields: {
    READING: reading,
  },
});

const imuResetBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_imu_reset',
});

const imuTriggerBlock = (threshold = 90): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_imu_trigger',
  fields: {
    MODE: 'onTrue',
  },
  inputs: {
    THRESHOLD: {
      shadow: numberShadow(threshold),
    },
  },
});

const matchTimeBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_match_time',
});

const digitalOutputSetBlock = (channel = 0): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_digital_output_set',
  fields: {
    CHANNEL: channel,
    STATE: 'ON',
  },
});

const smartDashboardPutBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_smartdashboard_put',
  fields: {
    KEY: 'value',
  },
  inputs: {
    VALUE: {
      shadow: numberShadow(0),
    },
  },
});

const smartDashboardGetBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_wpilib_smartdashboard_get',
  fields: {
    KEY: 'value',
  },
});

const revColorSensorValueBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_rev_color_sensor_value',
  fields: {
    PORT: 'ONBOARD',
    READING: 'PROXIMITY',
  },
});

const revColorSensorStatusBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_rev_color_sensor_status',
  fields: {
    PORT: 'ONBOARD',
    STATUS: 'CONNECTED',
  },
});

const revColorSensorColorTriggerBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_rev_color_sensor_color_trigger',
  fields: {
    PORT: 'ONBOARD',
    COLOR: '#ff0000',
    MODE: 'onTrue',
  },
});

const revColorSensorSeesColorBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_rev_color_sensor_sees_color',
  fields: {
    PORT: 'ONBOARD',
    COLOR: '#ff0000',
  },
});

const revColorSensorProximityTriggerBlock = (): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_rev_color_sensor_proximity_trigger',
  fields: {
    PORT: 'ONBOARD',
    MODE: 'onTrue',
  },
  inputs: {
    THRESHOLD: {
      shadow: numberShadow(200),
    },
  },
});

const sensorGreaterThanBlock = (value: number): ToolboxBlock => ({
  kind: 'block',
  type: 'logic_compare',
  fields: {
    OP: 'GT',
  },
  inputs: {
    A: {
      block: sensorValueBlock(),
    },
    B: {
      shadow: numberShadow(value),
    },
  },
});

const gamepadButtonBlock = (button: string, state: string): ToolboxBlock => ({
  kind: 'block',
  type: 'sc_gamepad_button',
  fields: { GAMEPAD: '1', BUTTON: button, STATE: state },
});

// Only shown in Teleop opmodes (see buildToolbox / App.vue): reading driver
// input, and a ready-made "when a button is pressed, do …" gamepad trigger.
const gamepadCategory = {
  kind: 'category',
  name: 'Gamepad',
  categorystyle: 'sensing_category',
  cssConfig: categoryCss('sensing'),
  contents: [
    gamepadButtonBlock('SouthFace', 'Pressed'),
    {
      kind: 'block',
      type: 'sc_gamepad_axis',
      fields: { GAMEPAD: '1', AXIS: 'LeftY' },
    },
    {
      kind: 'block',
      type: 'sc_gamepad_trigger',
      fields: { GAMEPAD: '1', SIDE: 'Left' },
    },
    {
      kind: 'block',
      type: 'sc_trigger',
      inputs: {
        CONDITION: {
          block: gamepadButtonBlock('SouthFace', 'Pressed'),
        },
      },
      next: {
        block: stopMotorBlock(),
      },
    },
  ],
};

const wpilibSensorsCategory = {
  kind: 'category',
  name: 'WPILib Sensors',
  categorystyle: 'wpilib_sensors_category',
  cssConfig: categoryCss('wpilib-sensors'),
  contents: [
    imuTriggerBlock(90),
    digitalInputTriggerBlock(0),
    analogInputTriggerBlock(0),
    encoderTriggerBlock(0, 1),
    imuValueBlock('HEADING'),
    imuResetBlock(),
    matchTimeBlock(),
    digitalInputBlock(0),
    analogInputBlock(0),
    encoderValueBlock(0, 1),
    encoderResetBlock(0, 1),
    dutyCycleEncoderValueBlock(0),
    dutyCycleEncoderConnectedBlock(0),
    analogEncoderBlock(0),
    analogAccelerometerBlock(0),
    analogPotentiometerBlock(0),
  ],
};

const wpilibOutputsCategory = {
  kind: 'category',
  name: 'WPILib Outputs',
  categorystyle: 'wpilib_outputs_category',
  cssConfig: categoryCss('wpilib-outputs'),
  contents: [
    digitalOutputSetBlock(0),
    smartDashboardPutBlock(),
    smartDashboardGetBlock(),
  ],
};

const revSensorsCategory = {
  kind: 'category',
  name: 'REV Sensors',
  categorystyle: 'rev_sensors_category',
  cssConfig: categoryCss('rev-sensors'),
  contents: [
    revColorSensorColorTriggerBlock(),
    revColorSensorProximityTriggerBlock(),
    revColorSensorSeesColorBlock(),
    revColorSensorValueBlock(),
    revColorSensorStatusBlock(),
  ],
};

// Sensor trigger hats are OpMode-level event sources. Mechanisms can still
// react to the same readings with their `if` and `wait until` command blocks;
// keeping the hats out here avoids offering an event that has no owner in a
// subsystem class.
const mechanismSensorCategory = <T extends { contents: unknown[] }>(
  category: T,
) => ({
  ...category,
  contents: category.contents.filter(
    (item) =>
      [
        'sc_wpilib_digital_input_trigger',
        'sc_wpilib_analog_input_trigger',
        'sc_wpilib_encoder_trigger',
        'sc_wpilib_imu_trigger',
        'sc_rev_color_sensor_color_trigger',
        'sc_rev_color_sensor_proximity_trigger',
      ].indexOf((item as { type?: string }).type || '') === -1,
  ),
});

const mechanismWpilibSensorsCategory = mechanismSensorCategory(
  wpilibSensorsCategory,
);
const mechanismRevSensorsCategory = mechanismSensorCategory(revSensorsCategory);

const subsystemToolbox = ({
  includeWpilibSensors,
  includeWpilibOutputs,
  includeRevSensors,
}: {
  includeWpilibSensors: boolean;
  includeWpilibOutputs: boolean;
  includeRevSensors: boolean;
}) => ({
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Events',
      categorystyle: 'events_category',
      cssConfig: categoryCss('events'),
      contents: [
        {
          kind: 'block',
          type: 'sc_subsystem_on_start',
          next: { block: setMotorPowerBlock() },
        },
        {
          kind: 'block',
          type: 'sc_subsystem_on_command',
          next: { block: setMotorPowerBlock() },
        },
      ],
    },
    {
      kind: 'category',
      name: 'Motors',
      categorystyle: 'motion_category',
      cssConfig: categoryCss('motion'),
      contents: [
        setMotorPowerBlock(),
        runForSecondsBlock(),
        stopMotorBlock(),
        setMotorVelocityBlock(),
        setMotorPositionBlock(),
      ],
    },
    {
      kind: 'category',
      name: 'Movement',
      categorystyle: 'movement_category',
      cssConfig: categoryCss('movement'),
      contents: [
        movementMotorsBlock(),
        arcadeDriveBlock(),
        tankDriveBlock(),
        stopDrivetrainBlock(),
        mecanumDriveBlock(),
        stopMecanumBlock(),
      ],
    },
    {
      kind: 'category',
      name: 'Sensing',
      categorystyle: 'sensing_category',
      cssConfig: categoryCss('sensing'),
      contents: [sensorValueBlock()],
    },
    {
      kind: 'category',
      name: 'Control',
      categorystyle: 'control_category',
      cssConfig: categoryCss('control'),
      contents: [
        ifBlock(booleanBlock()),
        {
          kind: 'block',
          type: 'sc_wait_seconds',
          inputs: { SECONDS: { shadow: numberShadow(1) } },
        },
        {
          kind: 'block',
          type: 'sc_repeat_commands',
          inputs: {
            TIMES: { shadow: numberShadow(3) },
          },
        },
        {
          kind: 'block',
          type: 'sc_while_commands',
          inputs: {
            CONDITION: { shadow: booleanBlock() },
          },
        },
        { kind: 'block', type: 'sc_parallel_commands' },
        { kind: 'block', type: 'sc_race_commands' },
        { kind: 'block', type: 'sc_deadline_commands' },
        {
          kind: 'block',
          type: 'sc_wait_until',
          inputs: { CONDITION: { block: booleanBlock() } },
        },
      ],
    },
    ...(includeWpilibSensors ? [mechanismWpilibSensorsCategory] : []),
    ...(includeWpilibOutputs ? [wpilibOutputsCategory] : []),
    ...(includeRevSensors ? [mechanismRevSensorsCategory] : []),
    {
      kind: 'category',
      name: 'Operators',
      categorystyle: 'operators_category',
      cssConfig: categoryCss('operators'),
      contents: [
        numberShadow(0),
        {
          kind: 'block',
          type: 'math_arithmetic',
          inputs: {
            A: { shadow: numberShadow(1) },
            B: { shadow: numberShadow(1) },
          },
        },
        absoluteValueBlock(),
        {
          kind: 'block',
          type: 'math_number_property',
          inputs: { NUMBER_TO_CHECK: { shadow: numberShadow(0) } },
        },
        { kind: 'block', type: 'logic_compare' },
        isWithinBlock(),
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_boolean' },
      ],
    },
    {
      kind: 'category',
      name: 'Variables',
      categorystyle: 'variables_category',
      cssConfig: categoryCss('variables'),
      custom: SC_TYPED_VARIABLE_CATEGORY,
    },
    {
      kind: 'category',
      name: 'Extensions',
      categorystyle: 'advanced_category',
      cssConfig: categoryCss('advanced'),
      custom: EXTENSIONS_TOOLBOX_CATEGORY,
    },
  ],
});

export const buildToolbox = ({
  includeGamepad,
  includeWpilibSensors = false,
  includeWpilibOutputs = false,
  includeRevSensors = false,
  editor = 'opmode',
  robotMode = 'simple',
}: {
  includeGamepad: boolean;
  includeWpilibSensors?: boolean;
  includeWpilibOutputs?: boolean;
  includeRevSensors?: boolean;
  editor?: 'opmode' | 'subsystem';
  robotMode?: 'simple' | 'advanced';
}) => ({
  ...(editor === 'subsystem'
    ? subsystemToolbox({
        includeWpilibSensors,
        includeWpilibOutputs,
        includeRevSensors,
      })
    : {
        kind: 'categoryToolbox',
        contents: [
          {
            kind: 'category',
            name: 'OpMode',
            categorystyle: 'events_category',
            cssConfig: categoryCss('events'),
            contents: [
              // OpMode-scoped hats. Configure a tab from the OpMode button, put
              // project-wide hardware in Robot Setup, and use these only for a start
              // stack, advanced per-opmode setup, or an always-active trigger.
              {
                kind: 'block',
                type: 'sc_on_start',
                next: {
                  block: defaultOpmodeCommandBlock(robotMode),
                },
              },
              {
                kind: 'block',
                type: 'sc_on_setup',
              },
              {
                kind: 'block',
                type: 'sc_trigger',
                inputs: {
                  CONDITION: {
                    block: defaultOpmodeConditionBlock(robotMode),
                  },
                },
                next: {
                  block: defaultOpmodeCommandBlock(robotMode),
                },
              },
            ],
          },
          ...(robotMode === 'simple'
            ? [
                {
                  kind: 'category',
                  name: 'Motors',
                  categorystyle: 'motion_category',
                  cssConfig: categoryCss('motion'),
                  contents: [
                    setMotorPowerBlock(),
                    runForSecondsBlock(),
                    stopMotorBlock(),
                    setMotorVelocityBlock(),
                    setMotorPositionBlock(),
                  ],
                },
              ]
            : []),
          ...(robotMode === 'simple'
            ? [
                {
                  kind: 'category',
                  name: 'Movement',
                  categorystyle: 'movement_category',
                  cssConfig: categoryCss('movement'),
                  contents: [
                    movementMotorsBlock(),
                    arcadeDriveBlock(),
                    tankDriveBlock(),
                    stopDrivetrainBlock(),
                    mecanumDriveBlock(),
                    stopMecanumBlock(),
                  ],
                },
              ]
            : []),
          ...(robotMode === 'advanced'
            ? [
                {
                  kind: 'category',
                  name: 'Subsystems',
                  categorystyle: 'movement_category',
                  cssConfig: categoryCss('movement'),
                  contents: [runMechanismCommandBlock()],
                },
              ]
            : []),
          {
            kind: 'category',
            name: 'Control',
            categorystyle: 'control_category',
            cssConfig: categoryCss('control'),
            contents: [
              ifBlock(defaultOpmodeConditionBlock(robotMode)),
              {
                kind: 'block',
                type: 'sc_wait_seconds',
                inputs: {
                  SECONDS: {
                    shadow: numberShadow(1),
                  },
                },
              },
              {
                kind: 'block',
                type: 'sc_repeat_commands',
                inputs: {
                  TIMES: {
                    shadow: numberShadow(3),
                  },
                },
              },
              {
                kind: 'block',
                type: 'sc_while_commands',
                inputs: {
                  CONDITION: {
                    shadow: booleanBlock(),
                  },
                },
              },
              { kind: 'block', type: 'sc_parallel_commands' },
              { kind: 'block', type: 'sc_race_commands' },
              { kind: 'block', type: 'sc_deadline_commands' },
              {
                kind: 'block',
                type: 'sc_wait_until',
                inputs: {
                  CONDITION: {
                    block: defaultOpmodeConditionBlock(robotMode),
                  },
                },
              },
            ],
          },
          ...(robotMode === 'simple'
            ? [
                {
                  kind: 'category',
                  name: 'Sensing',
                  categorystyle: 'sensing_category',
                  cssConfig: categoryCss('sensing'),
                  contents: [sensorValueBlock()],
                },
              ]
            : []),
          ...(includeWpilibSensors ? [wpilibSensorsCategory] : []),
          ...(includeWpilibOutputs ? [wpilibOutputsCategory] : []),
          ...(includeRevSensors ? [revSensorsCategory] : []),
          ...(includeGamepad ? [gamepadCategory] : []),
          {
            kind: 'category',
            name: 'Operators',
            categorystyle: 'operators_category',
            cssConfig: categoryCss('operators'),
            contents: [
              numberShadow(0),
              {
                kind: 'block',
                type: 'math_arithmetic',
                inputs: {
                  A: {
                    shadow: numberShadow(1),
                  },
                  B: {
                    shadow: numberShadow(1),
                  },
                },
              },
              absoluteValueBlock(),
              {
                kind: 'block',
                type: 'math_number_property',
                inputs: {
                  NUMBER_TO_CHECK: {
                    shadow: numberShadow(0),
                  },
                },
              },
              {
                kind: 'block',
                type: 'logic_compare',
              },
              isWithinBlock(),
              {
                kind: 'block',
                type: 'logic_operation',
              },
              {
                kind: 'block',
                type: 'logic_boolean',
              },
            ],
          },
          {
            kind: 'category',
            name: 'Variables',
            categorystyle: 'variables_category',
            cssConfig: categoryCss('variables'),
            custom: SC_TYPED_VARIABLE_CATEGORY,
          },
          {
            kind: 'category',
            name: 'My Blocks',
            categorystyle: 'myblocks_category',
            cssConfig: categoryCss('myblocks'),
            custom: 'PROCEDURE',
          },
          {
            kind: 'category',
            name: 'Extensions',
            categorystyle: 'advanced_category',
            cssConfig: categoryCss('advanced'),
            // Escape hatch: the full generated RobotPy API is reachable here, but only
            // once a class is loaded as an extension. Nothing generated is in the
            // toolbox by default — the flyout is built dynamically in extensions.ts.
            custom: EXTENSIONS_TOOLBOX_CATEGORY,
          },
        ],
      }),
});

// Default toolbox (no gamepad category). App.vue swaps in the gamepad variant
// when the active opmode is a Teleop.
export const toolbox = buildToolbox({ includeGamepad: false });
