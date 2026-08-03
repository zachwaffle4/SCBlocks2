import type { Device } from './devices';
import type { ExtensionInstance } from './extensionInstances';
import type { Mechanism } from './mechanisms';
import type { OpModeTab } from './opmodes';
import type { RobotMode } from './robotMode';

/** Versioned, multi-project browser persistence for SystemCore Blocks. */
export const PROJECT_STORE_KEY = 'systemcore-blocks.projects.v1';
export const LEGACY_PROJECT_STORE_KEY = 'opmodeProject.v3';

export type ProjectData = {
  tabs: OpModeTab[];
  activeTabId: string;
  devices: Device[];
  extensions: string[];
  extensionInstances: ExtensionInstance[];
  robotMode: RobotMode;
  mechanisms: Mechanism[];
};

export type StoredProject = ProjectData & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectStore = {
  version: 1;
  activeProjectId: string | null;
  projects: StoredProject[];
};

const emptyStore = (): ProjectStore => ({
  version: 1,
  activeProjectId: null,
  projects: [],
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const browserStorage = () =>
  typeof window === 'undefined' ? null : window.localStorage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asProject = (value: unknown): StoredProject | null => {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null;
  const createdAt =
    typeof value.createdAt === 'string'
      ? value.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof value.updatedAt === 'string' ? value.updatedAt : createdAt;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : newProjectId(),
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : 'Untitled robot',
    createdAt,
    updatedAt,
    tabs: clone(value.tabs) as OpModeTab[],
    activeTabId: typeof value.activeTabId === 'string' ? value.activeTabId : '',
    devices: Array.isArray(value.devices)
      ? (clone(value.devices) as Device[])
      : [],
    extensions: Array.isArray(value.extensions)
      ? value.extensions.filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
    extensionInstances: Array.isArray(value.extensionInstances)
      ? (clone(value.extensionInstances) as ExtensionInstance[])
      : [],
    robotMode: value.robotMode === 'advanced' ? 'advanced' : 'simple',
    mechanisms: Array.isArray(value.mechanisms)
      ? (clone(value.mechanisms) as Mechanism[])
      : [],
  };
};

const readStore = (): ProjectStore => {
  const raw = browserStorage()?.getItem(PROJECT_STORE_KEY);
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.projects))
      return emptyStore();
    return {
      version: 1,
      activeProjectId:
        typeof parsed.activeProjectId === 'string'
          ? parsed.activeProjectId
          : null,
      projects: parsed.projects
        .map(asProject)
        .filter((project): project is StoredProject => project !== null),
    };
  } catch (error) {
    console.warn('Ignoring unreadable SystemCore project store:', error);
    return emptyStore();
  }
};

const writeStore = (store: ProjectStore) => {
  browserStorage()?.setItem(PROJECT_STORE_KEY, JSON.stringify(store));
};

const newProjectId = () =>
  `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const listStoredProjects = () => readStore().projects.map(clone);

export const loadStoredProject = (id: string) => {
  const project = readStore().projects.find((candidate) => candidate.id === id);
  return project ? clone(project) : null;
};

export const loadActiveStoredProject = () => {
  const store = readStore();
  const project =
    store.projects.find(
      (candidate) => candidate.id === store.activeProjectId,
    ) ?? store.projects[0];
  return project ? clone(project) : null;
};

export const saveStoredProject = (
  id: string,
  name: string,
  data: ProjectData,
): StoredProject => {
  const store = readStore();
  const now = new Date().toISOString();
  const index = store.projects.findIndex((project) => project.id === id);
  // Backups are structurally compatible with ProjectData, but deliberately
  // discard their identity/timestamps here: importing must always create a
  // distinct project rather than accidentally overwrite one in this browser.
  const snapshot = clone({
    tabs: data.tabs,
    activeTabId: data.activeTabId,
    devices: data.devices,
    extensions: data.extensions,
    extensionInstances: data.extensionInstances,
    robotMode: data.robotMode,
    mechanisms: data.mechanisms,
  });
  const project: StoredProject = {
    id,
    name: name.trim() || 'Untitled robot',
    createdAt: index === -1 ? now : store.projects[index].createdAt,
    updatedAt: now,
    ...snapshot,
  };
  if (index === -1) store.projects.push(project);
  else store.projects[index] = project;
  store.activeProjectId = id;
  writeStore(store);
  return clone(project);
};

export const createStoredProject = (name: string, data: ProjectData) =>
  saveStoredProject(newProjectId(), name, data);

export const deleteStoredProject = (id: string) => {
  const store = readStore();
  store.projects = store.projects.filter((project) => project.id !== id);
  if (store.activeProjectId === id)
    store.activeProjectId = store.projects[0]?.id ?? null;
  writeStore(store);
  return store.activeProjectId;
};

export const setActiveStoredProject = (id: string) => {
  const store = readStore();
  if (store.projects.some((project) => project.id === id)) {
    store.activeProjectId = id;
    writeStore(store);
  }
};

export const exportStoredProject = (project: StoredProject) =>
  JSON.stringify(
    { format: 'systemcore-blocks-project', version: 1, project },
    null,
    2,
  );

export const parseProjectBackup = (text: string): StoredProject | null => {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || parsed.format !== 'systemcore-blocks-project')
      return null;
    return asProject(parsed.project);
  } catch {
    return null;
  }
};

/** Imports a backup as a new project so it never overwrites the current one. */
export const importStoredProject = (project: StoredProject) =>
  createStoredProject(project.name, project);

/** Reads and converts the pre-v1 single-project blob once, without deleting it. */
export const loadLegacyProject = (): ProjectData | null => {
  const raw = browserStorage()?.getItem(LEGACY_PROJECT_STORE_KEY);
  if (!raw) return null;
  try {
    const project = asProject({
      ...JSON.parse(raw),
      id: 'legacy',
      name: 'Recovered robot',
    });
    if (!project) return null;
    const {
      id: _id,
      name: _name,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...data
    } = project;
    return data;
  } catch (error) {
    console.warn('Ignoring unreadable legacy SystemCore project:', error);
    return null;
  }
};
