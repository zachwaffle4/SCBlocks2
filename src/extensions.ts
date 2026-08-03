/**
 * Extensions — the escape hatch.
 *
 * Everything in ../systemcore-blocks-interface's RobotPy scope is reachable here,
 * but NONE of it is in the toolbox by default. The user loads a class as an
 * "extension" (like a Scratch extension); only then do generic call / value /
 * enum blocks for that class appear in a dynamic flyout.
 *
 * The generic blocks (`sc_ext_call`, `sc_ext_value`, `sc_ext_enum`) are the same
 * escape-hatch idea as the old A301-only advanced blocks, generalized to any
 * class in the generated catalog.
 */
import * as Blockly from 'blockly';
import {Order, type PythonGenerator} from 'blockly/python';
import {
  loadCatalog,
  returnsValue,
  surfacedMethods,
  type ApiClass,
} from './apiCatalog';
import {
  A301_CLASS_NAME,
  A301_INSTANCE_METHODS,
  A301_VALUE_METHODS,
} from './generated/a301';
import {screamingSnakeCase, snakeCase} from './pythonNaming';
import {
  extensionInstanceReference,

  registerPythonImport,
} from './generators/python';
import {
  extensionInstancesForClass,
  getExtensionInstance,
  onExtensionInstancesChanged,
  registerExtensionInstanceField,
} from './extensionInstances';

const extensionColour = '#5C81A6';

export const EXTENSIONS_TOOLBOX_CATEGORY = 'SYSTEMCORE_EXTENSIONS';
export const ADD_EXTENSION_CALLBACK = 'ADD_EXTENSION';
export const WPILIB_SENSORS_EXTENSION_ID = 'handwrapped:wpilib-sensors';
export const WPILIB_OUTPUTS_EXTENSION_ID = 'handwrapped:wpilib-outputs';
export const REV_SENSORS_EXTENSION_ID = 'handwrapped:rev-sensors';

export const handWrappedExtensions = [
  {
    id: WPILIB_SENSORS_EXTENSION_ID,
    name: 'WPILib Sensors',
    summary:
      'Onboard IMU, digital/analog inputs, encoders, and match time.',
    color: '#FF4C4C',
    chips: ['IMU', 'DIO', 'Encoders'],
  },
  {
    id: WPILIB_OUTPUTS_EXTENSION_ID,
    name: 'WPILib Outputs',
    summary:
      'Digital outputs and SmartDashboard telemetry (show/read numbers).',
    color: '#0FBC9B',
    chips: ['Digital out', 'Dashboard'],
  },
  {
    id: REV_SENSORS_EXTENSION_ID,
    name: 'REV Sensors',
    summary: 'REV color sensor readings, proximity, and connection status.',
    color: '#FF8C1A',
    chips: ['Color', 'Proximity', 'I2C'],
  },
] as const;

const handWrappedExtensionIds = new Set(
  handWrappedExtensions.map((extension) => extension.id),
);

export const isHandWrappedExtension = (id: string) =>
  handWrappedExtensionIds.has(id as (typeof handWrappedExtensions)[number]['id']);

// ---------------------------------------------------------------------------
// Loaded-extension registry
// ---------------------------------------------------------------------------

const loadedExtensions = new Set<string>();
const listeners = new Set<() => void>();

export const getLoadedExtensions = () => Array.from(loadedExtensions);

export const isExtensionLoaded = (className: string) =>
  loadedExtensions.has(className);

const notify = () => listeners.forEach((listener) => listener());

export const addExtension = (className: string) => {
  if (!loadedExtensions.has(className)) {
    loadedExtensions.add(className);
    notify();
  }
};

export const removeExtension = (className: string) => {
  if (loadedExtensions.delete(className)) {
    notify();
  }
};

export const setLoadedExtensions = (classNames: string[]) => {
  loadedExtensions.clear();
  for (const className of classNames) {
    if (typeof className === 'string' && className.trim()) {
      loadedExtensions.add(className);
    }
  }
  notify();
};

export const onExtensionsChanged = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// ---------------------------------------------------------------------------
// Generic escape-hatch block definitions
// ---------------------------------------------------------------------------

const scExtCall = {
  type: 'sc_ext_call',
  message0: 'call %1 . %2',
  args0: [
    {type: 'field_input', name: 'TARGET', text: 'self.device', spellcheck: false},
    {type: 'field_label_serializable', name: 'METHOD', text: 'method'},
  ],
  previousStatement: 'Command',
  nextStatement: 'Command',
  colour: extensionColour,
  tooltip: 'Escape hatch: call a RobotPy method as a command.',
  helpUrl: '',
  mutator: 'sc_ext_args_mutator',
};

const scExtValue = {
  type: 'sc_ext_value',
  message0: '%1 . %2',
  args0: [
    {type: 'field_input', name: 'TARGET', text: 'self.device', spellcheck: false},
    {type: 'field_label_serializable', name: 'METHOD', text: 'method'},
  ],
  output: null,
  colour: extensionColour,
  tooltip: 'Escape hatch: read the result of a RobotPy method.',
  helpUrl: '',
  mutator: 'sc_ext_args_mutator',
};

const scExtEnum = {
  type: 'sc_ext_enum',
  message0: '%1 . %2',
  args0: [
    {type: 'field_label_serializable', name: 'ENUM', text: 'Enum'},
    {type: 'field_label_serializable', name: 'VALUE', text: 'value'},
  ],
  output: null,
  colour: extensionColour,
  tooltip: 'Escape hatch: a RobotPy enum value.',
  helpUrl: '',
};

// New advanced API blocks keep their target honest: users pick a named project
// object from a dropdown instead of typing a guessed `self.some_thing` target.
// CLASS stays visible so a block remains understandable after it is copied.
const scExtInstanceCall = {
  type: 'sc_ext_instance_call',
  message0: 'call %1 %2 %3 . %4',
  args0: [
    {type: 'field_label', text: 'on'},
    {type: 'field_label_serializable', name: 'CLASS', text: 'Object'},
    {type: 'field_extension_instance', name: 'INSTANCE'},
    {type: 'field_label_serializable', name: 'METHOD', text: 'method'},
  ],
  previousStatement: 'Command',
  nextStatement: 'Command',
  colour: extensionColour,
  tooltip:
    'Calls a method on a named project object. Add or edit objects in Libraries.',
  helpUrl: '',
  mutator: 'sc_ext_args_mutator',
};

const scExtInstanceValue = {
  type: 'sc_ext_instance_value',
  message0: '%1 %2 . %3',
  args0: [
    {type: 'field_label_serializable', name: 'CLASS', text: 'Object'},
    {type: 'field_extension_instance', name: 'INSTANCE'},
    {type: 'field_label_serializable', name: 'METHOD', text: 'method'},
  ],
  output: null,
  colour: extensionColour,
  tooltip:
    'Reads a method result from a named project object. Add or edit objects in Libraries.',
  helpUrl: '',
  mutator: 'sc_ext_args_mutator',
};

Blockly.Extensions.registerMutator(
  'sc_ext_args_mutator',
  {
    saveExtraState: function () {
      return {
        args: this.argumentNames_ || [],
      };
    },
    loadExtraState: function (state: any) {
      this.argumentNames_ = state.args || [];
      this.updateShape_();
    },
    updateShape_: function () {
      let i = 0;
      while (this.getInput('ARG' + i)) {
        this.removeInput('ARG' + i);
        i++;
      }
      if (this.argumentNames_ && this.argumentNames_.length > 0) {
        this.argumentNames_.forEach((arg: string, index: number) => {
          this.appendValueInput('ARG' + index)
            .setAlign(Blockly.inputs.Align.RIGHT)
            .appendField(arg);
        });
      }
    },
  },
  undefined,
  []
);

export const extensionBlocks = Blockly.common.createBlockDefinitionsFromJsonArray([
  scExtCall,
  scExtValue,
  scExtEnum,
  scExtInstanceCall,
  scExtInstanceValue,
]);

// ---------------------------------------------------------------------------
// Python generators for the escape-hatch blocks
// ---------------------------------------------------------------------------

const importForDotted = (generator: PythonGenerator, dotted: string) => {
  const root = dotted.split('.')[0];
  if (!root || root === 'self') return;
  registerPythonImport(generator, root);
};

const getArgs = (block: Blockly.Block, generator: PythonGenerator) => {
  const args = [];
  let i = 0;
  while (block.getInput('ARG' + i)) {
    const val = generator.valueToCode(block, 'ARG' + i, Order.NONE) || 'None';
    args.push(val);
    i++;
  }
  return args.join(', ');
};

const callExpression = (block: Blockly.Block, generator: PythonGenerator) => {
  const target = (block.getFieldValue('TARGET') || 'self.device').trim();
  // METHOD is a serialized label, so blocks saved before the post4 snake_case
  // switch still carry CamelCase names. snakeCase() is a no-op on new ones.
  const method = snakeCase(block.getFieldValue('METHOD'));
  const args = getArgs(block, generator);
  importForDotted(generator, target);
  return `${target}.${method}(${args})`;
};

export const extensionForBlock = Object.create(null);

extensionForBlock['sc_ext_call'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  return `${callExpression(block, generator)}\n`;
};

extensionForBlock['sc_ext_value'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  return [callExpression(block, generator), Order.FUNCTION_CALL];
};

extensionForBlock['sc_ext_enum'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const enumName = block.getFieldValue('ENUM');
  // Like METHOD, VALUE is a serialized label, so blocks saved before post4 still
  // carry the old kCamelCase member names.
  const value = screamingSnakeCase(block.getFieldValue('VALUE'));
  importForDotted(generator, enumName);
  return [`${enumName}.${value}`, Order.MEMBER];
};

const instanceCallExpression = (
  block: Blockly.Block,
  generator: PythonGenerator,
) => {
  const instance = getExtensionInstance(block.getFieldValue('INSTANCE'));
  if (!instance) return null;
  importForDotted(generator, instance.className);
  const method = snakeCase(block.getFieldValue('METHOD'));
  const args = getArgs(block, generator);
  return `${extensionInstanceReference(instance)}.${method}(${args})`;
};

extensionForBlock['sc_ext_instance_call'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const call = instanceCallExpression(block, generator);
  return `${call || 'pass'}\n`;
};

extensionForBlock['sc_ext_instance_value'] = function (
  block: Blockly.Block,
  generator: PythonGenerator,
) {
  const call = instanceCallExpression(block, generator);
  return [call || 'None', Order.FUNCTION_CALL];
};

// ---------------------------------------------------------------------------
// Dynamic flyout for the Extensions category
// ---------------------------------------------------------------------------

type FlyoutItem = {kind: string; [key: string]: unknown};

const instanceCallBlockFor = (cls: ApiClass, method: {name: string; args: {name: string}[]}): FlyoutItem => ({
  kind: 'block',
  type: 'sc_ext_instance_call',
  fields: {
    CLASS: cls.className,
    INSTANCE: extensionInstancesForClass(cls.className)[0]?.id || '',
    METHOD: method.name,
  },
  extraState: {
    args: method.args.map((arg) => arg.name),
  },
});

const instanceValueBlockFor = (cls: ApiClass, method: {name: string; args: {name: string}[]}): FlyoutItem => ({
  kind: 'block',
  type: 'sc_ext_instance_value',
  fields: {
    CLASS: cls.className,
    INSTANCE: extensionInstancesForClass(cls.className)[0]?.id || '',
    METHOD: method.name,
  },
  extraState: {
    args: method.args.map((arg) => arg.name),
  },
});

const enumBlocksFor = (cls: ApiClass): FlyoutItem[] => {
  const items: FlyoutItem[] = [];
  for (const enumData of cls.enums) {
    for (const value of enumData.values) {
      items.push({
        kind: 'block',
        type: 'sc_ext_enum',
        fields: {ENUM: enumData.name, VALUE: value},
      });
    }
  }
  return items;
};

const firstA301Method = (
  methods: typeof A301_INSTANCE_METHODS,
  preferredId: string,
) =>
  methods.find((method) => method.id === preferredId)?.id ||
  methods[0]?.id ||
  '';

const a301BlocksFor = (): FlyoutItem[] => [
  {
    kind: 'block',
    type: 'sc_a301_advanced_call',
    fields: {
      METHOD: firstA301Method(A301_INSTANCE_METHODS, 'clearFaults'),
    },
  },
  {
    kind: 'block',
    type: 'sc_a301_advanced_value',
    fields: {
      METHOD: firstA301Method(A301_VALUE_METHODS, 'getThrottle'),
    },
  },
];

// The catalog is loaded lazily. Once loaded we cache class lookups so the
// (synchronous) toolbox callback can build flyouts immediately.
let classIndex: Map<string, ApiClass> | null = null;

export const ensureCatalogLoaded = async () => {
  const catalog = await loadCatalog();
  classIndex = catalog.classByName;
  return catalog;
};

export const buildExtensionsFlyout = (): FlyoutItem[] => {
  const contents: FlyoutItem[] = [
    {
      kind: 'button',
      text: 'Add extension…',
      callbackkey: ADD_EXTENSION_CALLBACK,
    },
  ];

  const loaded = getLoadedExtensions().filter(
    (className) => !isHandWrappedExtension(className),
  );
  if (!loaded.length) {
    contents.push({
      kind: 'label',
      text: 'No generated API classes loaded.',
    });
    return contents;
  }

  for (const className of loaded) {
    const cls = classIndex?.get(className);
    contents.push({kind: 'label', text: className});
    if (className === A301_CLASS_NAME) {
      contents.push(...a301BlocksFor());
      continue;
    }
    if (!cls) continue;

    if (!extensionInstancesForClass(className).length) {
      contents.push({
        kind: 'label',
        text: 'Add a named object in Libraries to use these methods.',
      });
    }

    for (const method of surfacedMethods(cls)) {
      contents.push(
        returnsValue(method)
          ? instanceValueBlockFor(cls, method)
          : instanceCallBlockFor(cls, method),
      );
    }
    contents.push(...enumBlocksFor(cls));
  }

  return contents;
};

/**
 * Registers the escape-hatch blocks, generators, the dynamic Extensions
 * category and the "Add extension…" button. `onAddExtension` is invoked when the
 * user clicks that button (the host app shows the picker UI).
 */
export const registerExtensions = (
  workspace: Blockly.WorkspaceSvg,
  pythonGenerator: PythonGenerator,
  onAddExtension: () => void,
) => {
  registerExtensionInstanceField();
  if (!Blockly.Blocks['sc_ext_call']) {
    Blockly.common.defineBlocks(extensionBlocks);
  }
  Object.assign(pythonGenerator.forBlock, extensionForBlock);

  workspace.registerToolboxCategoryCallback(
    EXTENSIONS_TOOLBOX_CATEGORY,
    () => buildExtensionsFlyout(),
  );

  workspace.registerButtonCallback(ADD_EXTENSION_CALLBACK, () => {
    onAddExtension();
  });

  // Refresh the flyout whenever the loaded set changes. The catalog is only
  // fetched on demand (when the picker opens), so nothing generated is loaded
  // until the user asks for it.
  onExtensionsChanged(() => {
    workspace.getToolbox()?.refreshSelection();
  });
  onExtensionInstancesChanged(() => {
    workspace.getToolbox()?.refreshSelection();
  });
};
