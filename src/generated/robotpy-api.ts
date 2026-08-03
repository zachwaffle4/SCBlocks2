// AUTO-GENERATED — do not edit by hand.
// Regenerate with: npm run generate:api -- [path/to/robotpy_data.json]
//
// Types only. The catalog data itself lives in robotpy-api.json, which is
// fetched as a static asset on demand (see src/apiCatalog.ts) so the ~1.3 MB of
// metadata never has to be parsed as JavaScript.

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

export type RobotpyCatalog = {
  modules: ApiModule[];
  classes: ApiClass[];
};
