<script setup lang="ts">
import * as Blockly from 'blockly/core';
import { registerContinuousToolbox } from '@blockly/continuous-toolbox';
import { pythonGenerator } from 'blockly/python';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRawEngine } from 'shiki/engine/javascript';
import pythonLang from '@shikijs/langs-precompiled/python';
import lightTheme from 'shiki/themes/material-theme-lighter.mjs';
import {
  registerSystemCoreRenderer,
  systemCoreRendererName,
} from './blocklyRenderer';
import { systemCoreTheme } from './blocklyTheme';
import { blocks } from './blocks/text';
import {
  addDevice,
  getDevices,
  onDevicesChanged,
  refreshDeviceFields,
  registerDeviceField,
  removeDevice,
  setDeviceFieldScope,
  setDevices,
  updateDevice,
  type Device,
} from './devices';
import {
  addMechanism,
  getMechanisms,
  onMechanismsChanged,
  refreshMechanismFields,
  registerMechanismField,
  removeMechanism,
  setMechanisms,
  updateMechanism,
  type Mechanism,
} from './mechanisms';
import {
  addExtensionInstance,
  getExtensionInstances,
  onExtensionInstancesChanged,
  refreshExtensionInstanceFields,
  removeExtensionInstance,
  setExtensionInstances,
  updateExtensionInstance,
  type ExtensionInstance,
} from './extensionInstances';
import { forBlock } from './generators/python';
import { buildToolbox } from './toolbox';
import { registerTypedVariableCategory } from './variableCategory';
import { registerVariableBlocks, variableForBlock } from './variableBlocks';
import {
  addExtension,
  ensureCatalogLoaded,
  getLoadedExtensions,
  handWrappedExtensions,
  isExtensionLoaded,
  registerExtensions,
  removeExtension,
  REV_SENSORS_EXTENSION_ID,
  setLoadedExtensions,
  WPILIB_OUTPUTS_EXTENSION_ID,
  WPILIB_SENSORS_EXTENSION_ID,
} from './extensions';
import { simpleName } from './apiCatalog';
import {
  generateAllOpmodes,
  makeOpmodeState,
  migrateWorkspaceState,
  newTabId,
  opmodeInfoFromState,
  type OpModeTab,
  type OpModeType,
  type WorkspaceState,
} from './opmodes';
import {
  createStoredProject,
  deleteStoredProject,
  exportStoredProject,
  importStoredProject,
  listStoredProjects,
  loadActiveStoredProject,
  loadLegacyProject,
  loadStoredProject,
  parseProjectBackup,
  saveStoredProject,
  setActiveStoredProject,
  type ProjectData,
  type StoredProject,
} from './projectStorage';
import {
  getRobotMode,
  onRobotModeChanged,
  setRobotMode,
  type RobotMode,
} from './robotMode';

// v3: opmodes are separate hat blocks (details / setup / start / trigger), and
// motors live in a project-level registry rather than as per-tab variables.
const blocklyDiv = ref<HTMLDivElement | null>(null);
const generatedCode = ref('');
const generationStatus = ref('Ready');

// Syntax-highlighted HTML for the generated Python, produced by Shiki. Shiki's
// highlighter is async, so we render into `highlightedCode` off a watcher and
// fall back to the plain <pre><code> until the first pass resolves.
const highlightedCode = ref('');

// A single fine-grained Shiki highlighter, bundling only Python + one theme,
// created lazily on first use. The grammar is precompiled to JavaScript regexes,
// so the raw engine can run it directly: no WASM, and no Oniguruma-to-JS
// translator in the bundle.
let highlighterPromise: Promise<HighlighterCore> | null = null;
const getHighlighter = () => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      langs: [pythonLang],
      themes: [lightTheme],
      engine: createJavaScriptRawEngine(),
    });
  }
  return highlighterPromise;
};

watch(
  generatedCode,
  async (code) => {
    try {
      const highlighter = await getHighlighter();
      highlightedCode.value = highlighter.codeToHtml(code, {
        lang: 'python',
        theme: 'material-theme-lighter',
      });
    } catch (error) {
      console.warn('Failed to highlight generated code:', error);
      highlightedCode.value = '';
    }
  },
  { immediate: true },
);

// OpMode tabs.
const tabs = ref<OpModeTab[]>([]);
const activeTabId = ref('');
const activeSubsystemId = ref('');
const opmodeSettingsOpen = ref(false);

// Robot Setup is a project-level source of truth. Blockly fields only store
// stable ids; these reactive mirrors keep the setup UI in sync with codegen.
const motorsOpen = ref(false);
const setupStep = ref<'motors' | 'subsystems'>('motors');
const motors = ref<Device[]>([]);
const mechanisms = ref<Mechanism[]>([]);
const robotMode = ref<RobotMode>(getRobotMode());

// A project is a named snapshot rather than the old single local-storage blob.
const projectsOpen = ref(false);
const storedProjects = ref<StoredProject[]>([]);
const activeProjectId = ref('');
const projectName = ref('My Robot');
const projectImportFile = ref<File | null>(null);
let restoringProject = false;

// Extensions picker state.
const pickerOpen = ref(false);
const pickerQuery = ref('');
const catalogClasses = ref<
  {
    className: string;
    module: string;
    isComponent: boolean;
  }[]
>([]);
const catalogLoading = ref(false);
const loadedExtensions = ref<string[]>([]);
const extensionObjects = ref<ExtensionInstance[]>([]);

let workspace: Blockly.WorkspaceSvg | null = null;
let suppressChanges = false;
let syncingSubsystemWorkspace = false;
let workspaceResizeFrame: number | null = null;
let workspaceResizeObserver: ResizeObserver | null = null;

const registerBlockly = () => {
  registerDeviceField();
  registerMechanismField();
  if (!Blockly.Blocks['sc_opmode_details']) {
    Blockly.common.defineBlocks(blocks);
  }

  Object.assign(pythonGenerator.forBlock, forBlock);
};

const resizeWorkspace = () => {
  if (!workspace) return;
  Blockly.svgResize(workspace);
};

const scheduleWorkspaceResize = () => {
  if (workspaceResizeFrame !== null) return;
  workspaceResizeFrame = window.requestAnimationFrame(() => {
    workspaceResizeFrame = null;
    resizeWorkspace();
  });
};

const showToolbox = ref(true);
const showGeneratedCode = ref(true);

watch(showToolbox, (visible) => {
  if (workspace) {
    workspace.getToolbox()?.setVisible(visible);
    workspace.getFlyout()?.setVisible(visible);
    scheduleWorkspaceResize();
  }
});

// --- Tab / opmode plumbing -------------------------------------------------

const TYPE_LABELS: Record<OpModeType, string> = {
  Teleop: 'teleop',
  Auto: 'autonomous',
  Utility: 'utility',
};

const activeTab = () => tabs.value.find((tab) => tab.id === activeTabId.value);
const activeSubsystem = () =>
  activeSubsystemId.value
    ? getMechanisms().find(
        (mechanism) => mechanism.id === activeSubsystemId.value,
      )
    : undefined;

const editingSubsystem = computed(() => Boolean(activeSubsystem()));

const tabViews = computed(() =>
  tabs.value.map((tab) => {
    const info = opmodeInfoFromState(tab.state);
    return {
      id: tab.id,
      name: info.name,
      type: info.type,
      typeLabel: TYPE_LABELS[info.type] ?? info.type,
      enabled: info.enabled,
    };
  }),
);

const opmodeColor = (type: OpModeType) =>
  type === 'Auto' ? 'warning' : type === 'Utility' ? 'neutral' : 'primary';

const activeTabView = computed(
  () => tabViews.value.find((tab) => tab.id === activeTabId.value) ?? null,
);

const activeEditorTitle = computed(
  () => activeSubsystem()?.name ?? activeTabView.value?.name ?? 'Robot project',
);

type EditorTabItem = {
  label: string;
  value: string;
  kind: 'opmode' | 'subsystem';
  typeLabel?: string;
  color?: 'primary' | 'warning' | 'neutral';
  isDisabled?: boolean;
};

const editorTabItems = computed<EditorTabItem[]>(() => [
  ...tabViews.value.map((tab) => ({
    label: tab.name,
    value: `opmode:${tab.id}`,
    kind: 'opmode' as const,
    typeLabel: tab.typeLabel,
    color: opmodeColor(tab.type),
    isDisabled: !tab.enabled,
  })),
  ...(robotMode.value === 'advanced'
    ? mechanisms.value.map((subsystem) => ({
        label: subsystem.name,
        value: `subsystem:${subsystem.id}`,
        kind: 'subsystem' as const,
        color: 'primary' as const,
      }))
    : []),
]);

const editorTabAccent = (item: EditorTabItem) =>
  item.color === 'warning'
    ? 'bg-amber-500'
    : item.color === 'primary'
      ? 'bg-primary-500'
      : 'bg-slate-400';

const activeEditorTab = computed(() =>
  activeSubsystemId.value
    ? `subsystem:${activeSubsystemId.value}`
    : `opmode:${activeTabId.value}`,
);

const opmodeTypeOptions = [
  { label: 'Teleop · driver controlled', value: 'Teleop' },
  { label: 'Autonomous · pre-programmed', value: 'Auto' },
  { label: 'Utility · tools and tests', value: 'Utility' },
];

const motorUsage = computed(() => {
  const usage = new Map<string, string[]>();
  for (const mechanism of mechanisms.value) {
    for (const motorId of mechanism.motorIds) {
      const owners = usage.get(motorId) ?? [];
      owners.push(mechanism.name);
      usage.set(motorId, owners);
    }
  }
  return usage;
});

const motorUsageLabel = (motorId: string) => {
  const owners = motorUsage.value.get(motorId) ?? [];
  if (!owners.length) return 'Not grouped into a robot part yet';
  return `Used by ${owners.join(', ')}`;
};

const extensionCount = computed(() => loadedExtensions.value.length);

const serializeWorkspace = (): WorkspaceState =>
  workspace ? Blockly.serialization.workspaces.save(workspace) : {};

const loadStateIntoWorkspace = (state: WorkspaceState) => {
  if (!workspace) return;
  const migratedState = migrateWorkspaceState(state);
  suppressChanges = true;
  Blockly.Events.disable();
  try {
    workspace.clear();
    Blockly.serialization.workspaces.load(migratedState, workspace, undefined);
  } catch (error) {
    console.warn('Failed to load opmode into workspace:', error);
    workspace.clear();
  } finally {
    Blockly.Events.enable();
    suppressChanges = false;
  }
};

// Copy the live workspace back into the selected OpMode or subsystem editor.
const syncActiveTab = () => {
  const subsystem = activeSubsystem();
  if (subsystem && workspace) {
    const state = serializeWorkspace();
    if (JSON.stringify(state) !== JSON.stringify(subsystem.state)) {
      syncingSubsystemWorkspace = true;
      try {
        updateMechanism(subsystem.id, { state });
      } finally {
        syncingSubsystemWorkspace = false;
      }
    }
    return;
  }
  const tab = activeTab();
  if (tab && workspace) {
    tab.state = serializeWorkspace();
  }
};

const projectData = (): ProjectData => ({
  tabs: tabs.value,
  activeTabId: activeTabId.value,
  devices: [...getDevices()],
  extensions: getLoadedExtensions(),
  extensionInstances: [...getExtensionInstances()],
  robotMode: getRobotMode(),
  mechanisms: [...getMechanisms()],
});

const refreshStoredProjects = () => {
  storedProjects.value = listStoredProjects();
};

const persistProject = () => {
  if (restoringProject) return;
  try {
    const saved = activeProjectId.value
      ? saveStoredProject(
          activeProjectId.value,
          projectName.value,
          projectData(),
        )
      : createStoredProject(projectName.value, projectData());
    activeProjectId.value = saved.id;
    projectName.value = saved.name;
    refreshStoredProjects();
  } catch (error) {
    console.warn('Failed to save project:', error);
  }
};

const generateCode = () => {
  syncActiveTab();
  try {
    const code = generateAllOpmodes(tabs.value);
    generatedCode.value =
      code.trim() || '# Add blocks to an OpMode to generate its Python class.';
    generationStatus.value = code.trim()
      ? 'Python generated'
      : 'Waiting for blocks';
  } catch (error) {
    generatedCode.value = 'Error generating code:\n' + (error as Error).stack;
    generationStatus.value = 'Error';
    console.error(error);
  }
};

const selectTab = (id: string) => {
  if (id === activeTabId.value && !activeSubsystemId.value) return;
  syncActiveTab();
  activeSubsystemId.value = '';
  setDeviceFieldScope(null);
  activeTabId.value = id;
  const tab = activeTab();
  if (tab) loadStateIntoWorkspace(tab.state);
  syncToolboxForActive();
  persistProject();
  generateCode();
};

const selectSubsystem = (id: string) => {
  if (id === activeSubsystemId.value) return;
  syncActiveTab();
  const subsystem = getMechanisms().find((mechanism) => mechanism.id === id);
  if (!subsystem) return;
  activeSubsystemId.value = id;
  setDeviceFieldScope(subsystem.motorIds);
  loadStateIntoWorkspace(subsystem.state);
  syncToolboxForActive();
  persistProject();
  generateCode();
};

const selectEditorTab = (value: string | number) => {
  const [kind, id] = String(value).split(':', 2);
  if (!id) return;
  if (kind === 'subsystem') {
    selectSubsystem(id);
  } else if (kind === 'opmode') {
    selectTab(id);
  }
};

const addOpmode = (type: OpModeType) => {
  syncActiveTab();
  activeSubsystemId.value = '';
  setDeviceFieldScope(null);
  const defaultName =
    type === 'Auto'
      ? 'My Autonomous'
      : type === 'Utility'
        ? 'My Utility'
        : 'My Teleop';
  const tab: OpModeTab = {
    id: newTabId(),
    state: makeOpmodeState(type, defaultName),
  };
  tabs.value.push(tab);
  activeTabId.value = tab.id;
  loadStateIntoWorkspace(tab.state);
  syncToolboxForActive();
  persistProject();
  generateCode();
};

const deleteOpmode = (id: string) => {
  const index = tabs.value.findIndex((tab) => tab.id === id);
  if (index === -1) return;

  const wasActive = id === activeTabId.value;
  if (wasActive) activeSubsystemId.value = '';
  tabs.value.splice(index, 1);

  if (!tabs.value.length) {
    // Never leave the project empty.
    const tab: OpModeTab = {
      id: newTabId(),
      state: makeOpmodeState('Teleop', 'My Teleop'),
    };
    tabs.value.push(tab);
    activeTabId.value = tab.id;
    loadStateIntoWorkspace(tab.state);
  } else if (wasActive) {
    const fallback = tabs.value[Math.max(0, index - 1)];
    activeTabId.value = fallback.id;
    loadStateIntoWorkspace(fallback.state);
  }

  syncToolboxForActive();
  persistProject();
  generateCode();
};

const updateActiveOpmodeField = (field: string, value: string) => {
  const details = workspace?.getBlocksByType('sc_opmode_details', false)[0];
  if (details) {
    details.setFieldValue(value, field);
    return;
  }
  const tab = activeTab();
  const rootBlocks = (
    tab?.state as {
      blocks?: {
        blocks?: { type?: string; fields?: Record<string, unknown> }[];
      };
    }
  ).blocks?.blocks;
  const serialized = rootBlocks?.find(
    (block) => block.type === 'sc_opmode_details',
  );
  if (!serialized) return;
  serialized.fields = { ...serialized.fields, [field]: value };
  persistProject();
  generateCode();
};

const updateActiveOpmodeEnabled = (value: unknown) => {
  updateActiveOpmodeField('ENABLED', value ? 'TRUE' : 'FALSE');
};

const updateActiveOpmodeType = (value: unknown) => {
  const type = value === 'Auto' || value === 'Utility' ? value : 'Teleop';
  updateActiveOpmodeField('TYPE', type);
};

const freshProjectData = (): ProjectData => {
  const tab: OpModeTab = {
    id: newTabId(),
    state: makeOpmodeState('Teleop', 'My Teleop'),
  };
  return {
    tabs: [tab],
    activeTabId: tab.id,
    devices: [],
    extensions: [],
    extensionInstances: [],
    robotMode: 'simple',
    mechanisms: [],
  };
};

const applyProject = (project: StoredProject) => {
  restoringProject = true;
  try {
    activeSubsystemId.value = '';
    setDeviceFieldScope(null);
    tabs.value = project.tabs.length
      ? project.tabs.map((tab) => ({
          ...tab,
          state: migrateWorkspaceState(tab.state),
        }))
      : freshProjectData().tabs;
    activeTabId.value = tabs.value.some((tab) => tab.id === project.activeTabId)
      ? project.activeTabId
      : tabs.value[0].id;
    setDevices(project.devices);
    setMechanisms(project.mechanisms);
    setLoadedExtensions(project.extensions);
    setExtensionInstances(project.extensionInstances);
    setRobotMode(project.robotMode);
    motors.value = [...getDevices()];
    mechanisms.value = [...getMechanisms()];
    loadedExtensions.value = getLoadedExtensions();
    extensionObjects.value = [...getExtensionInstances()];
    robotMode.value = getRobotMode();
    activeProjectId.value = project.id;
    projectName.value = project.name;
  } finally {
    restoringProject = false;
  }
};

const loadProject = () => {
  const saved = loadActiveStoredProject();
  if (saved) {
    applyProject(saved);
    refreshStoredProjects();
    return;
  }

  const legacy = loadLegacyProject();
  const created = createStoredProject(
    legacy ? 'Recovered robot' : 'My Robot',
    legacy ?? freshProjectData(),
  );
  applyProject(created);
  refreshStoredProjects();
};

// --- Motors (device registry) ----------------------------------------------

const openMotors = () => {
  motors.value = [...getDevices()];
  setupStep.value = 'motors';
  motorsOpen.value = true;
};

const openSubsystemManager = () => {
  openMotors();
  if (robotMode.value === 'advanced') setupStep.value = 'subsystems';
};

const newEditorMenuItems = computed(() => [
  [
    {
      label: 'TeleOp OpMode',
      description: 'Driver-controlled robot code.',
      onSelect: () => addOpmode('Teleop'),
    },
    {
      label: 'Autonomous OpMode',
      description: 'Robot code that runs on its own.',
      onSelect: () => addOpmode('Auto'),
    },
    {
      label: 'Utility OpMode',
      description: 'A focused test or helper routine.',
      onSelect: () => addOpmode('Utility'),
    },
  ],
  ...(robotMode.value === 'advanced'
    ? [
        [
          {
            label: 'Robot part (subsystem)',
            description: 'Make a named part with its own blocks.',
            onSelect: () => addAndOpenProjectMechanism(),
          },
        ],
      ]
    : []),
]);

const activeEditorMenuItems = computed(() => [
  [
    editingSubsystem.value
      ? {
          label: 'Manage robot parts',
          description: 'Change this robot part and its motors.',
          onSelect: openSubsystemManager,
        }
      : {
          label: 'OpMode settings',
          description: 'Rename it or change its driver-station type.',
          onSelect: () => {
            opmodeSettingsOpen.value = true;
          },
        },
  ],
  ...(!editingSubsystem.value && tabViews.value.length > 1
    ? [
        [
          {
            label: 'Delete OpMode',
            description: 'Permanently remove this OpMode and its blocks.',
            color: 'error',
            onSelect: () => deleteOpmode(activeTabId.value),
          },
        ],
      ]
    : []),
]);

const addMotor = () => {
  addDevice();
};

const removeMotor = (id: string) => {
  removeDevice(id);
};

const numberValue = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const onMotorName = (id: string, value: unknown) => {
  updateDevice(id, { name: String(value ?? '') });
};

const onMotorBus = (id: string, value: unknown) => {
  updateDevice(id, { bus: numberValue(value) });
};

const onMotorDeviceId = (id: string, value: unknown) => {
  updateDevice(id, { deviceId: numberValue(value) });
};

const addProjectMechanism = () => {
  const mechanism = addMechanism({
    motorIds: getDevices()
      .slice(0, 1)
      .map((motor) => motor.id),
  });
  setupStep.value = 'subsystems';
  return mechanism;
};

const addAndOpenProjectMechanism = () => {
  const mechanism = addProjectMechanism();
  selectSubsystem(mechanism.id);
  motorsOpen.value = false;
};

const openSubsystemWorkspace = (id: string) => {
  selectSubsystem(id);
  motorsOpen.value = false;
};

const removeProjectMechanism = (id: string) => {
  removeMechanism(id);
};

const onMechanismName = (id: string, value: unknown) => {
  updateMechanism(id, { name: String(value ?? '') });
};

const toggleMechanismMotor = (
  mechanism: Mechanism,
  motorId: string,
  included: unknown,
) => {
  const selected = new Set(mechanism.motorIds);
  if (included) {
    selected.add(motorId);
  } else {
    selected.delete(motorId);
  }
  updateMechanism(mechanism.id, { motorIds: [...selected] });
};

const updateRobotMode = (value: unknown) => {
  setRobotMode(value);
  if (value !== 'advanced') setupStep.value = 'motors';
};

// --- Named projects --------------------------------------------------------

const openProjects = () => {
  refreshStoredProjects();
  projectsOpen.value = true;
};

const selectStoredProject = (id: string) => {
  if (id === activeProjectId.value) return;
  syncActiveTab();
  persistProject();
  const project = loadStoredProject(id);
  if (!project) return;
  setActiveStoredProject(id);
  applyProject(project);
  const tab = activeTab();
  if (tab) loadStateIntoWorkspace(tab.state);
  syncToolboxForActive();
  generateCode();
  refreshStoredProjects();
};

const createProject = () => {
  syncActiveTab();
  persistProject();
  const created = createStoredProject('New robot', freshProjectData());
  applyProject(created);
  const tab = activeTab();
  if (tab) loadStateIntoWorkspace(tab.state);
  syncToolboxForActive();
  generateCode();
  refreshStoredProjects();
};

const duplicateProject = (project: StoredProject) => {
  const {
    id: _id,
    name,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...data
  } = project;
  const created = createStoredProject(`${name} copy`, data);
  refreshStoredProjects();
  selectStoredProject(created.id);
};

const deleteProject = (id: string) => {
  const nextId = deleteStoredProject(id);
  if (id !== activeProjectId.value) {
    refreshStoredProjects();
    return;
  }
  const next = nextId ? loadStoredProject(nextId) : null;
  if (next) {
    applyProject(next);
  } else {
    const created = createStoredProject('My Robot', freshProjectData());
    applyProject(created);
  }
  const tab = activeTab();
  if (tab) loadStateIntoWorkspace(tab.state);
  syncToolboxForActive();
  generateCode();
  refreshStoredProjects();
};

const renameCurrentProject = (value: unknown) => {
  projectName.value = String(value ?? '');
  persistProject();
};

const downloadCurrentProject = () => {
  syncActiveTab();
  persistProject();
  const project = loadStoredProject(activeProjectId.value);
  if (!project) return;
  const blob = new Blob([exportStoredProject(project)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'robot'}.scblocks.json`;
  link.click();
  URL.revokeObjectURL(url);
};

const importProjectFile = async (file: File) => {
  const backup = parseProjectBackup(await file.text());
  projectImportFile.value = null;
  if (!backup) {
    console.warn(
      'The selected file is not a SystemCore Blocks project backup.',
    );
    return;
  }
  const imported = importStoredProject(backup);
  selectStoredProject(imported.id);
};

watch(projectImportFile, (file) => {
  if (file) void importProjectFile(file);
});

// --- Extensions picker -----------------------------------------------------

const openExtensionPicker = async () => {
  pickerOpen.value = true;
  if (catalogClasses.value.length) return;
  catalogLoading.value = true;
  try {
    const catalog = await ensureCatalogLoaded();
    catalogClasses.value = catalog.classes.map((cls) => ({
      className: cls.className,
      module: cls.module,
      isComponent: cls.isComponent,
    }));
  } finally {
    catalogLoading.value = false;
  }
};

const closePicker = () => {
  pickerOpen.value = false;
  pickerQuery.value = '';
};

const filteredClasses = computed(() => {
  const query = pickerQuery.value.trim().toLowerCase();
  const matches = query
    ? catalogClasses.value.filter((cls) =>
        cls.className.toLowerCase().includes(query),
      )
    : catalogClasses.value;
  return matches.slice(0, 200);
});

const toggleExtension = (className: string) => {
  if (isExtensionLoaded(className)) {
    removeExtension(className);
  } else {
    addExtension(className);
  }
  loadedExtensions.value = getLoadedExtensions();
  syncToolboxForActive();
  persistProject();
  generateCode();
};

const addExtensionObject = (className: string) => {
  // An object implies its library is loaded. The object is then constructed in
  // each generated OpMode and becomes selectable from that library's blocks.
  addExtension(className);
  addExtensionInstance({ className });
  loadedExtensions.value = getLoadedExtensions();
  extensionObjects.value = [...getExtensionInstances()];
  syncToolboxForActive();
  persistProject();
  generateCode();
};

const removeExtensionObject = (id: string) => {
  removeExtensionInstance(id);
};

const updateExtensionObjectName = (id: string, value: unknown) => {
  updateExtensionInstance(id, { name: String(value ?? '') });
};

const updateExtensionObjectArgs = (id: string, value: unknown) => {
  updateExtensionInstance(id, { args: String(value ?? '') });
};

const shortName = (className: string) => simpleName(className);

// After updateToolbox(), rebuild the always-open continuous flyout from the
// newly applied categories.
type ContinuousToolboxLike = {
  getInitialFlyoutContents?: () => unknown;
  getFlyout?: () => {
    show: (items: unknown) => void;
    isVisible: () => boolean;
  } | null;
};

const refreshContinuousFlyout = (ws: Blockly.WorkspaceSvg) => {
  const tb = ws.getToolbox() as unknown as ContinuousToolboxLike | null;
  const flyout = tb?.getFlyout?.();
  if (tb?.getInitialFlyoutContents && flyout?.isVisible()) {
    flyout.show(tb.getInitialFlyoutContents());
  }
};

// The Gamepad category only makes sense in Teleop opmodes, and curated
// extensions can add their own categories. Rebuild the toolbox whenever those
// visible-category flags change. `null` forces a first build.
let toolboxStateKey: string | null = null;

const syncToolboxForActive = () => {
  if (!workspace) return;
  const tab = activeTab();
  const editor = editingSubsystem.value ? 'subsystem' : 'opmode';
  setDeviceFieldScope(activeSubsystem()?.motorIds ?? null);
  const includeGamepad =
    editor === 'opmode' && tab
      ? opmodeInfoFromState(tab.state).type === 'Teleop'
      : false;
  const includeWpilibSensors = isExtensionLoaded(WPILIB_SENSORS_EXTENSION_ID);
  const includeWpilibOutputs = isExtensionLoaded(WPILIB_OUTPUTS_EXTENSION_ID);
  const includeRevSensors = isExtensionLoaded(REV_SENSORS_EXTENSION_ID);
  const nextStateKey = `${editor}:${robotMode.value}:${includeGamepad}:${includeWpilibSensors}:${includeWpilibOutputs}:${includeRevSensors}`;
  if (nextStateKey === toolboxStateKey) return;
  toolboxStateKey = nextStateKey;
  workspace.updateToolbox(
    buildToolbox({
      includeGamepad,
      includeWpilibSensors,
      includeWpilibOutputs,
      includeRevSensors,
      editor,
      robotMode: robotMode.value,
    }),
  );
  refreshContinuousFlyout(workspace);
};

onMounted(() => {
  registerBlockly();
  registerSystemCoreRenderer();

  if (!blocklyDiv.value) {
    throw new Error(`div with id 'blocklyDiv' not found`);
  }

  registerContinuousToolbox();

  // Inject with an empty toolbox first. The continuous toolbox eagerly builds
  // every category's flyout on init, including the dynamic (custom) Devices and
  // Extensions categories — so their callbacks must be registered *before* the
  // real toolbox is applied. We register them, then swap in the full toolbox.
  workspace = Blockly.inject(blocklyDiv.value, {
    toolbox: { kind: 'categoryToolbox', contents: [] },
    renderer: systemCoreRendererName,
    theme: systemCoreTheme,
    trashcan: true,
    zoom: {
      controls: true,
      wheel: true,
      startScale: 0.9,
      maxScale: 2,
      minScale: 0.4,
      scaleSpeed: 1.1,
    },
    plugins: {
      flyoutsVerticalToolbox: 'ContinuousFlyout',
      metricsManager: 'ContinuousMetrics',
      toolbox: 'ContinuousToolbox',
    },
  });

  registerExtensions(workspace, pythonGenerator, openExtensionPicker);
  registerTypedVariableCategory(workspace);
  registerVariableBlocks();
  Object.assign(pythonGenerator.forBlock, variableForBlock);

  // Keep the modal mirror, the device dropdowns and the generated code in sync
  // whenever a motor is added/renamed/removed from the Motors modal.
  onDevicesChanged(() => {
    motors.value = [...getDevices()];
    if (workspace) {
      refreshDeviceFields(workspace);
      refreshMechanismFields(workspace);
    }
    if (restoringProject) return;
    persistProject();
    generateCode();
  });

  onMechanismsChanged(() => {
    mechanisms.value = [...getMechanisms()];
    if (workspace) {
      setDeviceFieldScope(activeSubsystem()?.motorIds ?? null);
      refreshDeviceFields(workspace);
      refreshMechanismFields(workspace);
    }
    if (restoringProject) return;
    if (syncingSubsystemWorkspace) return;
    if (activeSubsystemId.value && !activeSubsystem()) {
      activeSubsystemId.value = '';
      const tab = activeTab();
      if (tab) loadStateIntoWorkspace(tab.state);
      syncToolboxForActive();
    }
    persistProject();
    generateCode();
  });

  onExtensionInstancesChanged(() => {
    extensionObjects.value = [...getExtensionInstances()];
    if (workspace) refreshExtensionInstanceFields(workspace);
    if (restoringProject) return;
    persistProject();
    generateCode();
  });

  onRobotModeChanged(() => {
    robotMode.value = getRobotMode();
    if (restoringProject) return;
    syncToolboxForActive();
    persistProject();
    generateCode();
  });

  // Keep the flyout at a constant size regardless of workspace zoom. By default
  // the flyout scale tracks the workspace scale (getFlyoutScale → targetWorkspace
  // scale, applied in reflowInternal_); pin it so flyout blocks stay constant.
  const flyout = workspace.getFlyout();
  if (flyout) {
    (flyout as unknown as { getFlyoutScale: () => number }).getFlyoutScale =
      () => 0.67;
  }

  // Now that every dynamic-category callback is registered, apply the real
  // toolbox (its gamepad category depends on the active opmode type, so load
  // the project first) and rebuild the (empty) continuous flyout.
  loadProject();
  syncToolboxForActive();
  const active = activeTab();
  if (active) loadStateIntoWorkspace(active.state);
  generateCode();

  workspace.addChangeListener((event: Blockly.Events.Abstract) => {
    if (
      suppressChanges ||
      event.isUiEvent ||
      event.type === Blockly.Events.FINISHED_LOADING ||
      !workspace ||
      workspace.isDragging()
    ) {
      return;
    }

    syncActiveTab();
    // A live edit to the details hat may flip the opmode type (e.g. teleop →
    // auto), which adds/removes the gamepad category.
    syncToolboxForActive();
    persistProject();
    generateCode();
  });

  workspaceResizeObserver = new ResizeObserver(scheduleWorkspaceResize);
  workspaceResizeObserver.observe(blocklyDiv.value);

  window.addEventListener('resize', scheduleWorkspaceResize);
  scheduleWorkspaceResize();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleWorkspaceResize);
  workspaceResizeObserver?.disconnect();
  workspaceResizeObserver = null;
  if (workspaceResizeFrame !== null) {
    window.cancelAnimationFrame(workspaceResizeFrame);
    workspaceResizeFrame = null;
  }
  workspace?.dispose();
  workspace = null;
});
</script>

<template>
  <UApp>
    <main
      class="flex h-screen min-w-[320px] flex-col overflow-hidden bg-slate-100 text-slate-950"
      :class="{ 'hide-code-panel': !showGeneratedCode }"
    >
      <header
        class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 shadow-sm"
      >
        <div class="flex min-w-0 items-center gap-3">
          <div class="min-w-0">
            <h1 class="truncate text-base font-extrabold tracking-tight">
              SystemCore Blocks
            </h1>
            <p class="truncate text-xs font-semibold text-slate-500">
              {{ activeEditorTitle }}
            </p>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1 overflow-x-auto">
          <UBadge color="neutral" variant="soft" class="hidden sm:inline-flex">
            {{ generationStatus }}
          </UBadge>
          <UTooltip text="Toggle blocks palette">
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              :icon="
                showToolbox ? 'i-heroicons-swatch-solid' : 'i-heroicons-swatch'
              "
              @click="showToolbox = !showToolbox"
            />
          </UTooltip>
          <UTooltip text="Toggle generated code">
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              :icon="
                showGeneratedCode
                  ? 'i-heroicons-code-bracket-square-solid'
                  : 'i-heroicons-code-bracket-square'
              "
              @click="showGeneratedCode = !showGeneratedCode"
            />
          </UTooltip>
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            :disabled="editingSubsystem"
            @click="opmodeSettingsOpen = true"
          >
            OpMode
          </UButton>
          <UButton size="sm" @click="openMotors"> Robot Setup </UButton>
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            @click="openProjects"
          >
            Projects
          </UButton>
          <UButton size="sm" @click="openExtensionPicker">
            Libraries
            <span v-if="extensionCount">({{ extensionCount }})</span>
          </UButton>
        </div>
      </header>

      <UDashboardGroup :persistent="false" class="relative min-h-0 flex-1">
        <!-- Left panel: the block workspace. It's the resizable one, so its
             right edge doubles as the draggable divider for the code sidebar. -->
        <UDashboardPanel
          id="workspace"
          resizable
          :default-size="72"
          :min-size="40"
          :max-size="100"
          class="h-full min-h-0"
        >
          <section
            class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] bg-slate-100 p-3"
            aria-label="Block workspace"
          >
            <div
              class="flex min-w-0 items-center gap-1.5 rounded-t-xl border border-slate-200/90 bg-white/95 p-1.5 shadow-sm"
            >
              <div
                class="min-w-0 flex-1 overflow-x-auto scrollbar-thin scrollbar-track-transparent"
              >
                <UTabs
                  :model-value="activeEditorTab"
                  :items="editorTabItems"
                  :content="false"
                  size="sm"
                  class="min-w-max"
                  :ui="{
                    list: 'min-w-max gap-1 rounded-lg bg-slate-100/90 p-1',
                    indicator: 'hidden',
                    trigger:
                      'h-9 max-w-56 rounded-md px-2.5 text-xs font-semibold text-slate-600 transition data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm data-[state=inactive]:hover:bg-slate-200/70',
                  }"
                  @update:model-value="selectEditorTab"
                >
                  <template #default="{ item }">
                    <span
                      class="flex min-w-0 items-center gap-2"
                      :class="{ 'opacity-45': item.isDisabled }"
                    >
                      <span
                        class="size-1.5 shrink-0 rounded-full"
                        :class="editorTabAccent(item)"
                        aria-hidden="true"
                      />
                      <span
                        class="min-w-0 truncate"
                        :class="{ 'line-through': item.isDisabled }"
                      >
                        {{ item.label }}
                      </span>
                      <span
                        class="hidden shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:inline"
                      >
                        {{
                          item.kind === 'subsystem'
                            ? 'mechanism'
                            : item.typeLabel
                        }}
                      </span>
                    </span>
                  </template>
                </UTabs>
              </div>

              <div
                class="flex shrink-0 items-center gap-1 border-l border-slate-200 pl-1.5"
              >
                <UDropdownMenu
                  :items="newEditorMenuItems"
                  :content="{ align: 'end' }"
                >
                  <UButton size="xs" color="primary" variant="solid">
                    New
                    <span
                      class="ml-0.5 text-[10px] opacity-75"
                      aria-hidden="true"
                      >⌄</span
                    >
                  </UButton>
                </UDropdownMenu>
                <UDropdownMenu
                  :items="activeEditorMenuItems"
                  :content="{ align: 'end' }"
                >
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    aria-label="Current tab actions"
                  >
                    <span class="text-base leading-none" aria-hidden="true"
                      >⋯</span
                    >
                  </UButton>
                </UDropdownMenu>
              </div>
            </div>

            <div
              class="min-h-0 overflow-hidden rounded-b-xl border border-slate-200 border-t-0 bg-white shadow-sm"
            >
              <div id="blocklyDiv" ref="blocklyDiv" class="h-full w-full"></div>
            </div>
          </section>
        </UDashboardPanel>

        <UDashboardPanel
          v-if="showGeneratedCode"
          id="code"
          class="h-full min-h-0"
        >
          <aside
            class="flex min-h-0 flex-1 flex-col overflow-hidden bg-white"
            aria-label="Generated code and status"
          >
            <div
              v-if="highlightedCode"
              id="generatedCode"
              class="shiki-code h-full min-h-0 overflow-auto text-[0.8rem] leading-6"
              v-html="highlightedCode"
            ></div>
            <pre
              v-else
              id="generatedCode"
              class="h-full min-h-0 overflow-auto p-3 text-[0.8rem] leading-6 text-slate-100"
            ><code>{{ generatedCode }}</code></pre>
          </aside>
        </UDashboardPanel>
      </UDashboardGroup>
    </main>

    <UModal
      v-model:open="opmodeSettingsOpen"
      title="OpMode settings"
      description="Each tab generates one RobotPy class. Choose how this OpMode appears to the driver station."
      :close="false"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }"
    >
      <template #body>
        <div class="grid gap-4">
          <label class="grid gap-1.5 text-sm font-bold text-slate-700">
            Name
            <UInput
              :model-value="activeTabView?.name ?? ''"
              placeholder="My Teleop"
              @update:model-value="
                updateActiveOpmodeField('NAME', String($event ?? ''))
              "
            />
          </label>
          <label class="grid gap-1.5 text-sm font-bold text-slate-700">
            Runs as
            <USelect
              :model-value="activeTabView?.type ?? 'Teleop'"
              :items="opmodeTypeOptions"
              @update:model-value="updateActiveOpmodeType"
            />
          </label>
          <UCheckbox
            :model-value="activeTabView?.enabled ?? true"
            label="Show this OpMode in the driver station"
            description="Disable it temporarily without deleting its blocks."
            class="rounded-lg border border-slate-200 bg-slate-50 p-3"
            @update:model-value="updateActiveOpmodeEnabled"
          />
          <p
            class="rounded-lg bg-primary-50 px-3 py-2 text-xs font-semibold leading-5 text-primary-800"
          >
            Separate “when this OpMode starts” stacks run in parallel. Triggers
            stay active for the whole OpMode.
          </p>
        </div>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Done</UButton>
      </template>
    </UModal>

    <!-- Robot setup deliberately moves one small decision at a time: choose a
         model, name the physical motors, then (in Advanced) group them into
         child-friendly robot parts with their own block workspaces. -->
    <UModal
      v-model:open="motorsOpen"
      title="Set up your robot"
      description="Give your hardware clear names before you start snapping blocks together."
      :close="false"
      :ui="{
        content: 'w-[calc(100vw-2rem)] max-w-2xl',
        body: 'min-h-0 overflow-hidden',
        footer: 'justify-between',
      }"
    >
      <template #body>
        <div
          class="flex max-h-[min(62vh,560px)] min-h-0 flex-col gap-5 overflow-y-auto pr-1"
        >
          <section aria-labelledby="programming-style-heading">
            <div class="mb-2">
              <h2
                id="programming-style-heading"
                class="text-sm font-black text-slate-900"
              >
                First, choose a programming style
              </h2>
              <p class="mt-0.5 text-xs font-semibold leading-5 text-slate-500">
                You can change this later. Start simple unless your team is
                ready to give each robot part its own blocks.
              </p>
            </div>
            <div
              role="group"
              aria-label="Programming style"
              class="grid gap-2 sm:grid-cols-2"
            >
              <button
                type="button"
                :aria-pressed="robotMode === 'simple'"
                class="rounded-xl border-2 p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                :class="
                  robotMode === 'simple'
                    ? 'border-primary-500 bg-primary-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                "
                @click="updateRobotMode('simple')"
              >
                <span class="block text-sm font-black text-slate-900"
                  >Flat</span
                >
                <span
                  class="mt-1 block text-xs font-semibold leading-5 text-slate-600"
                >
                  Put motor blocks right into an OpMode. Great for learning and
                  small robots.
                </span>
              </button>
              <button
                type="button"
                :aria-pressed="robotMode === 'advanced'"
                class="rounded-xl border-2 p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                :class="
                  robotMode === 'advanced'
                    ? 'border-primary-500 bg-primary-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                "
                @click="updateRobotMode('advanced')"
              >
                <span class="block text-sm font-black text-slate-900"
                  >Structured</span
                >
                <span
                  class="mt-1 block text-xs font-semibold leading-5 text-slate-600"
                >
                  Separate robot mechanisms into their own structured spaces.
                  More flexible, but more complex. Great for more complicated
                  robots.
                </span>
              </button>
            </div>
          </section>

          <nav
            v-if="robotMode === 'advanced'"
            aria-label="Robot setup steps"
            class="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1.5"
          >
            <button
              type="button"
              class="rounded-lg px-3 py-2 text-left text-xs font-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              :class="
                setupStep === 'motors'
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-slate-500 hover:bg-slate-200/70'
              "
              @click="setupStep = 'motors'"
            >
              <span
                class="mr-1.5 inline-grid size-5 place-items-center rounded-full bg-primary-100 text-[0.7rem] text-primary-700"
                >1</span
              >
              Name motors
            </button>
            <button
              type="button"
              class="rounded-lg px-3 py-2 text-left text-xs font-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              :class="
                setupStep === 'subsystems'
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-slate-500 hover:bg-slate-200/70'
              "
              @click="setupStep = 'subsystems'"
            >
              <span
                class="mr-1.5 inline-grid size-5 place-items-center rounded-full bg-primary-100 text-[0.7rem] text-primary-700"
                >2</span
              >
              Make robot mechanisms
            </button>
          </nav>

          <section
            v-if="setupStep === 'motors' || robotMode === 'simple'"
            aria-labelledby="motors-heading"
          >
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p
                  class="text-xs font-black uppercase tracking-wide text-primary-700"
                >
                  Step 1
                </p>
                <h2
                  id="motors-heading"
                  class="text-base font-black text-slate-900"
                >
                  Name your motors
                </h2>
                <p
                  class="mt-0.5 max-w-xl text-xs font-semibold leading-5 text-slate-500"
                >
                  Use names from your robot, like “Left Drive” or “Intake.”
                  Those names show up on your blocks.
                </p>
              </div>
              <UButton size="sm" color="primary" @click="addMotor"
                >+ Add motor</UButton
              >
            </div>

            <div
              v-if="!motors.length"
              class="rounded-xl border-2 border-dashed border-primary-200 bg-primary-50/60 p-5 text-center"
            >
              <p class="text-sm font-black text-slate-900">
                Add your first motor
              </p>
              <p
                class="mx-auto mt-1 max-w-sm text-xs font-semibold leading-5 text-slate-600"
              >
                Start with one motor your team can recognize. You can add the
                rest whenever you are ready.
              </p>
              <UButton class="mt-3" size="sm" color="primary" @click="addMotor"
                >Add a motor</UButton
              >
            </div>

            <ul v-else class="grid gap-2">
              <li
                v-for="motor in motors"
                :key="motor.id"
                class="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_120px_120px_auto] sm:items-end"
              >
                <label
                  class="grid min-w-0 gap-1.5 text-xs font-black text-slate-700"
                >
                  Motor name
                  <UInput
                    size="sm"
                    :model-value="motor.name"
                    placeholder="e.g. Intake"
                    @update:model-value="onMotorName(motor.id, $event)"
                  />
                  <span class="font-semibold text-slate-400">{{
                    motorUsageLabel(motor.id)
                  }}</span>
                </label>
                <label class="grid gap-1.5 text-xs font-black text-slate-700">
                  CAN bus
                  <UInputNumber
                    size="sm"
                    :model-value="motor.bus"
                    :increment="false"
                    :decrement="false"
                    :ui="{ base: 'text-center' }"
                    @update:model-value="onMotorBus(motor.id, $event)"
                  />
                </label>
                <label class="grid gap-1.5 text-xs font-black text-slate-700">
                  Motor ID
                  <UInputNumber
                    size="sm"
                    :model-value="motor.deviceId"
                    :increment="false"
                    :decrement="false"
                    :ui="{ base: 'text-center' }"
                    @update:model-value="onMotorDeviceId(motor.id, $event)"
                  />
                </label>
                <UButton
                  size="sm"
                  color="error"
                  variant="ghost"
                  class="justify-self-end"
                  :aria-label="`Remove ${motor.name}`"
                  @click="removeMotor(motor.id)"
                >
                  Remove
                </UButton>
              </li>
            </ul>

            <div
              v-if="robotMode === 'advanced'"
              class="mt-4 flex items-center justify-between gap-3 rounded-xl border border-primary-100 bg-primary-50 p-3"
            >
              <p class="text-xs font-semibold leading-5 text-primary-900">
                Next, group motors that work together into robot parts.
              </p>
              <UButton
                size="sm"
                color="primary"
                variant="soft"
                @click="setupStep = 'subsystems'"
              >
                Next: robot parts
              </UButton>
            </div>
          </section>

          <section v-else aria-labelledby="robot-parts-heading">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p
                  class="text-xs font-black uppercase tracking-wide text-primary-700"
                >
                  Step 2
                </p>
                <h2
                  id="robot-parts-heading"
                  class="text-base font-black text-slate-900"
                >
                  Make robot parts
                </h2>
                <p
                  class="mt-0.5 max-w-xl text-xs font-semibold leading-5 text-slate-500"
                >
                  A robot part (also called a subsystem) owns the motors,
                  sensors, and RobotPy objects that work together, like an
                  intake, arm, or launcher. It gets its own Blocks tab.
                </p>
              </div>
              <UButton size="sm" color="primary" @click="addProjectMechanism"
                >+ Add robot part</UButton
              >
            </div>

            <div
              v-if="!motors.length"
              class="rounded-xl border border-amber-200 bg-amber-50 p-4"
            >
              <p class="text-sm font-black text-amber-950">
                Start by adding a motor
              </p>
              <p class="mt-1 text-xs font-semibold leading-5 text-amber-900">
                Robot parts are made from the motors you named in Step 1.
              </p>
              <UButton
                class="mt-3"
                size="sm"
                color="warning"
                variant="soft"
                @click="setupStep = 'motors'"
              >
                Go to motors
              </UButton>
            </div>

            <div
              v-else-if="!mechanisms.length"
              class="rounded-xl border-2 border-dashed border-primary-200 bg-primary-50/60 p-5 text-center"
            >
              <p class="text-sm font-black text-slate-900">
                Make your first robot part
              </p>
              <p
                class="mx-auto mt-1 max-w-md text-xs font-semibold leading-5 text-slate-600"
              >
                For example, make an Intake part, check its motor, then use the
                Sensing and Extensions drawers to build its command logic.
              </p>
              <UButton
                class="mt-3"
                size="sm"
                color="primary"
                @click="addProjectMechanism"
                >Make a robot part</UButton
              >
            </div>

            <ul v-else class="grid gap-3">
              <li
                v-for="mechanism in mechanisms"
                :key="mechanism.id"
                class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <label
                    class="grid min-w-0 flex-1 gap-1.5 text-xs font-black text-slate-700"
                  >
                    Robot part name
                    <UInput
                      size="sm"
                      :model-value="mechanism.name"
                      placeholder="e.g. Intake"
                      @update:model-value="
                        onMechanismName(mechanism.id, $event)
                      "
                    />
                  </label>
                  <div class="flex shrink-0 gap-1">
                    <UButton
                      size="sm"
                      color="primary"
                      variant="soft"
                      @click="openSubsystemWorkspace(mechanism.id)"
                    >
                      Open Blocks
                    </UButton>
                    <UButton
                      size="sm"
                      color="error"
                      variant="ghost"
                      :aria-label="`Remove ${mechanism.name}`"
                      @click="removeProjectMechanism(mechanism.id)"
                    >
                      Remove
                    </UButton>
                  </div>
                </div>

                <fieldset class="mt-3">
                  <legend class="text-xs font-black text-slate-700">
                    Which motors move this part?
                  </legend>
                  <p
                    class="mt-0.5 text-xs font-semibold leading-5 text-slate-500"
                  >
                    Check every motor that belongs here. Sensors and named
                    RobotPy objects used in this part are wired automatically
                    from its Blocks workspace.
                  </p>
                  <div class="mt-2 grid gap-2 sm:grid-cols-2">
                    <UCheckbox
                      v-for="motor in motors"
                      :key="motor.id"
                      :model-value="mechanism.motorIds.includes(motor.id)"
                      :label="motor.name"
                      :description="`CAN ${motor.deviceId} · bus ${motor.bus}`"
                      class="min-w-0 rounded-lg border p-2 text-left transition"
                      :class="
                        mechanism.motorIds.includes(motor.id)
                          ? 'border-primary-300 bg-primary-50'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      "
                      @update:model-value="
                        toggleMechanismMotor(mechanism, motor.id, $event)
                      "
                    />
                  </div>
                </fieldset>
              </li>
            </ul>
          </section>
        </div>
      </template>

      <template #footer="{ close }">
        <UButton
          v-if="robotMode === 'advanced' && setupStep === 'subsystems'"
          color="neutral"
          variant="soft"
          @click="setupStep = 'motors'"
        >
          Back to motors
        </UButton>
        <span v-else></span>
        <UButton color="neutral" variant="ghost" @click="close">Close</UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="projectsOpen"
      title="Projects"
      description="Your robot projects are automatically saved in this browser. Download a backup before switching computers."
      :close="false"
      :ui="{
        content: 'w-[calc(100vw-2rem)] max-w-2xl',
        body: 'min-h-0 overflow-hidden',
        footer: 'justify-between',
      }"
    >
      <template #body>
        <div class="flex max-h-[min(58vh,520px)] min-h-0 flex-col gap-3">
          <label class="grid gap-1.5 text-sm font-bold text-slate-700">
            Current project name
            <UInput
              :model-value="projectName"
              placeholder="My Robot"
              @update:model-value="renameCurrentProject($event)"
            />
          </label>

          <div class="flex items-center justify-between gap-3">
            <USeparator label="Saved in this browser" class="flex-1" />
            <UBadge color="success" variant="soft" size="xs">Autosaves</UBadge>
          </div>

          <ul class="grid min-h-0 gap-1 overflow-y-auto">
            <li
              v-for="project in storedProjects"
              :key="project.id"
              class="flex items-center gap-3 rounded-lg border p-2.5"
              :class="
                project.id === activeProjectId
                  ? 'border-primary-300 bg-primary-50'
                  : 'border-slate-200 bg-white'
              "
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-black text-slate-900">
                  {{ project.name }}
                </p>
                <p class="text-xs font-semibold text-slate-400">
                  {{ project.tabs.length }}
                  {{ project.tabs.length === 1 ? 'OpMode' : 'OpModes' }} · saved
                  {{ new Date(project.updatedAt).toLocaleString() }}
                </p>
              </div>
              <UBadge
                v-if="project.id === activeProjectId"
                color="primary"
                variant="soft"
                size="xs"
              >
                Open
              </UBadge>
              <UButton
                v-else
                size="xs"
                color="neutral"
                variant="soft"
                @click="selectStoredProject(project.id)"
              >
                Open
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                @click="duplicateProject(project)"
              >
                Copy
              </UButton>
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                @click="deleteProject(project.id)"
              >
                Delete
              </UButton>
            </li>
          </ul>
        </div>
      </template>

      <template #footer="{ close }">
        <div class="flex flex-wrap gap-2">
          <UButton color="primary" @click="createProject"
            >+ New project</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            @click="downloadCurrentProject"
          >
            Download backup
          </UButton>
          <UFileUpload
            v-model="projectImportFile"
            variant="button"
            label="Import backup"
            accept="application/json,.json,.scblocks.json"
            :file-image="false"
            :preview="false"
          />
        </div>
        <UButton color="neutral" variant="ghost" @click="close">Close</UButton>
      </template>
    </UModal>

    <!-- Extensions picker: curated hand-wrapped extensions plus raw RobotPy classes. -->
    <UModal
      v-model:open="pickerOpen"
      title="Blocks & Libraries"
      description="Start with polished block libraries. Advanced RobotPy classes appear in the Extensions drawer after you add them."
      :close="false"
      :ui="{
        content: 'w-[calc(100vw-2rem)] max-w-2xl',
        body: 'min-h-0 overflow-hidden',
        footer: 'justify-end',
      }"
      @after:leave="pickerQuery = ''"
    >
      <template #body>
        <div
          class="flex max-h-[min(58vh,520px)] min-h-0 flex-col gap-3 overflow-auto"
        >
          <USeparator label="Recommended block libraries" />

          <ul class="grid gap-2 sm:grid-cols-2">
            <li
              v-for="extension in handWrappedExtensions"
              :key="extension.id"
              class="flex min-h-32 flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              :style="{ '--extension-color': extension.color }"
            >
              <div class="flex min-w-0 items-start gap-3">
                <span
                  class="grid size-11 shrink-0 place-items-center rounded-lg bg-[var(--extension-color)] text-lg font-black text-white shadow-sm"
                  aria-hidden="true"
                >
                  WP
                </span>
                <div class="min-w-0">
                  <h3 class="truncate text-sm font-black text-slate-900">
                    {{ extension.name }}
                  </h3>
                  <p
                    class="mt-1 text-xs font-semibold leading-5 text-slate-500"
                  >
                    {{ extension.summary }}
                  </p>
                </div>
              </div>
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 flex-wrap gap-1">
                  <UBadge
                    v-for="chip in extension.chips"
                    :key="chip"
                    color="neutral"
                    variant="soft"
                    size="xs"
                  >
                    {{ chip }}
                  </UBadge>
                </div>
                <UButton
                  size="xs"
                  :color="isExtensionLoaded(extension.id) ? 'error' : 'primary'"
                  :variant="isExtensionLoaded(extension.id) ? 'soft' : 'solid'"
                  @click="toggleExtension(extension.id)"
                >
                  {{ isExtensionLoaded(extension.id) ? 'Remove' : 'Add' }}
                </UButton>
              </div>
            </li>
          </ul>

          <div
            class="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold leading-5 text-blue-900"
          >
            Advanced classes are an escape hatch for RobotPy APIs without a
            dedicated block library. Add a named object, then choose that object
            from the block instead of typing a fragile
            <code>self...</code> target.
          </div>

          <template v-if="extensionObjects.length">
            <USeparator label="Named RobotPy objects" />
            <ul class="grid gap-2">
              <li
                v-for="object in extensionObjects"
                :key="object.id"
                class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center"
              >
                <UInput
                  class="w-full sm:w-1/3 shrink-0"
                  :model-value="object.name"
                  placeholder="object name"
                  @update:model-value="
                    updateExtensionObjectName(object.id, $event)
                  "
                />
                <div class="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    class="shrink-0 truncate font-mono text-xs font-semibold text-slate-500"
                    :title="object.className"
                  >
                    {{ object.className }}
                  </span>
                  <UInput
                    class="min-w-0 flex-1"
                    :model-value="object.args"
                    placeholder="constructor arguments (optional)"
                    :ui="{ base: 'font-mono text-xs' }"
                    @update:model-value="
                      updateExtensionObjectArgs(object.id, $event)
                    "
                  />
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <UButton
                    size="xs"
                    color="error"
                    variant="soft"
                    @click="removeExtensionObject(object.id)"
                  >
                    Remove
                  </UButton>
                  <UButton
                    size="xs"
                    color="primary"
                    variant="soft"
                    @click="addExtensionObject(object.className)"
                  >
                    + Object
                  </UButton>
                </div>
              </li>
            </ul>
          </template>

          <UInput
            v-model="pickerQuery"
            size="lg"
            type="search"
            placeholder="Search classes (e.g. A301, Gyro, Servo)..."
          />

          <USeparator label="Advanced RobotPy classes" />

          <div v-if="catalogLoading" class="grid gap-2">
            <USkeleton
              v-for="index in 5"
              :key="index"
              class="h-14 w-full rounded-lg"
            />
          </div>

          <UEmpty
            v-else-if="!filteredClasses.length"
            title="No matching classes"
            description="Try a different RobotPy class name."
            variant="soft"
          />

          <ul v-else class="grid gap-1">
            <li
              v-for="cls in filteredClasses"
              :key="cls.className"
              class="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-slate-50"
            >
              <div class="min-w-0">
                <span class="block truncate text-sm font-bold">
                  {{ shortName(cls.className) }}
                </span>
                <span
                  class="block truncate text-xs font-semibold text-slate-400"
                >
                  {{ cls.className }}
                </span>
                <UBadge
                  color="neutral"
                  variant="soft"
                  size="xs"
                  class="mt-1 max-w-full truncate"
                >
                  {{ cls.module }}
                </UBadge>
                <UBadge
                  v-if="cls.isComponent"
                  color="primary"
                  variant="soft"
                  size="xs"
                  class="ml-1"
                >
                  component
                </UBadge>
              </div>
              <div class="flex shrink-0 gap-1">
                <UButton
                  size="xs"
                  :color="
                    isExtensionLoaded(cls.className) ? 'error' : 'primary'
                  "
                  :variant="isExtensionLoaded(cls.className) ? 'soft' : 'solid'"
                  @click="toggleExtension(cls.className)"
                >
                  {{ isExtensionLoaded(cls.className) ? 'Remove' : 'Add' }}
                </UButton>
                <UButton
                  size="xs"
                  color="primary"
                  variant="soft"
                  @click="addExtensionObject(cls.className)"
                >
                  + Object
                </UButton>
              </div>
            </li>
          </ul>
        </div>
      </template>

      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="ghost"
          @click="
            close();
            closePicker();
          "
        >
          Close
        </UButton>
      </template>
    </UModal>
  </UApp>
</template>

<style scoped>
/* Shiki injects its own <pre class="shiki"> with an inline background. Make it
   fill the panel and let long lines scroll instead of wrapping. */
.shiki-code :deep(pre.shiki) {
  margin: 0;
  min-height: 100%;
  padding: 0.75rem;
  border-radius: 0;
}

.shiki-code :deep(code) {
  font-family: inherit;
}
</style>
