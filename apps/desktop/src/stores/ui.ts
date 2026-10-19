import { create } from 'zustand';
import type { Route } from '@pvh/shared/types';
interface UiState { route: Route; search: string; setRoute: (route: Route) => void; setSearch: (search: string) => void }
export const useUi = create<UiState>(set => ({ route: 'dashboard', search: '', setRoute: route => set({ route, search: '' }), setSearch: search => set({ search }) }));