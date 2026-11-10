/**
 * App-wide state, persisted on device with expo-sqlite's key-value store.
 * Components read it with `useAppState(selector)` and change it with `dispatch(action)`.
 */
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { initialState, reducer, type Action, type AppState } from './reducer';

const STORAGE_KEY = 'golf-assistant/state/v1';

function load(): AppState {
  try {
    const raw = Storage.getItemSync(STORAGE_KEY);
    if (!raw) return initialState;
    return { ...initialState, ...(JSON.parse(raw) as Partial<AppState>) };
  } catch (e) {
    console.warn('Could not load saved data, starting fresh', e);
    return initialState;
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist() {
  // Coalesce bursts of changes (e.g. typing a score) into one write.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Storage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((e) => console.warn('Save failed', e));
  }, 250);
}

export function dispatch(action: Action) {
  state = reducer(state, action);
  persist();
  listeners.forEach((l) => l());
}

export function getState() {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe to a slice of state. The selector must return a stable reference for unchanged data. */
export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
