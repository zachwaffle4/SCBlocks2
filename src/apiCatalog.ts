/**
 * Lazy accessor for the escape-hatch RobotPy API catalog.
 *
 * The generated catalog (src/generated/robotpy-api.ts) covers the full scope of
 * ../systemcore-blocks-interface — every class, module and enum. It is large and
 * is NOT part of the default toolbox, so we only import it on demand, the first
 * time the user opens the extensions picker. This keeps extensions behaving like
 * extensions: nothing is loaded until you ask for it.
 */
import type {ApiClass, ApiMethod, ApiModule} from './generated/robotpy-api';

export type {
  ApiArg,
  ApiClass,
  ApiEnum,
  ApiMethod,
  ApiModule,
  ApiVar,
} from './generated/robotpy-api';

type Catalog = {
  classes: ApiClass[];
  modules: ApiModule[];
  classByName: Map<string, ApiClass>;
};

let catalogPromise: Promise<Catalog> | null = null;

export const loadCatalog = (): Promise<Catalog> => {
  if (!catalogPromise) {
    catalogPromise = import('./generated/robotpy-api').then((mod) => {
      const classByName = new Map<string, ApiClass>();
      for (const cls of mod.ROBOTPY_CLASSES) {
        classByName.set(cls.className, cls);
      }
      return {
        classes: mod.ROBOTPY_CLASSES,
        modules: mod.ROBOTPY_MODULES,
        classByName,
      };
    });
  }
  return catalogPromise;
};

export const simpleName = (className: string) => {
  const dot = className.lastIndexOf('.');
  return dot === -1 ? className : className.slice(dot + 1);
};

/** A short signature label, e.g. `setThrottle(throttle) -> None`. */
export const methodLabel = (method: ApiMethod) => {
  const args = method.args.map((arg) => arg.name).join(', ');
  return `${method.name}(${args})${method.returnType ? ` → ${method.returnType}` : ''}`;
};

export const returnsValue = (method: ApiMethod) =>
  method.returnType !== '' && method.returnType !== 'None';

/**
 * Picks the methods worth surfacing for a class. Prefer the ones flagged
 * "common" upstream; fall back to everything when nothing is flagged so the
 * escape hatch never comes up empty.
 */
export const surfacedMethods = (cls: ApiClass): ApiMethod[] => {
  const common = cls.instanceMethods.filter((m) => m.common);
  return common.length ? common : cls.instanceMethods;
};
