import * as Blockly from 'blockly/core';

/**
 * A named RobotPy object configured at project scope.
 *
 * Advanced API blocks persist only the stable object id. This keeps a block
 * attached to the intended object through a rename and makes a deleted object
 * visibly missing rather than silently swapping the call to another object.
 */
export type ExtensionInstance = {
  id: string;
  name: string;
  className: string;
  args: string;
};

const EMPTY_INSTANCE_LABEL = '(add an object in Libraries)';
const MISSING_INSTANCE_LABEL = '(missing object)';

let instances: ExtensionInstance[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const newInstanceId = () => `object-${Date.now().toString(36)}-${nextId++}`;

const uniqueName = (base: string) => {
  const taken = new Set(instances.map((instance) => instance.name));
  if (!taken.has(base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base}_${index}`;
    if (!taken.has(candidate)) return candidate;
  }
};

export const getExtensionInstances = (): readonly ExtensionInstance[] =>
  instances;

export const getExtensionInstance = (id: string | null | undefined) =>
  id ? instances.find((instance) => instance.id === id) : undefined;

export const extensionInstancesForClass = (className: string) =>
  instances.filter((instance) => instance.className === className);

export const onExtensionInstancesChanged = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const addExtensionInstance = (
  partial: Partial<ExtensionInstance> & Pick<ExtensionInstance, 'className'>,
) => {
  const fallbackName =
    partial.className
      .split('.')
      .pop()
      ?.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase() || 'object';
  const instance: ExtensionInstance = {
    id: partial.id || newInstanceId(),
    name: uniqueName(partial.name?.trim() || fallbackName),
    className: partial.className,
    args: partial.args || '',
  };
  instances = [...instances, instance];
  notify();
  return instance;
};

export const updateExtensionInstance = (
  id: string,
  patch: Partial<ExtensionInstance>,
) => {
  instances = instances.map((instance) =>
    instance.id === id
      ? {
          ...instance,
          ...patch,
          id: instance.id,
          name: patch.name?.trim() || instance.name,
          className: patch.className || instance.className,
          args: patch.args ?? instance.args,
        }
      : instance,
  );
  notify();
};

export const removeExtensionInstance = (id: string) => {
  instances = instances.filter((instance) => instance.id !== id);
  notify();
};

export const setExtensionInstances = (list: unknown) => {
  const next: ExtensionInstance[] = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Partial<ExtensionInstance>;
      if (typeof candidate.className !== 'string' || !candidate.className)
        continue;
      next.push({
        id: candidate.id || newInstanceId(),
        name: candidate.name?.trim() || 'object',
        className: candidate.className,
        args: typeof candidate.args === 'string' ? candidate.args : '',
      });
    }
  }
  instances = next;
  notify();
};

type DropdownOption = [string, string];

const optionsForClass = (className: string, currentValue?: string) => {
  const options = extensionInstancesForClass(className).map(
    (instance) => [instance.name, instance.id] as DropdownOption,
  );
  if (!options.length) return [[EMPTY_INSTANCE_LABEL, ''] as DropdownOption];
  if (currentValue && !options.some(([, id]) => id === currentValue)) {
    options.push([MISSING_INSTANCE_LABEL, currentValue]);
  }
  return options;
};

function instanceMenuGenerator(this: Blockly.FieldDropdown): DropdownOption[] {
  const className = this.getSourceBlock()?.getFieldValue('CLASS') || '';
  const current = this.getValue?.();
  return optionsForClass(
    className,
    typeof current === 'string' ? current : undefined,
  );
}

export class FieldExtensionInstance extends Blockly.FieldDropdown {
  constructor() {
    super(instanceMenuGenerator);
  }

  static fromJson(): FieldExtensionInstance {
    return new FieldExtensionInstance();
  }

  protected override doClassValidation_(newValue?: string): string | null {
    return newValue == null ? null : String(newValue);
  }
}

export const EXTENSION_INSTANCE_FIELD_TYPE = 'field_extension_instance';

let fieldRegistered = false;
export const registerExtensionInstanceField = () => {
  if (fieldRegistered) return;
  Blockly.fieldRegistry.register(
    EXTENSION_INSTANCE_FIELD_TYPE,
    FieldExtensionInstance,
  );
  fieldRegistered = true;
};

export const refreshExtensionInstanceFields = (
  workspace: Blockly.Workspace,
) => {
  for (const block of workspace.getAllBlocks(false)) {
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (field instanceof FieldExtensionInstance) field.forceRerender();
      }
    }
  }
};
