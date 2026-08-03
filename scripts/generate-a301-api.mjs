// Projects the rev.A301 metadata out of the in-tree RobotPy metadata
// (python_tools/generated/robotpy_data.json, produced by the Python pipeline in
// python_tools/) into the A301 block catalog used by the default toolbox.
//
// Regenerate with:
//   npm run generate:a301 -- [path/to/robotpy_data.json] [out.ts]
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {snakeCase} from './python-naming.mjs';

const inputPath = resolve(
  process.argv[2] || 'python_tools/generated/robotpy_data.json',
);
const outputPath = resolve(process.argv[3] || 'src/generated/a301.ts');

const data = JSON.parse(readFileSync(inputPath, 'utf8'));
const a301Class = data.classes?.find((classData) => classData.className === 'rev.A301');

if (!a301Class) {
  throw new Error(`Could not find rev.A301 in ${inputPath}`);
}

const firstTooltipLine = (tooltip = '') =>
  tooltip
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';

const methodId = (method, seen) => {
  const base = method.functionName;
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }

  const suffix = method.returnType
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'overload';
  const candidate = `${base}_${suffix}`;
  seen.add(candidate);
  return candidate;
};

const seenIds = new Set();
// `name` is the post4 snake_case name that lands in generated Python; `id` stays
// the raw CamelCase name so METHOD field values in saved projects still resolve.
const methods = a301Class.instanceMethods.map((method) => ({
  id: methodId(method, seenIds),
  name: snakeCase(method.functionName),
  returnType: method.returnType || '',
  args: (method.args || [])
    .filter((arg) => arg.name !== 'self')
    .map((arg) => ({
      name: snakeCase(arg.name),
      type: arg.type || '',
      defaultValue: arg.defaultValue || '',
    })),
  isCommon: Boolean(method.isCommon),
  tooltip: firstTooltipLine(method.tooltip),
}));

const objectLiteral = (value) =>
  JSON.stringify(value)
    .replace(/"([^"]+)":/g, '$1:')
    .replaceAll(',"', ', "');

const methodLines = methods
  .map((method) => `  ${objectLiteral(method)},`)
  .join('\n');

const source = `export type A301ArgData = {
  name: string;
  type: string;
  defaultValue: string;
};

export type A301MethodData = {
  id: string;
  name: string;
  returnType: string;
  args: A301ArgData[];
  isCommon: boolean;
  tooltip: string;
};

export const A301_CLASS_NAME = 'rev.A301';
export const A301_MODULE_NAME = 'rev';

// Generated from RobotPy metadata for rev.A301. Regenerate with:
// npm run generate:a301 -- [path/to/robotpy_data.json]
export const A301_INSTANCE_METHODS: A301MethodData[] = [
${methodLines}
];

export const getA301Method = (id: string) =>
  A301_INSTANCE_METHODS.find((method) => method.id === id) ||
  A301_INSTANCE_METHODS[0];

export const labelForA301Method = (method: A301MethodData) => {
  const argLabel = method.args.map((arg) => arg.name).join(', ');
  const commonPrefix = method.isCommon ? 'Common: ' : '';
  return \`\${commonPrefix}\${method.name}(\${argLabel}) -> \${method.returnType}\`;
};

export const a301MethodOptions = (methods = A301_INSTANCE_METHODS) =>
  methods.map((method) => [labelForA301Method(method), method.id]);

export const A301_VALUE_METHODS = A301_INSTANCE_METHODS.filter(
  (method) => method.returnType !== 'None',
);
`;

writeFileSync(outputPath, source);
console.log(`Generated ${methods.length} A301 methods in ${outputPath}`);
