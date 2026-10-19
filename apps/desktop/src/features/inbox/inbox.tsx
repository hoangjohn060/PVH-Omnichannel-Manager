import { VirtualTimeline } from '../../components/virtual-timeline';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageCircle, UserRound } from 'lucide-react';
import type { InboxConversation, InboxDetail, InboxMessage, InboxSession } from '@pvh/shared/types/inbox';
import { unwrap } from '../../services/desktop';
import { Button } from '../../components/ui/button';

export const inboxRequest = <T,>(path:string,body?:unknown):Promise<T> => unwrap(window.desktop.inbox.request<T>({path,...(body===undefined?{}:{body})}));
const date = (time:number):string => new Date(time).toLocaleString('vi-VN');
function Avatar({name}:{name:string}) { return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-500/15 text-blue-500" aria-label={`Avatar ${name}`}>{name.trim().slice(0,2).toLocaleUpperCase('vi') || <UserRound size={18}/>}</span>; }
function PlatformIcon({platform}:{platform:'zalo'|'facebook'}) { return platform==='facebook'?<span aria-label="Facebook" className="font-bold text-blue-500">f</span>:<MessageCircle size={14} aria-label="Zalo"/>; }

export function UnifiedInbox() {
  const client=useQueryClient();
  const [q,setQ]=useState(''); const [search,setSearch]=useState(''); const [platform,setPlatform]=useState(''); const [channel,setChannel]=useState('');
  const [before,setBefore]=useState(''); const [pages,setPages]=useState<string[]>([]);const [selected,setSelected]=useState('');
  const session=useQuery({queryKey:['inbox-session'],queryFn:()=>inboxRequest<InboxSession>('session'),retry:false,refetchInterval:60000});
  const list=useQuery({queryKey:['inbox-list',search,platform,channel,before],queryFn:()=>inboxRequest<{items:InboxConversation[];next:string|null}>(`conversations?${new URLSearchParams({q:search,platform,channel,...(before?{before}:{})})}`),enabled:Boolean(session.data)});
  const cursors=useRef<Record<string,number>>({});
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(q);setBefore('');setPages([]);},350);return()=>clearTimeout(timer);},[q]);
  useEffect(()=>{
    if(!session.data)return;
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const sync=async():Promise<void>=>{
      let dirty=false;let delay=15000;
      if(document.visibilityState==='visible')try{
        const results=await Promise.allSettled(session.data.channels.map(async ch=>{
          const result=await inboxRequest<{items:{seq:number;conversation_id:string}[];cursor:number;more:boolean}>(`changes?${new URLSearchParams({channel:ch.id,...(cursors.current[ch.id]===undefined?{}:{after:String(cursors.current[ch.id])})})}`);
          cursors.current[ch.id]=result.cursor;if(result.more)delay=1000;return result.items.length>0;
        }));dirty=results.some(result=>result.status==='fulfilled'&&result.value);
        if(results.some(result=>result.status==='rejected'))delay=60000;
      }catch{delay=60000;}
      if(dirty&&!stopped)await Promise.all([client.invalidateQueries({queryKey:['inbox-list']}),client.invalidateQueries({queryKey:['inbox-detail']}),client.invalidateQueries({queryKey:['inbox-jobs']})]);
      if(!stopped)timer=setTimeout(()=>{void sync();},delay+Math.floor(Math.random()*3000));
    };
    void sync();return()=>{stopped=true;clearTimeout(timer);};
  },[session.data,client]);
  const chosen=list.data?.items.find(item=>item.id===selected);
  return <div className="space-y-4"><div className="flex items-center justify-between"><div><p className="eyebrow">PHASE 04</p><h1>Hộp thư hợp nhất</h1></div><p className="text-xs text-subtle">{session.data?`${session.data.principal.user_id} · ${session.data.principal.role.toUpperCase()}`:'Chưa xác thực gateway'}</p></div>
    {session.isError?<section className="panel p-5" role="status"><strong>BLOCKED · {session.error.message}</strong><p className="mt-2 text-sm">Cần HTTPS gateway, credential cá nhân và quyền inbox. Không hiển thị tin mẫu. Zalo cục bộ phải được admin đăng ký connector trước khi đồng bộ.</p><Button className="mt-3" variant="outline" onClick={()=>void session.refetch()}>Kết nối lại</Button></section>:null}
    <div className="grid min-h-[610px] grid-cols-[minmax(240px,28%)_minmax(300px,1fr)_minmax(220px,25%)] divide-x divide-border overflow-hidden rounded-xl border border-border bg-panel" data-testid="unified-inbox">
      <section className="flex min-w-0 flex-col" aria-label="Danh sách hội thoại"><div className="space-y-2 border-b border-border p-3"><input aria-label="Tìm khách và nội dung" placeholder="Tìm khách, nội dung…" value={q} onChange={e=>setQ(e.target.value)} className="w-full rounded border border-border bg-muted p-2 text-sm"/><div className="flex gap-2"><select aria-label="Lọc kênh" value={platform} onChange={e=>{setPlatform(e.target.value);setBefore('');setPages([]);}} className="min-w-0 flex-1 rounded border border-border bg-panel p-2 text-xs"><option value="">Tất cả kênh</option><option value="zalo">Zalo</option><option value="facebook">Facebook</option></select><select aria-label="Lọc inbox" value={channel} onChange={e=>{setChannel(e.target.value);setBefore('');setPages([]);}} className="min-w-0 flex-1 rounded border border-border bg-panel p-2 text-xs"><option value="">Tất cả inbox</option>{session.data?.channels.map(ch=><option key={ch.id} value={ch.id}>{ch.name}</option>)}</select></div></div>
        <div className="max-h-[65vh] flex-1 overflow-auto">{list.isError&&<p role="alert" className="p-3">{list.error.message}</p>}{list.data?.items.map(item=><button key={item.id} onClick={()=>setSelected(item.id)} className={`flex w-full gap-3 border-b border-border p-3 text-left ${selected===item.id?'bg-blue-500/10':'hover:bg-muted'}`}><Avatar name={item.name}/><span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-sm font-semibold"><PlatformIcon platform={item.platform}/><span className="truncate">{item.name}</span>{item.unread>0&&<span className="ml-auto rounded-full bg-blue-500 px-1.5 text-xs text-white">{item.unread}</span>}</span><span className="block truncate text-[11px] text-subtle">{item.channel_name}</span><span className="my-1 block truncate text-xs">{item.preview||'Chưa có nội dung'}</span><span className="block text-[10px] text-subtle">{date(item.updated_at)}</span><span className="block text-[10px]">{item.status} · {item.agent_name??'Chưa phân công'}</span></span></button>)}{session.data&&!list.isPending&&!list.data?.items.length&&<p className="p-4 text-sm text-subtle">Chưa có hội thoại trong các inbox được cấp.</p>}</div>
        <div className="flex justify-between border-t border-border p-2"><Button variant="outline" disabled={!pages.length} onClick={()=>{setBefore(pages.at(-1)??'');setPages(pages.slice(0,-1));}}>Trước</Button><span className="self-center text-xs">Trang {pages.length+1}</span><Button variant="outline" disabled={!list.data?.next} onClick={()=>{setPages([...pages,before]);setBefore(list.data!.next!);}}>Sau</Button></div>
      </section>
      {selected&&session.data?<ConversationWorkspace key={selected} id={selected} session={session.data} initial={chosen}/>:<><section className="grid place-content-center p-6 text-center text-sm text-subtle">Chọn hội thoại để xem và trả lời.</section><aside className="p-4 text-sm text-subtle">Thông tin khách hàng sẽ hiển thị ở đây.</aside></>}
    </div>
  </div>;
}

function ConversationWorkspace({id,session,initial}:{id:string;session:InboxSession;initial?:InboxConversation}) {
  const client=useQueryClient();const [draft,setDraft]=useState('');const [draftReady,setDraftReady]=useState(false);const [draftSaved,setDraftSaved]=useState(true);
  const [note,setNote]=useState('');const [older,setOlder]=useState<InboxMessage[]>([]);const [next,setNext]=useState<string|null>(null);const [loadingOlder,setLoadingOlder]=useState(false);
  const [tags,setTags]=useState('');const [care,setCare]=useState('');const [customerDirty,setCustomerDirty]=useState(false);
  const request=useRef<{id:string;text:string;version:number}|null>(null);const [uncertain,setUncertain]=useState(false);
  const latestDraft=useRef({ready:false,content:''});
  latestDraft.current={ready:draftReady,content:draft};
  const detail=useQuery({queryKey:['inbox-detail',id],queryFn:()=>inboxRequest<InboxDetail>(`conversations/${encodeURIComponent(id)}`)});
  const jobs=useQuery({queryKey:['inbox-jobs',id],queryFn:()=>inboxRequest<{jobs:{id:string;message_id:string;status:string;error:string|null}[]}>(`conversations/${encodeURIComponent(id)}/jobs`)});
  const row=detail.data?.conversation??initial;const writable=session.principal.role!=='viewer';
  useEffect(()=>{if(detail.data&&!draftReady){setDraft(detail.data.draft);setDraftReady(true);setNext(detail.data.next);}},[detail.data,draftReady]);
  useEffect(()=>{if(detail.data&&!customerDirty){setTags((JSON.parse(detail.data.customer.tags) as string[]).join(', '));setCare(detail.data.customer.care_notes);}},[detail.data,customerDirty]);
  useEffect(()=>{
    if(!draftReady||!writable)return;
    setDraftSaved(false);const content=draft;const timer=setTimeout(()=>{void inboxRequest(`conversations/${encodeURIComponent(id)}/draft`,{content}).then(()=>setDraftSaved(true)).catch(()=>setDraftSaved(false));},700);
    return()=>{clearTimeout(timer);};
  },[draft,id,draftReady,writable]);
  useEffect(()=>()=>{const value=latestDraft.current;if(value.ready&&writable)void inboxRequest(`conversations/${encodeURIComponent(id)}/draft`,{content:value.content}).catch(()=>{});},[id,writable]);
  useEffect(()=>{
    if(!detail.data)return;const through=Math.max(0,...detail.data.messages.map(m=>m.received_at));
    void inboxRequest(`conversations/${encodeURIComponent(id)}/read`,{through}).catch(()=>{});
  },[detail.data,id]);
  const refresh=async():Promise<void>=>{await Promise.all([client.invalidateQueries({queryKey:['inbox-list']}),client.invalidateQueries({queryKey:['inbox-detail',id]}),client.invalidateQueries({queryKey:['inbox-jobs',id]})]);};
  const action=useMutation({mutationFn:({suffix,body}:{suffix:string;body:unknown})=>inboxRequest(`conversations/${encodeURIComponent(id)}/${suffix}`,body),onSuccess:async()=>{setNote('');setCustomerDirty(false);await refresh();},onError:async error=>{toast.error(error.message);await refresh();}});
  const send=useMutation({mutationFn:async()=>{
    if(!row)throw new Error('CONVERSATION_REQUIRED');
    request.current??={id:crypto.randomUUID(),text:draft.trim(),version:row.version};setUncertain(true);
    return inboxRequest<{id:string;status:string}>(`conversations/${encodeURIComponent(id)}/send`,{requestId:request.current.id,text:request.current.text,version:request.current.version});
  },onSuccess:async result=>{
    setUncertain(['UNKNOWN','SENDING','PENDING'].includes(result.status));
    if(!['FAILED','UNKNOWN'].includes(result.status)){setDraft('');await inboxRequest(`conversations/${encodeURIComponent(id)}/draft`,{content:''}).catch(()=>{});}
    if(result.status==='FAILED'||result.status==='UNKNOWN')toast.error(`Kết quả gửi: ${result.status}`);
    if(!['UNKNOWN','SENDING','PENDING'].includes(result.status))request.current=null;
    await refresh();
  },onError:async error=>{toast.error(`${error.message}. Dùng “Kiểm tra yêu cầu” để đối chiếu cùng request ID; không gửi lại bằng ID mới.`);await refresh();}});
  const retry=useMutation({mutationFn:(jobId:string)=>inboxRequest(`jobs/${encodeURIComponent(jobId)}/retry`,{}),onSuccess:refresh,onError:error=>toast.error(error.message)});
  const messages=[...new Map([...older,...(detail.data?.messages??[])].map(m=>[m.id,m])).values()].sort((a,b)=>a.source_created_at-b.source_created_at||a.id.localeCompare(b.id));
  const activeJobs=jobs.data?.jobs.some(job=>['PENDING','SENDING','UNKNOWN'].includes(job.status));
  const hasResult=request.current&&jobs.data?.jobs.find(job=>job.id===request.current?.id);
  useEffect(()=>{if(hasResult&&!['PENDING','SENDING','UNKNOWN'].includes(hasResult.status)){setUncertain(false);request.current=null;}},[hasResult]);
  const loadOlder=async():Promise<void>=>{if(!next)return;setLoadingOlder(true);try{const result=await inboxRequest<InboxDetail>(`conversations/${encodeURIComponent(id)}?${new URLSearchParams({before:next})}`);setOlder(current=>[...result.messages,...current]);setNext(result.next);}catch(error){toast.error(error instanceof Error?error.message:'LOAD_FAILED');}finally{setLoadingOlder(false);}};
  return <><section className="flex min-w-0 flex-col" aria-label="Nội dung hội thoại"><header className="space-y-2 border-b border-border p-3"><h2 className="text-sm">{row?.name??'Đang tải…'}</h2><p className="text-xs text-subtle">{row?.channel_name} · {row?.status}</p>{row&&<div className="flex flex-wrap gap-2"><select aria-label="Trạng thái hội thoại" value={row.status} disabled={!writable||action.isPending} onChange={e=>action.mutate({suffix:'update',body:{version:row.version,status:e.target.value,assignedUserId:row.assigned_user_id}})} className="rounded border border-border bg-panel p-1 text-xs"><option>OPEN</option><option>PENDING</option><option>RESOLVED</option></select><select aria-label="Nhân viên phụ trách" value={row.assigned_user_id??''} disabled={!writable||action.isPending} onChange={e=>action.mutate({suffix:'update',body:{version:row.version,status:row.status,assignedUserId:e.target.value||null}})} className="max-w-[180px] rounded border border-border bg-panel p-1 text-xs"><option value="">Chưa phân công</option>{session.members.filter(m=>m.active&&m.role!=='viewer').map(m=><option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></div>}</header>
    {detail.isError&&<p role="alert" className="p-3">{detail.error.message}</p>}
    <VirtualTimeline items={messages} itemKey={m=>m.id} header={next&&<Button variant="outline" disabled={loadingOlder} onClick={()=>void loadOlder()}>Tải tin cũ</Button>}>{m=><article key={m.id} className={`max-w-[90%] rounded-lg border border-border p-3 ${m.direction==='outgoing'?'ml-auto bg-blue-500/10':'mr-auto bg-muted'}`}><div className="mb-2 flex items-center gap-2"><Avatar name={m.direction==='incoming'?m.sender_name:m.agent_name??m.sender_name}/><span className="text-xs font-semibold">{m.direction==='incoming'?m.sender_name:m.agent_name??'Người gửi chưa xác định'}</span></div><p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>{m.attachments!=='[]'&&<details className="mt-2 text-xs"><summary>Ảnh / file — metadata an toàn</summary><p className="break-all text-subtle">{m.attachments}</p><p>Không tự tải URL khách gửi. Preview và tải file có kiểm soát chưa được hỗ trợ.</p></details>}<p className="mt-2 text-[10px] text-subtle">{date(m.source_created_at)} · {m.send_status}</p><p className="text-[10px] text-subtle">{m.sender_origin} · {m.attribution_status}{m.agent_id?` · ${m.agent_id}`:''}</p>{writable&&m.send_status==='FAILED'&&jobs.data?.jobs.filter(j=>j.message_id===m.id&&j.status==='FAILED').map(j=><Button key={j.id} variant="outline" disabled={retry.isPending} onClick={()=>retry.mutate(j.id)}>Thử lại an toàn</Button>)}</article>}</VirtualTimeline>
    <div className="space-y-2 border-t border-border p-3">{!writable?<p className="text-xs text-subtle">VIEWER · Chỉ xem, không được gửi hoặc chỉnh sửa.</p>:<><form onSubmit={e=>{e.preventDefault();send.mutate();}} className="space-y-2"><textarea aria-label="Nội dung trả lời" value={draft} disabled={!draftReady||send.isPending||uncertain} maxLength={row?.platform==='facebook'?2000:5000} onChange={e=>setDraft(e.target.value)} placeholder="Nhập nội dung, emoji…" className="h-20 w-full rounded border border-border bg-panel p-2 text-sm"/><div className="flex items-center justify-between gap-2"><span className="text-[10px] text-subtle">{draftSaved?'Draft đã lưu trên gateway':'Draft chưa đồng bộ'} · {row?.platform==='facebook'?'Áp dụng cửa sổ Meta 24 giờ':'Zalo connector được cấp quyền'}</span><Button disabled={!draft.trim()||!draftReady||send.isPending||uncertain||activeJobs} type="submit">Gửi</Button></div></form>{uncertain&&request.current&&<Button variant="outline" disabled={send.isPending} onClick={()=>send.mutate()}>Kiểm tra yêu cầu</Button>}{activeJobs&&<p className="text-xs text-amber-600">Có yêu cầu pending / đang gửi / chưa xác định. Không tạo yêu cầu mới khi chưa đối chiếu.</p>}<div className="flex gap-2"><input aria-label="Ghi chú nội bộ" value={note} onChange={e=>setNote(e.target.value)} maxLength={5000} placeholder="Ghi chú nội bộ — không gửi khách" className="min-w-0 flex-1 rounded border border-border bg-panel p-2 text-xs"/><Button variant="outline" disabled={!note.trim()||action.isPending} onClick={()=>action.mutate({suffix:'notes',body:{content:note.trim()}})}>Lưu ghi chú</Button></div></>}
      <details className="text-xs"><summary>Ghi chú nội bộ ({detail.data?.notes.length??0})</summary>{detail.data?.notes.map(n=><p className="mt-2 whitespace-pre-wrap border-t border-border pt-2" key={n.id}>{n.content}<span className="block text-subtle">{n.actor_id} · {date(n.created_at)}</span></p>)}</details>
    </div></section>
    <aside className="max-h-[80vh] space-y-4 overflow-auto p-4" aria-label="Thông tin khách hàng"><h2 className="text-sm">Thông tin khách hàng</h2>{detail.data&&<><Avatar name={detail.data.customer.name}/><strong className="block text-sm">{detail.data.customer.name}</strong><dl className="space-y-2 break-all text-xs"><dt className="text-subtle">Platform customer ID</dt><dd>{row?.external_id}</dd><dt className="text-subtle">Kênh liên hệ</dt><dd>{row?.platform} · {row?.channel_name}</dd><dt className="text-subtle">Liên hệ đầu tiên</dt><dd>{date(detail.data.customer.created_at)}</dd><dt className="text-subtle">Liên hệ gần nhất</dt><dd>{date(detail.data.customer.updated_at)}</dd><dt className="text-subtle">Nhân viên phụ trách</dt><dd>{row?.agent_name??'Chưa phân công'}</dd></dl><label className="block text-xs">Tags<input aria-label="Tags khách hàng" value={tags} disabled={!writable} onChange={e=>{setCustomerDirty(true);setTags(e.target.value);}} className="mt-1 w-full rounded border border-border bg-panel p-2"/></label><label className="block text-xs">Ghi chú chăm sóc<textarea aria-label="Ghi chú chăm sóc" value={care} disabled={!writable} maxLength={5000} onChange={e=>{setCustomerDirty(true);setCare(e.target.value);}} className="mt-1 h-24 w-full rounded border border-border bg-panel p-2"/></label>{writable&&<Button variant="outline" disabled={!customerDirty||action.isPending} onClick={()=>action.mutate({suffix:'customer',body:{version:detail.data!.customer.version,tags:tags.split(',').map(t=>t.trim()).filter(Boolean),careNotes:care}})}>Lưu khách hàng</Button>}<section className="space-y-2 border-t border-border pt-3 text-xs"><h3>Thống kê phản hồi</h3><p>Tin đến: {detail.data.stats.incoming??0} · Tin đi: {detail.data.stats.outgoing??0}</p><p>Phản hồi đầu: {detail.data.stats.first_response_ms!==null&&detail.data.stats.first_response_ms>=0?`${Math.round(detail.data.stats.first_response_ms/1000)} giây`:'Chưa đủ dữ liệu'}</p><p className="text-subtle">Tính theo tin gửi đã có kết quả thật; không tính pending/failed.</p></section><section className="space-y-2 border-t border-border pt-3 text-xs"><h3>Lịch sử hội thoại ({detail.data.history.length})</h3>{detail.data.history.map(h=><p key={h.id}>{date(h.created_at)} · {h.status}</p>)}<p className="text-subtle">Identity theo kênh và external ID. Không tự merge theo tên. Chưa hỗ trợ liên kết thủ công.</p></section></>}</aside>
  </>;
}