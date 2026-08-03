/** The project-wide commands architecture selected in Robot Setup. */
export type RobotMode = 'simple' | 'advanced';

let robotMode: RobotMode = 'simple';
const listeners = new Set<() => void>();

export const getRobotMode = () => robotMode;

export const setRobotMode = (next: unknown) => {
  const mode: RobotMode = next === 'advanced' ? 'advanced' : 'simple';
  if (mode === robotMode) return;
  robotMode = mode;
  for (const listener of listeners) listener();
};

export const onRobotModeChanged = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const usesSubsystems = (mode = robotMode) => mode === 'advanced';
