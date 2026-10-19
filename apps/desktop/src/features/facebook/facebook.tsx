import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/alert-dialog';
import { unwrap } from '../../services/desktop';
export function FacebookFeature({ embedded = false }: { embedded?: boolean }) {
  const client = useQueryClient();
  const [transactionId, setTransactionId] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const snapshot = useQuery({ queryKey: ['facebook'], queryFn: () => unwrap(window.desktop.facebook.snapshot()), refetchInterval: 15000 });
  const transaction = useQuery({ queryKey: ['facebook-oauth', transactionId], queryFn: () => unwrap(window.desktop.facebook.transaction(transactionId)), enabled: Boolean(transactionId), refetchInterval: query => ['EXPIRED', 'ERROR'].includes(query.state.data?.status ?? '') ? false : 2000 });
  const page = snapshot.data?.pages.find(item => item.id === connectionId) ?? snapshot.data?.pages[0];
  const id = page?.id ?? '';
  const refresh = async (): Promise<void> => { await client.invalidateQueries({ queryKey: ['facebook'] }); await Promise.all([client.invalidateQueries({ queryKey: ['facebook-messages'] }), client.invalidateQueries({ queryKey: ['bootstrap'] })]); };
  const connect = useMutation({ mutationFn: () => unwrap(window.desktop.facebook.connect()), onSuccess: value => setTransactionId(value.id), onError: error => toast.error(error.message) });
  const select = useMutation({ mutationFn: (pageId: string) => unwrap(window.desktop.facebook.select(transactionId, pageId)), onSuccess: async value => { setConnectionId(value.id); await refresh(); toast.info(`Page: ${value.status}`); }, onError: async error => { toast.error(error.message); await refresh(); } });
  const action = useMutation({ mutationFn: (name: 'check' | 'disconnect') => unwrap(window.desktop.facebook.action(id, name)), onSuccess: refresh, onError: async error => { toast.error(error.message); await refresh(); } });
  return <div className="space-y-5"><div>{embedded ? <h2>Facebook Fanpage</h2> : <><p className="eyebrow">SETTINGS · FACEBOOK</p><h1>Facebook Fanpage</h1></>}<p className="mt-2 text-sm text-subtle">Meta OAuth chính thức · Token chỉ lưu mã hóa tại gateway. Không đăng nhập trong webview.</p></div>
    <section className="panel space-y-3 p-5"><Button disabled={!snapshot.data?.configured || connect.isPending} onClick={() => connect.mutate()}>Kết nối Facebook</Button><Button variant="outline" onClick={() => void refresh()}>Làm mới trạng thái</Button>
      {snapshot.isPending && <p>Đang kiểm tra gateway…</p>}{snapshot.isError && <p role="alert">{snapshot.error.message}</p>}{snapshot.data?.blocked && <p role="status">{snapshot.data.blocked}</p>}
      {transactionId && <div><p>OAuth: {transaction.data?.status ?? 'Đang kiểm tra'} {transaction.data?.error}</p>{transaction.isError && <p role="alert">{transaction.error.message}</p>}{transaction.data?.pages.map(candidate => <Button className="m-1" variant="outline" key={candidate.pageId} disabled={select.isPending} onClick={() => select.mutate(candidate.pageId)}>Chọn {candidate.name} · {candidate.pageId}</Button>)}<p className="text-xs text-subtle">Đăng nhập và cấp quyền trong trình duyệt hệ thống; quay lại đây chọn Page. Giao dịch hết hạn sau 5 phút.</p></div>}
      {!snapshot.data?.pages.length && <p>Chưa có Fanpage được kết nối. Không hiển thị Page mẫu.</p>}
      {snapshot.data?.pages.map(item => <button key={item.id} className={`mr-2 rounded-lg border p-3 text-left ${id === item.id ? 'border-blue-500' : 'border-border'}`} onClick={() => setConnectionId(item.id)}><strong>{item.name}</strong><span className="block text-xs">{item.pageId} · {item.status}</span></button>)}
    </section>
    {page && <><section className="panel space-y-3 p-5"><h2>{page.name} · {page.status}</h2><p className="text-sm">Quyền: {page.permissions.join(', ') || 'Chưa xác nhận'}</p><p className="text-sm">Webhook subscription: {page.webhook ? 'Đã kiểm tra trên Meta' : 'Chưa xác nhận'} · Kiểm tra: {page.checkedAt ? new Date(page.checkedAt).toLocaleString('vi-VN') : 'Chưa kiểm tra'}</p>{page.error && <p role="alert">{page.error}</p>}<div className="flex gap-2"><Button variant="outline" disabled={action.isPending} onClick={() => action.mutate('check')}>Kiểm tra quyền / token / webhook</Button><Button variant="outline" disabled={connect.isPending} onClick={() => connect.mutate()}>Kết nối lại</Button><ConfirmDialog title="Ngắt kết nối Fanpage?" description="Gateway sẽ hủy subscription ứng dụng và xóa Page token đang lưu. Lịch sử tin nhắn vẫn được giữ." trigger={<Button variant="outline" disabled={action.isPending}>Ngắt kết nối</Button>} onConfirm={() => action.mutate('disconnect')}/></div></section>
      <section className="panel p-5"><h2>Hội thoại Messenger</h2><p className="mt-2 text-sm text-subtle">Đọc và trả lời trong Hộp thư chung. Màn hình này chỉ quản lý kết nối Page; gửi tin yêu cầu job bền vững và RBAC trên gateway.</p></section></>}
    <section className="panel p-5"><h2>Nhật ký lỗi Graph API</h2><p className="mb-3 text-xs text-subtle">Code/subcode/trace thực; không lưu token hoặc nội dung lỗi có thể chứa credential.</p>{snapshot.data?.logs.map(log => <p key={log.id} className="border-b border-border py-2 font-mono text-xs">{new Date(log.createdAt).toLocaleString('vi-VN')} · {log.code} · {log.connectionId ?? 'OAuth'} · trace: {log.trace ?? '—'}</p>)}</section>
  </div>;
}