/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Blockly from "blockly/core";
import {
  FieldColour as BaseFieldColour,
  type FieldColourConfig,
  type FieldColourFromJsonConfig,
  type FieldColourValidator,
} from "@blockly/field-colour";
import { a301MethodOptions, A301_VALUE_METHODS } from "../generated/a301";
import { deviceField, movementMotorsField } from "../devices";
import { mechanismCommandField, mechanismField } from "../mechanisms";

const normalizeColour = (value: unknown) => {
  const named: Record<string, string> = {
    BLUE: "#0000ff",
    GREEN: "#00ff00",
    RED: "#ff0000",
  };
  const raw = String(value ?? "#ff0000").trim();
  return Blockly.utils.colour.parse(named[raw] ?? raw) ?? "#ff0000";
};

class ColourFieldDocumentShimElement {
  className = "";
  title = "";
  style: Record<string, string> = {};
  children: unknown[] = [];
  classList = {
    add() {},
    remove() {},
    toggle() {
      return false;
    },
  };

  append(...children: unknown[]) {
    this.children.push(...children);
  }

  appendChild(child: unknown) {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string) {
    (this as Record<string, unknown>)[name] = value;
  }
}

const makeColourFieldDocumentShimElement = () =>
  new ColourFieldDocumentShimElement() as unknown as HTMLElement;

const ensureColourFieldDocument = () => {
  if (typeof document !== "undefined") return;
  // @blockly/field-colour creates swatch elements in the constructor. The smoke
  // test instantiates blocks in Node without rendering, so a minimal shim is
  // enough for that non-browser path.
  const domGlobal = globalThis as typeof globalThis & {
    document: Document;
    Element: typeof Element;
    HTMLElement: typeof HTMLElement;
  };
  domGlobal.Element =
    ColourFieldDocumentShimElement as unknown as typeof Element;
  domGlobal.HTMLElement =
    ColourFieldDocumentShimElement as unknown as typeof HTMLElement;
  domGlobal.document = {
    createElement: makeColourFieldDocumentShimElement,
  } as unknown as Document;
};

const ensureColourFieldConfig = (config?: FieldColourConfig) => {
  ensureColourFieldDocument();
  return config;
};

enum ColourChannel {
  Red = "red",
  Green = "green",
  Blue = "blue",
}

class FieldColourSlider extends BaseFieldColour {
  static activateEyedropper_?: (callback: (colour: string) => void) => void;

  EYEDROPPER_PATH = "eyedropper.svg";

  override SERIALIZABLE = true;
  override EDITABLE = true;

  private redChangeEventKey_?: Blockly.browserEvents.Data;
  private greenChangeEventKey_?: Blockly.browserEvents.Data;
  private blueChangeEventKey_?: Blockly.browserEvents.Data;
  private eyedropperEventData_?: Blockly.browserEvents.Data;
  private redSlider_?: HTMLInputElement;
  private greenSlider_?: HTMLInputElement;
  private blueSlider_?: HTMLInputElement;
  private redReadout_?: Element;
  private greenReadout_?: Element;
  private blueReadout_?: Element;
  private red_ = 255;
  private green_ = 0;
  private blue_ = 0;

  constructor(
    value: unknown = "#ff0000",
    validator?: FieldColourValidator,
    config?: FieldColourConfig,
  ) {
    super(normalizeColour(value), validator, ensureColourFieldConfig(config));
  }

  static override fromJson(
    options: FieldColourFromJsonConfig,
  ): FieldColourSlider {
    const config = options as FieldColourFromJsonConfig & { text?: unknown };
    return new FieldColourSlider(
      config.colour ?? config.text,
      undefined,
      config,
    );
  }

  protected override doClassValidation_(newValue?: string): string | null {
    return normalizeColour(newValue);
  }

  protected override doValueUpdate_(newValue: string) {
    super.doValueUpdate_(newValue);
    this.updateSliderHandles_();
    this.updateDom_();
  }

  private createColourStops_(channel: ColourChannel) {
    const stops = [];
    for (let n = 0; n <= 255; n += 17) {
      const red = channel === ColourChannel.Red ? n : this.red_;
      const green = channel === ColourChannel.Green ? n : this.green_;
      const blue = channel === ColourChannel.Blue ? n : this.blue_;
      stops.push(Blockly.utils.colour.rgbToHex(red, green, blue));
    }
    return stops;
  }

  private setGradient_(node: HTMLElement, channel: ColourChannel) {
    node.style.background = `linear-gradient(to right, ${this.createColourStops_(
      channel,
    ).join(",")})`;
  }

  private updateDom_() {
    const redSlider = this.redSlider_;
    const greenSlider = this.greenSlider_;
    const blueSlider = this.blueSlider_;
    const redReadout = this.redReadout_;
    const greenReadout = this.greenReadout_;
    const blueReadout = this.blueReadout_;
    if (
      !redSlider ||
      !greenSlider ||
      !blueSlider ||
      !redReadout ||
      !greenReadout ||
      !blueReadout
    ) {
      return;
    }

    this.setGradient_(redSlider, ColourChannel.Red);
    this.setGradient_(greenSlider, ColourChannel.Green);
    this.setGradient_(blueSlider, ColourChannel.Blue);
    redReadout.textContent = `${this.red_}`;
    greenReadout.textContent = `${this.green_}`;
    blueReadout.textContent = `${this.blue_}`;
  }

  private updateSliderHandles_() {
    if (!this.redSlider_ || !this.greenSlider_ || !this.blueSlider_) {
      return;
    }
    this.redSlider_.value = `${this.red_}`;
    this.greenSlider_.value = `${this.green_}`;
    this.blueSlider_.value = `${this.blue_}`;
  }

  private createLabelDom_(labelText: string): [Element, Element] {
    const labelContainer = document.createElement("div");
    labelContainer.className = "scratchColourPickerLabel";
    const label = document.createElement("span");
    label.className = "scratchColourPickerLabelText";
    label.textContent = labelText;
    const readout = document.createElement("span");
    readout.className = "scratchColourPickerReadout";
    labelContainer.append(label, readout);
    return [labelContainer, readout];
  }

  private sliderCallbackFactory_(channel: ColourChannel) {
    return (event: Event) => {
      const channelValue = Math.round(
        Number((event.target as HTMLInputElement).value),
      );
      switch (channel) {
        case ColourChannel.Red:
          this.red_ = channelValue;
          break;
        case ColourChannel.Green:
          this.green_ = channelValue;
          break;
        case ColourChannel.Blue:
          this.blue_ = channelValue;
          break;
      }
      this.setValue(
        Blockly.utils.colour.rgbToHex(this.red_, this.green_, this.blue_),
        true,
      );
    };
  }

  private activateEyedropperInternal_() {
    FieldColourSlider.activateEyedropper_?.((chosenColour: string) => {
      this.syncSlidersFromColour_(chosenColour);
      this.setValue(chosenColour);
    });
  }

  private syncSlidersFromColour_(colour: string) {
    const [red, green, blue] = Blockly.utils.colour.hexToRgb(
      normalizeColour(colour),
    );
    this.red_ = red;
    this.green_ = green;
    this.blue_ = blue;
  }

  protected override showEditor_() {
    this.disposeSliderEvents_();
    Blockly.DropDownDiv.hideWithoutAnimation();
    Blockly.DropDownDiv.clearContent();
    const div = Blockly.DropDownDiv.getContentDiv();
    div.className = "blocklyDropDownContent scratchColourPicker";

    const currentValue = this.getValue() ?? "#ff0000";
    this.syncSlidersFromColour_(currentValue);

    const redElements = this.createLabelDom_("Red");
    div.appendChild(redElements[0]);
    this.redReadout_ = redElements[1];
    this.redSlider_ = document.createElement("input");
    this.redSlider_.type = "range";
    this.redSlider_.min = "0";
    this.redSlider_.max = "255";
    this.redSlider_.className = "scratchColourSlider";
    div.appendChild(this.redSlider_);

    const greenElements = this.createLabelDom_("Green");
    div.appendChild(greenElements[0]);
    this.greenReadout_ = greenElements[1];
    this.greenSlider_ = document.createElement("input");
    this.greenSlider_.type = "range";
    this.greenSlider_.min = "0";
    this.greenSlider_.max = "255";
    this.greenSlider_.className = "scratchColourSlider";
    div.appendChild(this.greenSlider_);

    const blueElements = this.createLabelDom_("Blue");
    div.appendChild(blueElements[0]);
    this.blueReadout_ = blueElements[1];
    this.blueSlider_ = document.createElement("input");
    this.blueSlider_.type = "range";
    this.blueSlider_.min = "0";
    this.blueSlider_.max = "255";
    this.blueSlider_.className = "scratchColourSlider";
    div.appendChild(this.blueSlider_);

    if (FieldColourSlider.activateEyedropper_) {
      const button = document.createElement("button");
      button.className = "scratchEyedropper";
      const image = document.createElement("img");
      const workspace = Blockly.getMainWorkspace();
      image.src = `${workspace.options.pathToMedia}${this.EYEDROPPER_PATH}`;
      button.appendChild(image);
      div.appendChild(button);
      this.eyedropperEventData_ = Blockly.browserEvents.conditionalBind(
        button,
        "click",
        this,
        this.activateEyedropperInternal_.bind(this),
      );
    }

    Blockly.DropDownDiv.setColour("#ffffff", "#dddddd");
    Blockly.DropDownDiv.showPositionedByBlock(
      this as unknown as Blockly.Field,
      this.getSourceBlock() as Blockly.BlockSvg,
      this.disposeSliderEvents_.bind(this),
    );

    this.updateSliderHandles_();
    this.updateDom_();
    this.redChangeEventKey_ = Blockly.browserEvents.bind(
      this.redSlider_,
      "input",
      this,
      this.sliderCallbackFactory_(ColourChannel.Red),
    );
    this.greenChangeEventKey_ = Blockly.browserEvents.bind(
      this.greenSlider_,
      "input",
      this,
      this.sliderCallbackFactory_(ColourChannel.Green),
    );
    this.blueChangeEventKey_ = Blockly.browserEvents.bind(
      this.blueSlider_,
      "input",
      this,
      this.sliderCallbackFactory_(ColourChannel.Blue),
    );
  }

  private disposeSliderEvents_() {
    if (this.redChangeEventKey_) {
      Blockly.browserEvents.unbind(this.redChangeEventKey_);
      this.redChangeEventKey_ = undefined;
    }
    if (this.greenChangeEventKey_) {
      Blockly.browserEvents.unbind(this.greenChangeEventKey_);
      this.greenChangeEventKey_ = undefined;
    }
    if (this.blueChangeEventKey_) {
      Blockly.browserEvents.unbind(this.blueChangeEventKey_);
      this.blueChangeEventKey_ = undefined;
    }
    if (this.eyedropperEventData_) {
      Blockly.browserEvents.unbind(this.eyedropperEventData_);
      this.eyedropperEventData_ = undefined;
    }
  }

  override dispose() {
    this.disposeSliderEvents_();
    super.dispose();
  }
}

Blockly.registry.register(
  Blockly.registry.Type.FIELD,
  "field_colour",
  FieldColourSlider,
  true,
);

Blockly.registry.register(
  Blockly.registry.Type.FIELD,
  "field_colour_slider",
  FieldColourSlider,
  true,
);

const eventsColour = "#FFBF00";
const motionColour = "#4C97FF";
const movementColour = "#FF4DCD";
const controlColour = "#FFAB19";
const sensingColour = "#5CB1D6";
const operatorsColour = "#59C059";
const wpilibColour = "#FF4C4C";
const wpilibOutputsColour = "#0FBC9B";
const revColorSensorColour = "#FF5418";
const advancedColour = "#5C81A6";

const channelField = (name: string, value: number) => ({
  type: "field_number",
  name,
  value,
  min: 0,
  precision: 1,
});

const i2cPortField = () => ({
  type: "field_dropdown",
  name: "PORT",
  options: [
    ["onboard I2C", "ONBOARD"],
    ["MXP I2C", "MXP"],
  ],
});

// The opmode is described by several independent, opmode-scoped hat blocks that
// each live at the top of the tab's workspace, rather than one consolidated
// block: a details hat (config), a setup hat, one or more "on start" hats, and
// any number of trigger hats.

const scOpmodeDetails = {
  type: "sc_opmode_details",
  message0: "%1 opmode   enabled %2",
  args0: [
    {
      type: "field_dropdown",
      name: "TYPE",
      // Values must match the Python decorator names (Teleop / Auto / Utility).
      options: [
        ["teleop", "Teleop"],
        ["autonomous", "Auto"],
        ["utility", "Utility"],
      ],
    },
    {
      type: "field_checkbox",
      name: "ENABLED",
      checked: true,
    },
  ],
  message1: "name %1",
  args1: [
    {
      type: "field_input",
      name: "NAME",
      text: "My OpMode",
      spellcheck: false,
    },
  ],
  message2: "group %1 description %2",
  args2: [
    {
      type: "field_input",
      name: "GROUP",
      text: "",
      spellcheck: false,
    },
    {
      type: "field_input",
      name: "DESCRIPTION",
      text: "",
      spellcheck: false,
    },
  ],
  colour: eventsColour,
  tooltip:
    "OpMode configuration. Each OpMode (tab) becomes its own decorated Python class (teleop, autonomous, or utility).",
  helpUrl: "",
};

const scOnSetup = {
  type: "sc_on_setup",
  message0: "set up this OpMode",
  hat: true,
  nextStatement: "Setup",
  colour: motionColour,
  tooltip:
    "Runs direct setup lines while this OpMode is constructed. Motors and mechanisms belong in Robot Setup instead.",
  helpUrl: "",
};

const scOnStart = {
  type: "sc_on_start",
  message0: "when this opmode starts",
  hat: true,
  nextStatement: "Command",
  colour: eventsColour,
  tooltip:
    "Runs the commands attached below when the OpMode starts. Separate start hats run in parallel.",
  helpUrl: "",
};

const scTrigger = {
  type: "sc_trigger",
  message0: "%1 %2",
  args0: [
    {
      type: "field_dropdown",
      name: "MODE",
      options: [
        ["when", "onTrue"],
        ["while", "whileTrue"],
      ],
    },
    {
      type: "input_value",
      name: "CONDITION",
      check: "Boolean",
    },
  ],
  inputsInline: true,
  hat: true,
  nextStatement: "Command",
  colour: eventsColour,
  tooltip:
    "Opmode-scoped trigger: schedules commands when any condition becomes true.",
  helpUrl: "",
};

const scMotorSetPower = {
  type: "sc_motor_set_power",
  message0: "set %1 power to %2 %",
  args0: [
    deviceField(),
    {
      type: "input_value",
      name: "POWER",
      check: "Number",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: motionColour,
  tooltip: "Sets an A301 motor throttle. Use -100 to 100.",
  helpUrl: "",
};

const scMotorRunForSeconds = {
  type: "sc_motor_run_for_seconds",
  message0: "run %1 at %2 % for %3 seconds",
  args0: [
    deviceField(),
    {
      type: "input_value",
      name: "POWER",
      check: "Number",
    },
    {
      type: "input_value",
      name: "SECONDS",
      check: "Number",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: motionColour,
  tooltip: "Runs an A301 motor, waits, then stops it.",
  helpUrl: "",
};

const scMotorStop = {
  type: "sc_motor_stop",
  message0: "stop %1",
  args0: [deviceField()],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: motionColour,
  tooltip: "Stops an A301 motor by setting its throttle to zero.",
  helpUrl: "",
};

const scMotorSetVelocity = {
  type: "sc_motor_set_velocity",
  message0: "set %1 speed to %2 RPM",
  args0: [
    deviceField(),
    {
      type: "input_value",
      name: "VELOCITY",
      check: "Number",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: motionColour,
  tooltip: "Asks the A301 to drive to a velocity setpoint.",
  helpUrl: "",
};

const scMotorSetPosition = {
  type: "sc_motor_set_position",
  message0: "move %1 to %2 rotations",
  args0: [
    deviceField(),
    {
      type: "input_value",
      name: "POSITION",
      check: "Number",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: motionColour,
  tooltip: "Asks the A301 to drive to a position setpoint.",
  helpUrl: "",
};

// Mechanisms are project-level commands3 subsystems. They are configured in
// Robot Setup instead of being re-created in every OpMode, then these blocks
// create commands that require the selected subsystem.
const scMechanismSetPower = {
  type: "sc_mechanism_set_power",
  message0: "set mechanism %1 power to %2 %",
  args0: [
    mechanismField(),
    {
      type: "input_value",
      name: "POWER",
      check: "Number",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: movementColour,
  tooltip:
    "Sets every motor in this commands3 subsystem. The command reserves the mechanism while it runs.",
  helpUrl: "",
};

const scMechanismStop = {
  type: "sc_mechanism_stop",
  message0: "stop mechanism %1",
  args0: [mechanismField()],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: movementColour,
  tooltip: "Stops every motor in this commands3 subsystem.",
  helpUrl: "",
};

// Advanced subsystem workspaces use Scratch-style event hats. These blocks are
// only shown while editing a subsystem; the command body is later exposed to
// OpModes through the matching “run subsystem command” block.
const scSubsystemOnStart = {
  type: "sc_subsystem_on_start",
  message0: "when this subsystem starts",
  hat: true,
  nextStatement: "Command",
  colour: eventsColour,
  tooltip: "Runs when the owning OpMode starts.",
  helpUrl: "",
};

const scSubsystemOnCommand = {
  type: "sc_subsystem_on_command",
  message0: "when I'm told to %1",
  args0: [
    {
      type: "field_input",
      name: "COMMAND",
      text: "run",
      spellcheck: false,
    },
  ],
  hat: true,
  nextStatement: "Command",
  colour: eventsColour,
  tooltip:
    "Defines a reusable subsystem command. It becomes selectable in an OpMode's Subsystems drawer.",
  helpUrl: "",
};

const scMechanismRunCommand = {
  type: "sc_mechanism_run_command",
  message0: "tell %1 to %2",
  args0: [mechanismField(), mechanismCommandField()],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: movementColour,
  tooltip: "Schedules a command defined in this subsystem's event workspace.",
  helpUrl: "",
};

const scMovementMotors = {
  type: "sc_movement_motors",
  message0: "set movement motors %1",
  args0: [movementMotorsField()],
  previousStatement: "Setup",
  nextStatement: "Setup",
  colour: movementColour,
  tooltip:
    "Choose the motors used by movement drive blocks. Click the summary to edit.",
  helpUrl: "",
};

const scDrivetrainArcadeDrive = {
  type: "sc_drivetrain_arcade_drive",
  message0: "arcade drive forward %1 % turn %2 %",
  args0: [
    {
      type: "input_value",
      name: "FORWARD",
      check: "Number",
    },
    {
      type: "input_value",
      name: "TURN",
      check: "Number",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: movementColour,
  tooltip: "Uses wpilib.DifferentialDrive arcade_drive with two A301 motors.",
  helpUrl: "",
};

const scDrivetrainTankDrive = {
  type: "sc_drivetrain_tank_drive",
  message0: "tank drive left power %1 % right power %2 %",
  args0: [
    {
      type: "input_value",
      name: "LEFT_POWER",
      check: "Number",
    },
    {
      type: "input_value",
      name: "RIGHT_POWER",
      check: "Number",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: movementColour,
  tooltip: "Uses wpilib.DifferentialDrive tank_drive with two A301 motors.",
  helpUrl: "",
};

const scDrivetrainStop = {
  type: "sc_drivetrain_stop",
  message0: "stop movement motors",
  previousStatement: "Command",
  nextStatement: "Command",
  colour: movementColour,
  tooltip: "Stops the configured movement motors.",
  helpUrl: "",
};

const scMecanumDrive = {
  type: "sc_mecanum_drive",
  message0: "mecanum drive sideways %1 % forward %2 % turn %3 %",
  args0: [
    {
      type: "input_value",
      name: "SIDEWAYS",
      check: "Number",
    },
    {
      type: "input_value",
      name: "FORWARD",
      check: "Number",
    },
    {
      type: "input_value",
      name: "TURN",
      check: "Number",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: movementColour,
  tooltip: "Uses wpilib.MecanumDrive drive_cartesian with four A301 motors.",
  helpUrl: "",
};

const scMecanumStop = {
  type: "sc_mecanum_stop",
  message0: "stop mecanum movement",
  previousStatement: "Command",
  nextStatement: "Command",
  colour: movementColour,
  tooltip: "Stops the configured mecanum movement motors.",
  helpUrl: "",
};

const scWaitSeconds = {
  type: "sc_wait_seconds",
  message0: "wait %1 seconds",
  args0: [
    {
      type: "input_value",
      name: "SECONDS",
      check: "Number",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: controlColour,
  tooltip: "Waits inside the generated command sequence.",
  helpUrl: "",
};

const scRepeatCommands = {
  type: "sc_repeat_commands",
  message0: "repeat %1 times",
  args0: [
    {
      type: "input_value",
      name: "TIMES",
      check: "Number",
    },
  ],
  message1: "do %1",
  args1: [
    {
      type: "input_statement",
      name: "COMMANDS",
      check: "Command",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: controlColour,
  tooltip: "Repeats command blocks as a command-based sequence.",
  helpUrl: "",
};

const scWhileCommands = {
  type: "sc_while_commands",
  message0: "repeat while %1",
  args0: [
    {
      type: "input_value",
      name: "CONDITION",
      check: "Boolean",
    },
  ],
  message1: "do %1",
  args1: [
    {
      type: "input_statement",
      name: "COMMANDS",
      check: "Command",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: controlColour,
  tooltip: "Repeats command blocks while a condition is true.",
  helpUrl: "",
};

const scParallelCommands = {
  type: "sc_parallel_commands",
  message0: "do both at the same time",
  message1: "%1 %2",
  args1: [
    {
      type: "input_statement",
      name: "FIRST",
      check: "Command",
    },
    {
      type: "input_statement",
      name: "SECOND",
      check: "Command",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: controlColour,
  tooltip: "Runs two command stacks at the same time.",
  inputsInline: true,
  helpUrl: "",
};

const scRaceCommands = {
  type: "sc_race_commands",
  message0: "race commands until one finishes",
  message1: "%1 %2",
  args1: [
    {
      type: "input_statement",
      name: "FIRST",
      check: "Command",
    },
    {
      type: "input_statement",
      name: "SECOND",
      check: "Command",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: controlColour,
  tooltip: "Runs two command stacks and ends when either one finishes.",
  inputsInline: true,
  helpUrl: "",
};

const scDeadlineCommands = {
  type: "sc_deadline_commands",
  message0: "run left deadline with right commands until it finishes",
  message1: "%1 %2",
  args1: [
    {
      type: "input_statement",
      name: "DEADLINE",
      check: "Command",
    },
    {
      type: "input_statement",
      name: "OTHER",
      check: "Command",
    },
  ],
  inputsInline: true,
  previousStatement: "Command",
  nextStatement: "Command",
  colour: controlColour,
  tooltip:
    "Runs both command stacks together and ends when the deadline stack finishes.",
  helpUrl: "",
};

const scWaitUntil = {
  type: "sc_wait_until",
  message0: "wait until %1",
  args0: [
    {
      type: "input_value",
      name: "CONDITION",
      check: "Boolean",
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: controlColour,
  tooltip: "Waits inside the command sequence until a condition is true.",
  helpUrl: "",
};

// The standard Blockly if mutator gives this block optional else-if and else
// branches. Its statement connections deliberately accept either context: in a
// command stack it becomes a Commands3 ConditionalCommand, while inside an
// OpMode setup hat it is ordinary Python control flow.
const scIf = {
  type: "sc_if",
  message0: "if %1",
  args0: [
    {
      type: "input_value",
      name: "IF0",
      check: "Boolean",
    },
  ],
  message1: "then %1",
  args1: [
    {
      type: "input_statement",
      name: "DO0",
      check: ["Command", "Setup"],
    },
  ],
  previousStatement: ["Command", "Setup"],
  nextStatement: ["Command", "Setup"],
  style: "control_blocks",
  mutator: "controls_if_mutator",
  tooltip:
    "In a command stack, chooses a Commands3 command group. In OpMode setup, generates a normal Python if statement.",
  helpUrl: "",
};

const scA301SensorValue = {
  type: "sc_a301_sensor_value",
  message0: "%1 %2",
  args0: [
    deviceField(),
    {
      type: "field_dropdown",
      name: "SENSOR",
      options: [
        ["speed RPM", "VELOCITY"],
        ["position rotations", "POSITION"],
        ["absolute position", "ABSOLUTE_POSITION"],
        ["temperature C", "TEMPERATURE"],
        ["current amps", "CURRENT"],
        ["power %", "POWER"],
        ["bus voltage", "BUS_VOLTAGE"],
      ],
    },
  ],
  output: "Number",
  colour: sensingColour,
  tooltip: "Reads a value from an A301 motor.",
  helpUrl: "",
};

const scOperatorIsWithin = {
  type: "sc_operator_is_within",
  message0: "%1 is within %2 of %3",
  args0: [
    {
      type: "input_value",
      name: "VALUE",
      check: "Number",
    },
    {
      type: "input_value",
      name: "TOLERANCE",
      check: "Number",
    },
    {
      type: "input_value",
      name: "TARGET",
      check: "Number",
    },
  ],
  inputsInline: true,
  output: "Boolean",
  colour: operatorsColour,
  tooltip: "Checks whether a number is close enough to a target value.",
  helpUrl: "",
};

// --- Hand-wrapped sensor extensions ------------------------------------------
// These are beginner blocks for common sensor classes. They only appear after
// their curated extension is added from the picker; codegen auto-creates the
// matching sensor object in __init__.

const scWpilibDigitalInput = {
  type: "sc_wpilib_digital_input",
  message0: "digital input %1 is on",
  args0: [channelField("CHANNEL", 0)],
  output: "Boolean",
  colour: wpilibColour,
  tooltip: "Reads a wpilib.DigitalInput channel.",
  helpUrl: "",
};

const scWpilibAnalogInputValue = {
  type: "sc_wpilib_analog_input_value",
  message0: "analog input %1 %2",
  args0: [
    channelField("CHANNEL", 0),
    {
      type: "field_dropdown",
      name: "READING",
      options: [
        ["voltage", "VOLTAGE"],
        ["raw value", "VALUE"],
      ],
    },
  ],
  output: "Number",
  colour: wpilibColour,
  tooltip: "Reads a wpilib.AnalogInput channel.",
  helpUrl: "",
};

const scWpilibEncoderValue = {
  type: "sc_wpilib_encoder_value",
  message0: "encoder ports %1 and %2 %3",
  args0: [
    channelField("A_CHANNEL", 0),
    channelField("B_CHANNEL", 1),
    {
      type: "field_dropdown",
      name: "READING",
      options: [
        ["distance", "DISTANCE"],
        ["rate", "RATE"],
        ["count", "COUNT"],
      ],
    },
  ],
  output: "Number",
  colour: wpilibColour,
  tooltip: "Reads a wpilib.Encoder attached to two DIO channels.",
  helpUrl: "",
};

const scWpilibEncoderReset = {
  type: "sc_wpilib_encoder_reset",
  message0: "reset encoder ports %1 and %2",
  args0: [channelField("A_CHANNEL", 0), channelField("B_CHANNEL", 1)],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: wpilibColour,
  tooltip: "Resets a wpilib.Encoder attached to two DIO channels.",
  helpUrl: "",
};

const scWpilibDutyCycleEncoderValue = {
  type: "sc_wpilib_duty_cycle_encoder_value",
  message0: "duty cycle encoder %1 position",
  args0: [channelField("CHANNEL", 0)],
  output: "Number",
  colour: wpilibColour,
  tooltip: "Reads a wpilib.DutyCycleEncoder absolute position.",
  helpUrl: "",
};

const scWpilibDutyCycleEncoderConnected = {
  type: "sc_wpilib_duty_cycle_encoder_connected",
  message0: "duty cycle encoder %1 is connected",
  args0: [channelField("CHANNEL", 0)],
  output: "Boolean",
  colour: wpilibColour,
  tooltip: "Checks whether a wpilib.DutyCycleEncoder is connected.",
  helpUrl: "",
};

const scWpilibAnalogEncoderValue = {
  type: "sc_wpilib_analog_encoder_value",
  message0: "analog encoder %1 position",
  args0: [channelField("CHANNEL", 0)],
  output: "Number",
  colour: wpilibColour,
  tooltip: "Reads a wpilib.AnalogEncoder position.",
  helpUrl: "",
};

const scWpilibAnalogAccelerometerValue = {
  type: "sc_wpilib_analog_accelerometer_value",
  message0: "analog accelerometer %1 acceleration",
  args0: [channelField("CHANNEL", 0)],
  output: "Number",
  colour: wpilibColour,
  tooltip: "Reads acceleration from a wpilib.AnalogAccelerometer.",
  helpUrl: "",
};

const scWpilibAnalogPotentiometerValue = {
  type: "sc_wpilib_analog_potentiometer_value",
  message0: "analog potentiometer %1 position",
  args0: [channelField("CHANNEL", 0)],
  output: "Number",
  colour: wpilibColour,
  tooltip: "Reads a wpilib.AnalogPotentiometer.",
  helpUrl: "",
};

// --- WPILib sensor triggers --------------------------------------------------
// Opmode-scoped "when <sensor condition>, do …" hats, mirroring the REV color
// sensor triggers. They share the MODE / COMMANDS shape of sc_trigger so codegen
// can treat them uniformly (see generators/python.ts).

const scWpilibDigitalInputTrigger = {
  type: "sc_wpilib_digital_input_trigger",
  message0: "%1 digital input %2 is on",
  args0: [
    {
      type: "field_dropdown",
      name: "MODE",
      options: [
        ["when", "onTrue"],
        ["while", "whileTrue"],
      ],
    },
    channelField("CHANNEL", 0),
  ],
  inputsInline: true,
  hat: true,
  nextStatement: "Command",
  colour: wpilibColour,
  tooltip: "Runs commands when a wpilib.DigitalInput channel reads on.",
  helpUrl: "",
};

const scWpilibAnalogInputTrigger = {
  type: "sc_wpilib_analog_input_trigger",
  message0: "%1 analog input %2 %3 is at least %4",
  args0: [
    {
      type: "field_dropdown",
      name: "MODE",
      options: [
        ["when", "onTrue"],
        ["while", "whileTrue"],
      ],
    },
    channelField("CHANNEL", 0),
    {
      type: "field_dropdown",
      name: "READING",
      options: [
        ["voltage", "VOLTAGE"],
        ["raw value", "VALUE"],
      ],
    },
    {
      type: "input_value",
      name: "THRESHOLD",
      check: "Number",
    },
  ],
  inputsInline: true,
  hat: true,
  nextStatement: "Command",
  colour: wpilibColour,
  tooltip:
    "Runs commands when a wpilib.AnalogInput reading reaches the threshold.",
  helpUrl: "",
};

const scWpilibEncoderTrigger = {
  type: "sc_wpilib_encoder_trigger",
  message0: "%1 encoder ports %2 and %3 %4 is at least %5",
  args0: [
    {
      type: "field_dropdown",
      name: "MODE",
      options: [
        ["when", "onTrue"],
        ["while", "whileTrue"],
      ],
    },
    channelField("A_CHANNEL", 0),
    channelField("B_CHANNEL", 1),
    {
      type: "field_dropdown",
      name: "READING",
      options: [
        ["distance", "DISTANCE"],
        ["rate", "RATE"],
        ["count", "COUNT"],
      ],
    },
    {
      type: "input_value",
      name: "THRESHOLD",
      check: "Number",
    },
  ],
  inputsInline: true,
  hat: true,
  nextStatement: "Command",
  colour: wpilibColour,
  tooltip: "Runs commands when a wpilib.Encoder reading reaches the threshold.",
  helpUrl: "",
};

// --- Onboard IMU (gyro / accelerometer) --------------------------------------
// The SystemCore has a single built-in IMU (wpilib.OnboardIMU). One shared
// object is created in __init__ whenever any IMU block is used. Angles are
// surfaced in degrees (WPILib reports radians) so they read like a Spike Prime
// gyro.

const scWpilibImuValue = {
  type: "sc_wpilib_imu_value",
  message0: "IMU %1",
  args0: [
    {
      type: "field_dropdown",
      name: "READING",
      options: [
        ["heading (degrees)", "HEADING"],
        ["turn rate (deg/sec)", "TURN_RATE"],
        ["tilt X accel", "ACCEL_X"],
        ["tilt Y accel", "ACCEL_Y"],
        ["tilt Z accel", "ACCEL_Z"],
      ],
    },
  ],
  output: "Number",
  colour: wpilibColour,
  tooltip: "Reads the SystemCore onboard IMU (gyro/accelerometer).",
  helpUrl: "",
};

const scWpilibImuReset = {
  type: "sc_wpilib_imu_reset",
  message0: "reset IMU heading",
  previousStatement: "Command",
  nextStatement: "Command",
  colour: wpilibColour,
  tooltip: "Zeroes the onboard IMU heading (yaw).",
  helpUrl: "",
};

const scWpilibImuTrigger = {
  type: "sc_wpilib_imu_trigger",
  message0: "%1 IMU heading is at least %2 degrees",
  args0: [
    {
      type: "field_dropdown",
      name: "MODE",
      options: [
        ["when", "onTrue"],
        ["while", "whileTrue"],
      ],
    },
    {
      type: "input_value",
      name: "THRESHOLD",
      check: "Number",
    },
  ],
  inputsInline: true,
  hat: true,
  nextStatement: "Command",
  colour: wpilibColour,
  tooltip:
    "Runs commands when the onboard IMU heading reaches the threshold (degrees).",
  helpUrl: "",
};

const scWpilibMatchTime = {
  type: "sc_wpilib_match_time",
  message0: "match time left (seconds)",
  output: "Number",
  colour: wpilibColour,
  tooltip:
    "Seconds left in the current period (-1 when not connected to a field).",
  helpUrl: "",
};

// --- WPILib outputs (actuators + telemetry) ----------------------------------
// Second curated extension: raw digital outputs and SmartDashboard telemetry.
// These only appear once the "WPILib Outputs" extension is added.

const scWpilibDigitalOutputSet = {
  type: "sc_wpilib_digital_output_set",
  message0: "set digital output %1 %2",
  args0: [
    channelField("CHANNEL", 0),
    {
      type: "field_dropdown",
      name: "STATE",
      options: [
        ["on", "ON"],
        ["off", "OFF"],
      ],
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: wpilibOutputsColour,
  tooltip: "Drives a wpilib.DigitalOutput channel high or low.",
  helpUrl: "",
};

const scWpilibSmartdashboardPut = {
  type: "sc_wpilib_smartdashboard_put",
  message0: "show %1 = %2 on dashboard",
  args0: [
    {
      type: "field_input",
      name: "KEY",
      text: "value",
      spellcheck: false,
    },
    {
      type: "input_value",
      name: "VALUE",
      check: "Number",
    },
  ],
  inputsInline: true,
  previousStatement: "Command",
  nextStatement: "Command",
  colour: wpilibOutputsColour,
  tooltip: "Publishes a number to SmartDashboard so you can watch it live.",
  helpUrl: "",
};

const scWpilibSmartdashboardGet = {
  type: "sc_wpilib_smartdashboard_get",
  message0: "dashboard number %1",
  args0: [
    {
      type: "field_input",
      name: "KEY",
      text: "value",
      spellcheck: false,
    },
  ],
  output: "Number",
  colour: wpilibOutputsColour,
  tooltip: "Reads a number from SmartDashboard (0 when it has not been set).",
  helpUrl: "",
};

const scRevColorSensorValue = {
  type: "sc_rev_color_sensor_value",
  message0: "REV color sensor %1 %2",
  args0: [
    i2cPortField(),
    {
      type: "field_dropdown",
      name: "READING",
      options: [
        ["proximity", "PROXIMITY"],
        ["IR", "IR"],
        ["red", "RED"],
        ["green", "GREEN"],
        ["blue", "BLUE"],
      ],
    },
  ],
  output: "Number",
  colour: revColorSensorColour,
  tooltip: "Reads a value from a REV Color Sensor V3.",
  helpUrl: "",
};

const scRevColorSensorStatus = {
  type: "sc_rev_color_sensor_status",
  message0: "REV color sensor %1 %2",
  args0: [
    i2cPortField(),
    {
      type: "field_dropdown",
      name: "STATUS",
      options: [
        ["is connected", "CONNECTED"],
        ["has reset", "HAS_RESET"],
      ],
    },
  ],
  output: "Boolean",
  colour: revColorSensorColour,
  tooltip: "Checks status from a REV Color Sensor V3.",
  helpUrl: "",
};

const scRevColorSensorColorTrigger = {
  type: "sc_rev_color_sensor_color_trigger",
  message0: "%1 REV color sensor %2 sees %3",
  args0: [
    {
      type: "field_dropdown",
      name: "MODE",
      options: [
        ["when", "onTrue"],
        ["while", "whileTrue"],
      ],
    },
    i2cPortField(),
    {
      type: "field_colour",
      name: "COLOR",
      colour: "#ff0000",
    },
  ],
  inputsInline: true,
  hat: true,
  nextStatement: "Command",
  colour: revColorSensorColour,
  tooltip:
    "Runs commands when the selected REV color sensor color channel is dominant.",
  helpUrl: "",
};

const scRevColorSensorSeesColor = {
  type: "sc_rev_color_sensor_sees_color",
  message0: "REV color sensor %1 sees %2",
  args0: [
    i2cPortField(),
    {
      type: "field_colour",
      name: "COLOR",
      colour: "#ff0000",
    },
  ],
  output: "Boolean",
  colour: revColorSensorColour,
  tooltip: "Checks whether a REV Color Sensor V3 is close to the picked color.",
  helpUrl: "",
};

const scRevColorSensorProximityTrigger = {
  type: "sc_rev_color_sensor_proximity_trigger",
  message0: "%1 REV color sensor %2 proximity is at least %3",
  args0: [
    {
      type: "field_dropdown",
      name: "MODE",
      options: [
        ["when", "onTrue"],
        ["while", "whileTrue"],
      ],
    },
    i2cPortField(),
    {
      type: "input_value",
      name: "THRESHOLD",
      check: "Number",
    },
  ],
  inputsInline: true,
  hat: true,
  nextStatement: "Command",
  colour: revColorSensorColour,
  tooltip:
    "Runs commands when REV color sensor proximity reaches the threshold.",
  helpUrl: "",
};

// --- Gamepad -----------------------------------------------------------------
// Wrappers over wpilib.Gamepad. Only surfaced in Teleop opmodes (autonomous and
// utility opmodes don't read driver input), see toolbox.ts / App.vue.

const gamepadField = () => ({
  type: "field_dropdown",
  name: "GAMEPAD",
  options: [
    ["1", "1"],
    ["2", "2"],
  ],
});

const scGamepadButton = {
  type: "sc_gamepad_button",
  message0: "gamepad %1 %2 %3",
  args0: [
    gamepadField(),
    {
      type: "field_dropdown",
      name: "BUTTON",
      // Values are legacy wpilib.Gamepad getter stems; the generator lowers them
      // to the post4 snake_case names (SouthFace -> get_face_down_button).
      options: [
        ["A", "SouthFace"],
        ["B", "EastFace"],
        ["X", "WestFace"],
        ["Y", "NorthFace"],
        ["left bumper", "LeftBumper"],
        ["right bumper", "RightBumper"],
        ["dpad up", "DpadUp"],
        ["dpad down", "DpadDown"],
        ["dpad left", "DpadLeft"],
        ["dpad right", "DpadRight"],
        ["left stick", "LeftStick"],
        ["right stick", "RightStick"],
        ["start", "Start"],
        ["back", "Back"],
      ],
    },
    {
      type: "field_dropdown",
      name: "STATE",
      options: [
        ["is held down", "Held"],
        ["is pressed", "Pressed"],
        ["is released", "Released"],
      ],
    },
  ],
  output: "Boolean",
  colour: sensingColour,
  tooltip: 'Reads a gamepad button. "Pressed"/"released" fire once per press.',
  helpUrl: "",
};

const scGamepadAxis = {
  type: "sc_gamepad_axis",
  message0: "gamepad %1 %2",
  args0: [
    gamepadField(),
    {
      type: "field_dropdown",
      name: "AXIS",
      // Values are CamelCase axis stems; the generator lowers them to snake_case
      // (LeftX -> get_left_x).
      options: [
        ["left stick X", "LeftX"],
        ["left stick Y", "LeftY"],
        ["right stick X", "RightX"],
        ["right stick Y", "RightY"],
      ],
    },
  ],
  output: "Number",
  colour: sensingColour,
  tooltip: "Reads a gamepad joystick axis (-1 to 1).",
  helpUrl: "",
};

const scGamepadTrigger = {
  type: "sc_gamepad_trigger",
  message0: "gamepad %1 %2 trigger",
  args0: [
    gamepadField(),
    {
      type: "field_dropdown",
      name: "SIDE",
      options: [
        ["left", "Left"],
        ["right", "Right"],
      ],
    },
  ],
  output: "Number",
  colour: sensingColour,
  tooltip: "Reads a gamepad analog trigger (0 to 1).",
  helpUrl: "",
};

const scA301AdvancedCall = {
  type: "sc_a301_advanced_call",
  message0: "advanced A301 %1 . %2 args %3",
  args0: [
    deviceField(),
    {
      type: "field_dropdown",
      name: "METHOD",
      options: a301MethodOptions(),
    },
    {
      type: "field_input",
      name: "ARGS",
      text: "",
      spellcheck: false,
    },
  ],
  previousStatement: "Command",
  nextStatement: "Command",
  colour: advancedColour,
  tooltip:
    "Escape hatch for A301 methods that do not have beginner blocks yet.",
  helpUrl: "",
};

const scA301AdvancedValue = {
  type: "sc_a301_advanced_value",
  message0: "advanced A301 value %1 . %2 args %3",
  args0: [
    deviceField(),
    {
      type: "field_dropdown",
      name: "METHOD",
      options: a301MethodOptions(A301_VALUE_METHODS),
    },
    {
      type: "field_input",
      name: "ARGS",
      text: "",
      spellcheck: false,
    },
  ],
  output: null,
  colour: advancedColour,
  tooltip: "Escape hatch for reading an A301 method result.",
  helpUrl: "",
};

const scPythonSetupLine = {
  type: "sc_python_setup_line",
  message0: "advanced setup Python %1",
  args0: [
    {
      type: "field_input",
      name: "CODE",
      text: "self.extra = None",
      spellcheck: false,
    },
  ],
  previousStatement: "Setup",
  nextStatement: "Setup",
  colour: advancedColour,
  tooltip: "Adds one raw Python line inside robot setup.",
  helpUrl: "",
};

// Create the block definitions for the JSON-only blocks.
// This does not register their definitions with Blockly.
// This file has no side effects!
export const blocks = Blockly.common.createBlockDefinitionsFromJsonArray([
  scOpmodeDetails,
  scOnSetup,
  scOnStart,
  scTrigger,
  scMotorSetPower,
  scMotorRunForSeconds,
  scMotorStop,
  scMotorSetVelocity,
  scMotorSetPosition,
  scMechanismSetPower,
  scMechanismStop,
  scSubsystemOnStart,
  scSubsystemOnCommand,
  scMechanismRunCommand,
  scMovementMotors,
  scDrivetrainArcadeDrive,
  scDrivetrainTankDrive,
  scDrivetrainStop,
  scMecanumDrive,
  scMecanumStop,
  scWaitSeconds,
  scRepeatCommands,
  scWhileCommands,
  scParallelCommands,
  scRaceCommands,
  scDeadlineCommands,
  scWaitUntil,
  scIf,
  scA301SensorValue,
  scOperatorIsWithin,
  scWpilibDigitalInput,
  scWpilibAnalogInputValue,
  scWpilibEncoderValue,
  scWpilibEncoderReset,
  scWpilibDutyCycleEncoderValue,
  scWpilibDutyCycleEncoderConnected,
  scWpilibAnalogEncoderValue,
  scWpilibAnalogAccelerometerValue,
  scWpilibAnalogPotentiometerValue,
  scWpilibDigitalInputTrigger,
  scWpilibAnalogInputTrigger,
  scWpilibEncoderTrigger,
  scWpilibImuValue,
  scWpilibImuReset,
  scWpilibImuTrigger,
  scWpilibMatchTime,
  scWpilibDigitalOutputSet,
  scWpilibSmartdashboardPut,
  scWpilibSmartdashboardGet,
  scRevColorSensorValue,
  scRevColorSensorStatus,
  scRevColorSensorColorTrigger,
  scRevColorSensorSeesColor,
  scRevColorSensorProximityTrigger,
  scGamepadButton,
  scGamepadAxis,
  scGamepadTrigger,
  scA301AdvancedCall,
  scA301AdvancedValue,
  scPythonSetupLine,
]);
