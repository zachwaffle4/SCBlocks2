/**
 * Lazy accessor for the escape-hatch RobotPy API catalog.
 *
 * The generated catalog covers the full scope of ../systemcore-blocks-interface —
 * every class, module and enum — and is NOT part of the default toolbox, so it is
 * only loaded the first time the user opens the extensions picker.
 *
 * The ~1.3 MB of metadata lives in robotpy-api.json rather than in a TypeScript
 * module: as a static asset the browser fetches it, caches it under a
 * content-hashed URL, and hands it to the native JSON parser, instead of having
 * to compile a megabyte of JavaScript object literals. Only the types come from
 * the generated .ts file, so none of this costs anything at build time.
 */
import type {
  ApiClass,
  ApiMethod,
  ApiModule,
  RobotpyCatalog,
} from './generated/robotpy-api';

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

// Resolved lazily so the URL import only runs in the browser: the headless
// smoke test compiles this module but never asks for the catalog.
const fetchCatalog = async (): Promise<RobotpyCatalog> => {
  const { default: url } = await import('./generated/robotpy-api.json?url');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load the RobotPy API catalog: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as RobotpyCatalog;
};

export const loadCatalog = (): Promise<Catalog> => {
  if (!catalogPromise) {
    catalogPromise = fetchCatalog().then((data) => {
      const classByName = new Map<string, ApiClass>();
      for (const cls of data.classes) {
        classByName.set(cls.className, cls);
      }
      return {
        classes: data.classes,
        modules: data.modules,
        classByName,
      };
    });
    // A failed fetch should not poison the cache: let the next open retry.
    catalogPromise.catch(() => {
      catalogPromise = null;
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
