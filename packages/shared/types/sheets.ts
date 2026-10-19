export interface SheetsSnapshot {
  config: {spreadsheet_id:string;enabled:number;redact:number;verified_at:number|null;last_sync_at:number|null;error:string|null;next_attempt:number}|null;
  credential: {client_email:string}|null;
  counts: {total:number;pending:number;success:number;failed:number};
  logs: {id:number;code:string;record_count:number;created_at:number}[];
}