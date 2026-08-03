/**
 * Generates the escape-hatch RobotPy API catalog for the whole RobotPy scope
 * (every class, module, and enum in the metadata), not just rev.A301.
 *
 * The RobotPy metadata (python_tools/generated/robotpy_data.json) is produced by
 * the in-tree Python generation pipeline — see python_tools/README.md. This
 * script projects that metadata into a TypeScript module.
 *
 * The output is written as its own module so it can be lazy-loaded on demand
 * (extensions are an escape hatch — they are not part of the default toolbox).
 *
 * Regenerate with:
 *   npm run generate:api -- [path/to/robotpy_data.json] [out.ts]
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {
  attributeName,
  screamingSnakeCase,
  snakeCase,
} from './python-naming.mjs';

const inputPath = resolve(
  process.argv[2] || 'python_tools/generated/robotpy_data.json',
);
const outputPath = resolve(process.argv[3] || 'src/generated/robotpy-api.ts');

const data = JSON.parse(readFileSync(inputPath, 'utf8'));

const firstTooltipLine = (tooltip = '') =>
  (tooltip || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';

const mapArg = (arg) => ({
  name: snakeCase(arg.name),
  type: arg.type || '',
  default: arg.defaultValue || '',
});

// Method, argument, and attribute names are lowered to post4 snake_case; class
// and enum names keep their CamelCase
const mapMethod = (method) => ({
  name: snakeCase(method.functionName),
  returnType: method.returnType || '',
  args: (method.args || []).filter((arg) => arg.name !== 'self').map(mapArg),
  common: Boolean(method.isCommon),
  tooltip: firstTooltipLine(method.tooltip),
});

const mapVar = (v) => ({
  name: attributeName(v.name),
  type: v.type || '',
  writable: Boolean(v.writable),
  common: Boolean(v.isCommon),
  tooltip: firstTooltipLine(v.tooltip),
});

// Class-level values are constants, so they follow the enum styling:
// kDefaultXChannel -> DEFAULT_X_CHANNEL, NumMotorPorts -> NUM_MOTOR_PORTS.
// Instance attributes and module variables stay snake_case (post4 turned
// wpimath.units.kInchesPerFoot into inches_per_foot, not INCHES_PER_FOOT).
const mapConstant = (v) => ({
  ...mapVar(v),
  name: screamingSnakeCase(v.name),
});

// The enum class keeps its CamelCase name; its values become SCREAMING_SNAKE.
const mapEnum = (e) => ({
  name: e.enumClassName,
  values: (e.enumValues || []).map(screamingSnakeCase),
  tooltip: firstTooltipLine(e.tooltip),
});

const classes = (data.classes || []).map((c) => ({
  className: c.className,
  module: c.moduleName || '',
  isComponent: Boolean(c.isComponent),
  constructors: (c.constructors || []).map(mapMethod),
  instanceMethods: (c.instanceMethods || []).map(mapMethod),
  staticMethods: (c.staticMethods || []).map(mapMethod),
  instanceVariables: (c.instanceVariables || []).map(mapVar),
  classVariables: (c.classVariables || []).map(mapConstant),
  enums: (c.enums || []).map(mapEnum),
}));

const modules = (data.modules || []).map((m) => ({
  moduleName: m.moduleName,
  functions: (m.functions || []).map(mapMethod),
  enums: (m.enums || []).map(mapEnum),
  variables: (m.moduleVariables || []).map(mapVar),
}));

const header = `// AUTO-GENERATED — do not edit by hand.
// Regenerate with: npm run generate:api -- [path/to/robotpy_data.json]
//
// This is the escape-hatch RobotPy API catalog covering the full RobotPy scope.
// It is projected from python_tools/generated/robotpy_data.json and imported
// lazily (see src/extensions.ts) so none of it ships in the default toolbox.

export type ApiArg = {name: string; type: string; default: string};

export type ApiMethod = {
  name: string;
  returnType: string;
  args: ApiArg[];
  common: boolean;
  tooltip: string;
};

export type ApiVar = {
  name: string;
  type: string;
  writable: boolean;
  common: boolean;
  tooltip: string;
};

export type ApiEnum = {name: string; values: string[]; tooltip: string};

export type ApiClass = {
  className: string;
  module: string;
  isComponent: boolean;
  constructors: ApiMethod[];
  instanceMethods: ApiMethod[];
  staticMethods: ApiMethod[];
  instanceVariables: ApiVar[];
  classVariables: ApiVar[];
  enums: ApiEnum[];
};

export type ApiModule = {
  moduleName: string;
  functions: ApiMethod[];
  enums: ApiEnum[];
  variables: ApiVar[];
};

`;

const source =
  header +
  `export const ROBOTPY_MODULES: ApiModule[] = ${JSON.stringify(modules)};\n\n` +
  `export const ROBOTPY_CLASSES: ApiClass[] = ${JSON.stringify(classes)};\n`;

writeFileSync(outputPath, source);
console.log(
  `Generated ${classes.length} classes and ${modules.length} modules in ${outputPath} ` +
    `(${(source.length / 1024 / 1024).toFixed(2)} MB)`,
);
