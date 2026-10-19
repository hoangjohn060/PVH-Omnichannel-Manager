import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../../services/desktop';
import { Button } from '../../components/ui/button';

export function EmployeeLogin(){
  const client=useQueryClient();const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [origin,setOrigin]=useState('');
  const configuration=useMutation({mutationFn:()=>unwrap(window.desktop.auth.configure(origin.trim())),onSuccess:()=>{client.clear();void client.invalidateQueries();}});
  const status=useQuery({queryKey:['auth-status'],queryFn:()=>unwrap(window.desktop.auth.status()),refetchInterval:5000,retry:false});
  const identity=useRef<string|undefined>(undefined);
  useEffect(()=>{
    if(!status.data)return;
    const next=status.data.authenticated?`${status.data.principal?.org_id}:${status.data.principal?.user_id}`:'';
    if(identity.current!==undefined&&identity.current!==next){void client.cancelQueries({predicate:query=>query.queryKey[0]!=='auth-status'});client.removeQueries({predicate:query=>query.queryKey[0]!=='auth-status'});}
    identity.current=next;
  },[status.data,client]);
  const action=useMutation({mutationFn:async(logout:boolean)=>logout?unwrap(window.desktop.auth.logout()):unwrap(window.desktop.auth.login({email,password})),onSettled:()=>setPassword(''),onSuccess:async()=>{client.clear();await client.invalidateQueries();}});
  if(status.data?.authenticated)return <section aria-label="Phiên nhân viên" className="panel mb-4 flex items-center justify-between p-3 text-sm"><span>{status.data.principal?.user_id} · {status.data.principal?.role.toUpperCase()} · {status.data.principal?.org_id}</span><Button variant="outline" disabled={action.isPending} onClick={()=>action.mutate(true)}>Đăng xuất</Button></section>;
  if(!status.data?.configured)return <section className="panel mb-4 space-y-3 p-4" aria-label="Thiết lập Gateway"><h2>Chào mừng đến PVH Omnichannel Manager</h2><p>Nhập HTTPS Gateway URL do quản trị viên cung cấp. Chỉ dùng máy chủ của đơn vị triển khai; không nhập URL từ nguồn không tin cậy.</p><form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();configuration.mutate();}}><input aria-label="Gateway URL" type="url" required maxLength={2048} placeholder="https://gateway.example.com" value={origin} onChange={event=>setOrigin(event.target.value)} className="rounded border border-border bg-panel p-2"/><Button disabled={!status.data||configuration.isPending}>Lưu Gateway</Button></form>{configuration.isError&&<p role="alert">Không lưu được Gateway. Chỉ chấp nhận HTTPS origin, không có đường dẫn, tài khoản hoặc query.</p>}{status.isError&&<p role="alert">Không đọc được cấu hình ứng dụng. Hãy khởi động lại hoặc liên hệ quản trị viên.</p>}</section>;
  return <section className="panel mb-4 space-y-3 p-4" aria-label="Đăng nhập nhân viên"><h2>Đăng nhập nhân viên</h2><p className="text-xs text-subtle">{status.data?.configured?'Dùng email và mật khẩu do quản trị viên cấp. D1 là dữ liệu dùng chung.':'BLOCKED · Operator cần cấu hình PVH_GATEWAY_URL là HTTPS origin chung trên mỗi PC.'}</p><form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();action.mutate(false);}}><input aria-label="Email đăng nhập" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} className="rounded border border-border bg-panel p-2"/><input aria-label="Mật khẩu đăng nhập" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} className="rounded border border-border bg-panel p-2"/><Button disabled={!status.data?.configured||action.isPending}>Đăng nhập</Button></form>{action.isError&&<p role="alert">Đăng nhập không thành công. Kiểm tra thông tin, kết nối hoặc giới hạn đăng nhập.</p>}</section>;
}