import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SheetsSnapshot } from '@pvh/shared/types/sheets';
import { inboxRequest } from '../inbox/inbox';
import { Button } from '../../components/ui/button';

export function SheetsSettings(){
  const client=useQueryClient();const [spreadsheetId,setSpreadsheetId]=useState('');const [redact,setRedact]=useState<boolean|null>(null);
  const snapshot=useQuery({queryKey:['sheets-settings'],queryFn:()=>inboxRequest<SheetsSnapshot>('sheets'),retry:false,refetchInterval:10000});
  const action=useMutation({mutationFn:({path,body}:{path:string;body:unknown})=>inboxRequest(`sheets/${path}`,body),onSuccess:async()=>{await client.invalidateQueries({queryKey:['sheets-settings']});toast.success('Đã xử lý yêu cầu. Xem trạng thái/nhật ký để xác nhận đồng bộ.');},onError:error=>toast.error(error.message)});
  const data=snapshot.data;const config=data?.config;const disabled=action.isPending||!data;
  return <section className="panel mt-5 max-w-4xl space-y-4 p-5"><h2>Google Sheets</h2>
    <p className="text-sm text-subtle">Database là nguồn chính. Sheets chỉ là bản báo cáo; chỉ ADMIN được cấu hình. Service Account do admin sở hữu, khóa và token chỉ lưu mã hóa tại gateway.</p>
    {snapshot.isPending&&<p>Đang kiểm tra gateway…</p>}{snapshot.isError&&<p role="alert">{snapshot.error.message}</p>}
    {data&&<><p>Kết nối Google: {data.credential?data.credential.client_email:'Chưa có Service Account. Admin cần chạy provision-sheets.mjs tại backend; không nhập private key vào ứng dụng.'}</p>
      <Button variant="outline" disabled={disabled||!data.credential||!config} onClick={()=>action.mutate({path:'check',body:{}})}>Kết nối / Kiểm tra quyền / Tạo tab</Button>
      <label className="block text-sm">Spreadsheet ID<input aria-label="Spreadsheet ID" className="mt-2 block w-full rounded border border-border bg-panel p-2" placeholder={config?.spreadsheet_id??'Nhập ID của spreadsheet trống dành riêng cho báo cáo'} value={spreadsheetId} onChange={e=>setSpreadsheetId(e.target.value)} disabled={Boolean(config)}/></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Ẩn dữ liệu nhạy cảm trên Sheets" checked={redact??Boolean(config?.redact??true)} onChange={e=>setRedact(e.target.checked)}/>Ẩn tên/ID nền tảng của khách và nội dung tin trên Sheets (mặc định bật)</label>
      <p className="text-xs text-subtle">Đang cấu hình: {config?(config.redact?'Ẩn dữ liệu nhạy cảm':'Có xuất nội dung/tên khách'):'Chưa lưu'}. Không chèn/xóa/sort dòng trong bốn tab; dùng tab báo cáo riêng. Không xuất media URL cho đến khi kiểm chứng public/an toàn.</p>
      <Button disabled={disabled||!data.credential||(!config&&!/^[a-zA-Z0-9_-]{20,150}$/.test(spreadsheetId))} onClick={()=>action.mutate({path:'configure',body:{spreadsheetId:config?.spreadsheet_id??spreadsheetId,redact:redact??Boolean(config?.redact??true)}})}>Lưu cấu hình (tạm dừng đồng bộ)</Button>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled||!config||(!config.enabled&&!config.verified_at)} onClick={()=>action.mutate({path:'enabled',body:{enabled:!config?.enabled}})}>{config?.enabled?'Tắt đồng bộ':'Bật đồng bộ'}</Button>
        <Button disabled={disabled||!config?.verified_at||Boolean(config.next_attempt>Date.now())} onClick={()=>action.mutate({path:'sync',body:{}})}>Đồng bộ ngay</Button>
        <Button variant="outline" disabled={disabled||!config?.verified_at||Boolean(config.next_attempt>Date.now())} onClick={()=>action.mutate({path:'retry',body:{}})}>Đồng bộ lại bản ghi lỗi</Button></div>
      {config?.error&&<p role="alert">{config.error}{config.next_attempt>Date.now()?` · Chờ đến ${new Date(config.next_attempt).toLocaleString('vi-VN')}`:''}</p>}
      <p role="status">Đang chờ: {data.counts.pending} · Thành công: {data.counts.success} · Lỗi: {data.counts.failed}</p>
      <p className="text-sm">Lần đồng bộ xác nhận gần nhất: {config?.last_sync_at?new Date(config.last_sync_at).toLocaleString('vi-VN'):'Chưa có'}</p>
      <h3>Nhật ký đồng bộ</h3>{data.logs.length?data.logs.map(item=><p key={item.id} className="border-b border-border py-2 text-xs">{new Date(item.created_at).toLocaleString('vi-VN')} · {item.code} · {item.record_count} bản ghi</p>):<p className="text-sm text-subtle">Chưa có nhật ký. Không có dữ liệu test giả ở production.</p>}
    </>}
  </section>;
}