import { LayoutDashboard, Inbox, MessageCircle, PanelsTopLeft, Users, UserRoundCog, Sheet, ChartNoAxesCombined, History, Settings } from 'lucide-react';
import type { Route } from '@pvh/shared/types';
export const navigation = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard }, { id: 'inbox', label: 'Hộp thư chung', icon: Inbox },
  { id: 'zalo', label: 'Zalo', icon: MessageCircle }, { id: 'facebook', label: 'Facebook Fanpage', icon: PanelsTopLeft },
  { id: 'customers', label: 'Khách hàng', icon: Users }, { id: 'employees', label: 'Nhân viên', icon: UserRoundCog },
  { id: 'google-sheets', label: 'Google Sheets', icon: Sheet }, { id: 'reports', label: 'Báo cáo', icon: ChartNoAxesCombined },
  { id: 'activity', label: 'Lịch sử hoạt động', icon: History }, { id: 'settings', label: 'Cài đặt', icon: Settings },
] satisfies { id: Route; label: string; icon: typeof Inbox }[];