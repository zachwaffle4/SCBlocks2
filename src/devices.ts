import * as Blockly from 'blockly';

/**
 * Project-level motor (device) registry.
 *
 * A "motor" used to be a Blockly variable that had to be registered by hand with
 * an `sc_a301_motor` block inside each opmode's setup hat. Motors are now a
 * single project-level list managed through the UI (see App.vue's Motors modal).
 * Blocks reference a motor by its stable `id` via the custom `field_device`
 * dropdown; code generation and automatic registration resolve `id -> name/bus/
 * deviceId` from this registry (see generators/python.ts).
 *
 * This module is intentionally framework-agnostic (no Vue) so the Python
 * generator and the smoke test can read it directly.
 */

export type Device = {
  id: string;
  name: string;
  bus: number;
  deviceId: number;
};

export type MovementMotorsConfig =
  | {
      kind: 'differential';
      leftDeviceId: string;
      rightDeviceId: string;
    }
  | {
      kind: 'mecanum';
      frontLeftDeviceId: string;
      rearLeftDeviceId: string;
      frontRightDeviceId: string;
      rearRightDeviceId: string;
    };

const MISSING_DEVICE_LABEL = '(missing motor)';
const EMPTY_DEVICE_LABEL = '(add a motor)';

let devices: Device[] = [];
let nextId = 1;
// A subsystem editor only exposes motors owned by that subsystem. The project
// editor keeps this unset and therefore sees every registered motor.
let deviceScopeIds: ReadonlySet<string> | null = null;

type DeviceListener = () => void;
const listeners = new Set<DeviceListener>();

const notify = () => {
  for (const listener of listeners) listener();
};

/** Subscribe to any change in the registry. Returns an unsubscribe function. */
export const onDevicesChanged = (listener: DeviceListener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getDevices = (): readonly Device[] => devices;

export const getDevice = (id: string | null | undefined): Device | undefined =>
  id ? devices.find((device) => device.id === id) : undefined;

const newDeviceId = () => `device-${Date.now().toString(36)}-${nextId++}`;

const availableDevices = () =>
  deviceScopeIds
    ? devices.filter((device) => deviceScopeIds!.has(device.id))
    : devices;

const deviceIdAt = (index: number) => availableDevices()[index]?.id ?? '';

/** A default name that doesn't collide with an existing motor. */
const uniqueName = (base: string) => {
  const taken = new Set(devices.map((device) => device.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
};

export const addDevice = (partial: Partial<Device> = {}): Device => {
  const device: Device = {
    id: partial.id ?? newDeviceId(),
    name: uniqueName(partial.name?.trim() || `motor_${devices.length + 1}`),
    bus: partial.bus ?? 0,
    deviceId: partial.deviceId ?? 0,
  };
  devices = [...devices, device];
  notify();
  return device;
};

export const updateDevice = (id: string, patch: Partial<Device>) => {
  devices = devices.map((device) =>
    device.id === id ? {...device, ...patch, id: device.id} : device,
  );
  notify();
};

export const removeDevice = (id: string) => {
  devices = devices.filter((device) => device.id !== id);
  notify();
};

/** Replaces the whole registry (used when loading a saved project). */
export const setDevices = (list: Device[]) => {
  devices = list.map((device) => ({
    id: device.id ?? newDeviceId(),
    name: device.name ?? 'motor',
    bus: Number(device.bus) || 0,
    deviceId: Number(device.deviceId) || 0,
  }));
  notify();
};

// --- Custom field ----------------------------------------------------------

type DropdownOption = [string, string];

const deviceOptions = (currentValue?: string): DropdownOption[] => {
  const visibleDevices = availableDevices();
  const options: DropdownOption[] = visibleDevices.map((device) => [
    device.name,
    device.id,
  ]);
  if (!options.length) return [[EMPTY_DEVICE_LABEL, '']];
  // Keep a dangling reference (a deleted motor) visible instead of silently
  // repointing the block at whichever motor happens to be first.
  if (currentValue && !visibleDevices.some((device) => device.id === currentValue)) {
    options.push([
      getDevice(currentValue) ? '(not in this subsystem)' : MISSING_DEVICE_LABEL,
      currentValue,
    ]);
  }
  return options;
};

/**
 * Limits device pickers to a subsystem's owned motors while that subsystem is
 * being edited. Passing null restores the project-wide motor list.
 */
export const setDeviceFieldScope = (motorIds: Iterable<string> | null) => {
  deviceScopeIds = motorIds ? new Set(motorIds) : null;
};

// Invoked by Blockly as `this.menuGenerator_()`, so `this` is the field. Must be
// a plain function (not an arrow) — FieldDropdown's constructor calls it during
// super(), before the derived instance's `this` is initialized.
function deviceMenuGenerator(this: Blockly.FieldDropdown): DropdownOption[] {
  const current = this.getValue?.();
  return deviceOptions(typeof current === 'string' ? current : undefined);
}

/**
 * Dropdown field that lists the registered motors by name. The stored value is
 * the motor's stable id, so renaming a motor doesn't break existing blocks.
 */
export class FieldDevice extends Blockly.FieldDropdown {
  constructor() {
    super(deviceMenuGenerator);
  }

  static fromJson(): FieldDevice {
    return new FieldDevice();
  }

  // Accept any value (including a deleted motor's id) rather than snapping to
  // the first option; deviceOptions() surfaces it as "(missing motor)".
  protected override doClassValidation_(newValue?: string): string | null {
    return newValue == null ? null : String(newValue);
  }
}

export const DEVICE_FIELD_TYPE = 'field_device';

export const defaultMovementMotorsConfig = (): MovementMotorsConfig => ({
  kind: 'differential',
  leftDeviceId: deviceIdAt(0),
  rightDeviceId: deviceIdAt(1),
});

const normalizeDifferential = (
  config: Partial<Extract<MovementMotorsConfig, {kind: 'differential'}>>,
): MovementMotorsConfig => ({
  kind: 'differential',
  leftDeviceId: config.leftDeviceId || deviceIdAt(0),
  rightDeviceId: config.rightDeviceId || deviceIdAt(1),
});

const normalizeMecanum = (
  config: Partial<Extract<MovementMotorsConfig, {kind: 'mecanum'}>>,
): MovementMotorsConfig => ({
  kind: 'mecanum',
  frontLeftDeviceId: config.frontLeftDeviceId || deviceIdAt(0),
  rearLeftDeviceId: config.rearLeftDeviceId || deviceIdAt(1),
  frontRightDeviceId: config.frontRightDeviceId || deviceIdAt(2),
  rearRightDeviceId: config.rearRightDeviceId || deviceIdAt(3),
});

export const normalizeMovementMotorsConfig = (
  config: MovementMotorsConfig,
): MovementMotorsConfig =>
  config.kind === 'mecanum'
    ? normalizeMecanum(config)
    : normalizeDifferential(config);

export const parseMovementMotorsConfig = (
  value: string | null | undefined,
): MovementMotorsConfig => {
  if (!value) return defaultMovementMotorsConfig();
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.kind === 'mecanum') {
      return normalizeMecanum({
        kind: 'mecanum',
        frontLeftDeviceId: String(parsed.frontLeftDeviceId || ''),
        rearLeftDeviceId: String(parsed.rearLeftDeviceId || ''),
        frontRightDeviceId: String(parsed.frontRightDeviceId || ''),
        rearRightDeviceId: String(parsed.rearRightDeviceId || ''),
      });
    }
    return normalizeDifferential({
      kind: 'differential',
      leftDeviceId: String(parsed.leftDeviceId || ''),
      rightDeviceId: String(parsed.rightDeviceId || ''),
    });
  } catch {
    return defaultMovementMotorsConfig();
  }
};

export const serializeMovementMotorsConfig = (
  config: MovementMotorsConfig,
) => JSON.stringify(normalizeMovementMotorsConfig(config));

const movementMotorsValue = (config = defaultMovementMotorsConfig()) =>
  serializeMovementMotorsConfig(config);

const deviceLabel = (id: string, fallback: string) => {
  if (!id) return fallback;
  return getDevice(id)?.name ?? MISSING_DEVICE_LABEL;
};

export const movementMotorsSummary = (
  value: string | null | undefined,
) => {
  const config = parseMovementMotorsConfig(value);
  if (config.kind === 'mecanum') {
    return [
      'mecanum:',
      `FL ${deviceLabel(config.frontLeftDeviceId, 'front left')}`,
      `RL ${deviceLabel(config.rearLeftDeviceId, 'rear left')}`,
      `FR ${deviceLabel(config.frontRightDeviceId, 'front right')}`,
      `RR ${deviceLabel(config.rearRightDeviceId, 'rear right')}`,
    ].join(' ');
  }

  return [
    'tank:',
    `left ${deviceLabel(config.leftDeviceId, 'left motor')}`,
    `right ${deviceLabel(config.rightDeviceId, 'right motor')}`,
  ].join(' ');
};

const fromDifferentialToMecanum = (
  config: Extract<MovementMotorsConfig, {kind: 'differential'}>,
) =>
  normalizeMecanum({
    kind: 'mecanum',
    frontLeftDeviceId: config.leftDeviceId,
    rearLeftDeviceId: config.leftDeviceId,
    frontRightDeviceId: config.rightDeviceId,
    rearRightDeviceId: config.rightDeviceId,
  });

const fromMecanumToDifferential = (
  config: Extract<MovementMotorsConfig, {kind: 'mecanum'}>,
) =>
  normalizeDifferential({
    kind: 'differential',
    leftDeviceId: config.frontLeftDeviceId,
    rightDeviceId: config.frontRightDeviceId,
  });

const changeMovementKind = (
  config: MovementMotorsConfig,
  kind: MovementMotorsConfig['kind'],
) => {
  if (config.kind === kind) return config;
  if (kind === 'mecanum' && config.kind === 'differential') {
    return fromDifferentialToMecanum(config);
  }
  if (kind === 'differential' && config.kind === 'mecanum') {
    return fromMecanumToDifferential(config);
  }
  return config;
};

const movementDeviceOptions = (currentValue?: string): DropdownOption[] =>
  deviceOptions(currentValue);

const createOption = (label: string, value: string) => {
  const option = document.createElement('option');
  option.textContent = label;
  option.value = value;
  return option;
};

export class FieldMovementMotors extends Blockly.Field<string> {
  override SERIALIZABLE = true;

  constructor(value = movementMotorsValue()) {
    super(value);
  }

  static fromJson(config: Blockly.FieldConfig): FieldMovementMotors {
    const value = (config as Blockly.FieldConfig & {value?: string}).value;
    return new FieldMovementMotors(value ?? movementMotorsValue());
  }

  protected override doClassValidation_(newValue?: string): string | null {
    if (newValue == null) return null;
    return serializeMovementMotorsConfig(parseMovementMotorsConfig(newValue));
  }

  protected override getText_(): string {
    return movementMotorsSummary(this.getValue());
  }

  protected override showEditor_() {
    const render = () => {
      Blockly.DropDownDiv.clearContent();
      const content = Blockly.DropDownDiv.getContentDiv();
      const config = parseMovementMotorsConfig(this.getValue());
      const wrapper = document.createElement('div');
      wrapper.className =
        'grid w-80 max-w-[calc(100vw-48px)] gap-2.5 p-3 font-sans text-slate-950';

      const title = document.createElement('div');
      title.className = 'text-sm font-extrabold';
      title.textContent = 'Movement motors';
      wrapper.appendChild(title);

      const kindLabel = document.createElement('label');
      kindLabel.className =
        'grid grid-cols-[90px_minmax(0,1fr)] items-center gap-2.5 text-sm font-bold';
      const kindText = document.createElement('span');
      kindText.textContent = 'Drive type';
      const kindSelect = document.createElement('select');
      kindSelect.className =
        'min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';
      kindSelect.append(
        createOption('tank / differential', 'differential'),
        createOption('mecanum', 'mecanum'),
      );
      kindSelect.value = config.kind;
      kindSelect.addEventListener('change', () => {
        this.setValue(
          serializeMovementMotorsConfig(
            changeMovementKind(
              parseMovementMotorsConfig(this.getValue()),
              kindSelect.value === 'mecanum' ? 'mecanum' : 'differential',
            ),
          ),
        );
        render();
      });
      kindLabel.append(kindText, kindSelect);
      wrapper.appendChild(kindLabel);

      const addMotorSelect = (
        labelText: string,
        currentValue: string,
        onChange: (value: string) => void,
      ) => {
        const label = document.createElement('label');
        label.className =
          'grid grid-cols-[90px_minmax(0,1fr)] items-center gap-2.5 text-sm font-bold';
        const span = document.createElement('span');
        span.textContent = labelText;
        const select = document.createElement('select');
        select.className =
          'min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';
        for (const [labelText, value] of movementDeviceOptions(currentValue)) {
          select.appendChild(createOption(labelText, value));
        }
        select.value = currentValue;
        select.addEventListener('change', () => {
          onChange(select.value);
          render();
        });
        label.append(span, select);
        wrapper.appendChild(label);
      };

      if (config.kind === 'mecanum') {
        addMotorSelect('Front left', config.frontLeftDeviceId, (value) =>
          this.setValue(
            serializeMovementMotorsConfig({
              ...parseMovementMotorsConfig(this.getValue()),
              kind: 'mecanum',
              frontLeftDeviceId: value,
            } as MovementMotorsConfig),
          ),
        );
        addMotorSelect('Rear left', config.rearLeftDeviceId, (value) =>
          this.setValue(
            serializeMovementMotorsConfig({
              ...parseMovementMotorsConfig(this.getValue()),
              kind: 'mecanum',
              rearLeftDeviceId: value,
            } as MovementMotorsConfig),
          ),
        );
        addMotorSelect('Front right', config.frontRightDeviceId, (value) =>
          this.setValue(
            serializeMovementMotorsConfig({
              ...parseMovementMotorsConfig(this.getValue()),
              kind: 'mecanum',
              frontRightDeviceId: value,
            } as MovementMotorsConfig),
          ),
        );
        addMotorSelect('Rear right', config.rearRightDeviceId, (value) =>
          this.setValue(
            serializeMovementMotorsConfig({
              ...parseMovementMotorsConfig(this.getValue()),
              kind: 'mecanum',
              rearRightDeviceId: value,
            } as MovementMotorsConfig),
          ),
        );
      } else {
        addMotorSelect('Left motor', config.leftDeviceId, (value) =>
          this.setValue(
            serializeMovementMotorsConfig({
              ...parseMovementMotorsConfig(this.getValue()),
              kind: 'differential',
              leftDeviceId: value,
            } as MovementMotorsConfig),
          ),
        );
        addMotorSelect('Right motor', config.rightDeviceId, (value) =>
          this.setValue(
            serializeMovementMotorsConfig({
              ...parseMovementMotorsConfig(this.getValue()),
              kind: 'differential',
              rightDeviceId: value,
            } as MovementMotorsConfig),
          ),
        );
      }

      const summary = document.createElement('div');
      summary.className =
        'rounded-lg bg-blue-50 px-2.5 py-2 text-xs font-bold leading-5 text-blue-800';
      summary.textContent = movementMotorsSummary(this.getValue());
      wrapper.appendChild(summary);
      content.appendChild(wrapper);
    };

    render();
    Blockly.DropDownDiv.setColour('#ffffff', '#4c97ff');
    Blockly.DropDownDiv.showPositionedByField(this as unknown as Blockly.Field);
  }
}

export const MOVEMENT_MOTORS_FIELD_TYPE = 'field_movement_motors';

let fieldRegistered = false;
export const registerDeviceField = () => {
  if (fieldRegistered) return;
  Blockly.fieldRegistry.register(DEVICE_FIELD_TYPE, FieldDevice);
  Blockly.fieldRegistry.register(MOVEMENT_MOTORS_FIELD_TYPE, FieldMovementMotors);
  fieldRegistered = true;
};

/**
 * Force every device dropdown in the workspace to re-render so a renamed motor's
 * label updates immediately.
 */
export const refreshDeviceFields = (workspace: Blockly.Workspace) => {
  for (const block of workspace.getAllBlocks(false)) {
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (
          field instanceof FieldDevice || field instanceof FieldMovementMotors
        ) {
          field.forceRerender();
        }
      }
    }
  }
};

/** Field definition helper for block JSON. */
export const deviceField = (name = 'DEVICE') => ({
  type: DEVICE_FIELD_TYPE,
  name,
});

export const movementMotorsField = () => ({
  type: MOVEMENT_MOTORS_FIELD_TYPE,
  name: 'MOTORS',
});
