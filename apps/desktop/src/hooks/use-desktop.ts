import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@pvh/shared/types';
import { unwrap } from '../services/desktop';
export const useBootstrap = () => useQuery({ queryKey: ['bootstrap'], queryFn: () => unwrap(window.desktop.bootstrap()), staleTime: 30_000, retry: 1 });
export function useSettings() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (patch: Partial<Settings>) => unwrap(window.desktop.updateSettings(patch)), onSuccess: () => client.invalidateQueries({ queryKey: ['bootstrap'] }) });
}