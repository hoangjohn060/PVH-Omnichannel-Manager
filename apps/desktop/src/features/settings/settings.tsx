import { FacebookFeature } from '../facebook/facebook';
import { SheetsSettings } from './sheets';
import { useState } from 'react';
import { toast } from 'sonner';
import { Download, Bell, Monitor } from 'lucide-react';
import type { Bootstrap, Settings as Preferences } from '@pvh/shared/types';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/alert-dialog';
import { useSettings } from '../../hooks/use-desktop';
import { unwrap } from '../../services/desktop';
export function Settings({ data }: { data: Bootstrap }) {
  const mutation = useSettings();
  const [backingUp, setBackingUp] = useState(false);
  const update = (patch: Partial<Preferences>): void => { mutation.mutate(patch, { onSuccess: () => toast.success('Đã lưu cài đặt'), onError: error => toast.error(error.message) }); };
  async function backup(): Promise<void> {
    setBackingUp(true);
    try { const result = await unwrap(window.desktop.backup()); toast.success(`Đã sao lưu: ${result.filename}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Sao lưu thất bại'); }
    finally { setBackingUp(false); }
  }
  const toggles = [{ key: 'minimizeToTray', label: 'Thu nhỏ xuống khay hệ thống', detail: 'Ẩn cửa sổ khi nhấn thu nhỏ.' }, { key: 'runInBackground', label: 'Tiếp tục chạy nền khi đóng cửa sổ', detail: 'Dùng menu khay hệ thống để mở lại hoặc thoát hoàn toàn.' }, { key: 'launchAtLogin', label: 'Khởi động cùng Windows', detail: 'Mở ứng dụng khi đăng nhập Windows.' }, { key: 'notifications', label: 'Thông báo Windows', detail: 'Cho phép ứng dụng hiển thị thông báo hệ thống.' }] as const;
  return <><p className="eyebrow">TÙY CHỌN ỨNG DỤNG</p><h1>Cài đặt</h1><p className="mt-2 text-sm text-subtle">Các thay đổi được lưu tự động trên máy này.</p><section className="panel mt-6 max-w-4xl"><div className="section-heading"><h2 className="flex items-center gap-2"><Monitor size={18}/> Giao diện & vận hành</h2></div><div className="p-5"><label className="flex items-center justify-between border-b border-border pb-5 text-sm font-medium">Chủ đề<select aria-label="Chủ đề" value={data.settings.theme} disabled={mutation.isPending} onChange={event => update({ theme: event.target.value as Preferences['theme'] })} className="rounded-lg border border-border bg-panel px-4 py-2"><option value="system">Theo hệ thống</option><option value="light">Sáng</option><option value="dark">Tối</option></select></label>{toggles.map(item => <label key={item.key} className="flex cursor-pointer items-center justify-between gap-4 border-b border-border py-4 last:border-0"><span><span className="text-sm font-medium">{item.label}</span><span className="mt-1 block text-xs text-subtle">{item.detail}</span></span><input aria-label={item.label} type="checkbox" role="switch" className="h-5 w-5 accent-blue-600" disabled={mutation.isPending} checked={data.settings[item.key]} onChange={event => update({ [item.key]: event.target.checked })}/></label>)}</div></section><section className="panel mt-5 max-w-4xl"><div className="section-heading"><h2>Dữ liệu & thông báo</h2></div><div className="flex flex-wrap gap-3 p-5"><ConfirmDialog title="Tạo bản sao lưu?" description="Tạo bản sao SQLite nhất quán trong thư mục userData/backups. Không thay đổi dữ liệu hiện tại." onConfirm={() => void backup()} trigger={<Button variant="outline" disabled={backingUp}><Download size={16}/>{backingUp ? 'Đang sao lưu…' : 'Sao lưu ngay'}</Button>}/><Button variant="outline" onClick={() => { void unwrap(window.desktop.notify({ title: 'PVH Omnichannel Manager', body: 'Thông báo kiểm tra từ ứng dụng desktop.' })).then(shown => shown ? toast.success('Đã gửi thông báo Windows') : toast.info('Thông báo đang tắt hoặc không được hỗ trợ')).catch(error => toast.error(String(error))); }}><Bell size={16}/>Thử thông báo</Button></div></section><section className="mt-5 max-w-4xl"><FacebookFeature embedded/></section><SheetsSettings/></>;
}