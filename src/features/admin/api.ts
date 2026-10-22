import { del, get, post, qs } from "@/lib/api/request";

export interface AdminUser { id?: string; email: string; name: string; role: string }
export interface Integration { id: string; name: string; kind: string; status: string; detail: string }
export interface AuditEntry { id: number; ts: string; source: string; actor: string; action: string; detail: string }
export interface BackupMeta { id: string; createdAt: string; createdBy: string; documents: number; bytes: number }
export interface Peer { id: string; status: string; url: string; startedAt: string; note: string }

export const getUsers = () => get<{ users: AdminUser[] }>("/api/admin/users");
export const getIntegrations = () => get<{ integrations: Integration[] }>("/api/admin/integrations");
export const getAudit = (source: string, q: string) => get<{ entries: AuditEntry[]; sources: string[] }>(`/api/admin/audit${qs({ source, q })}`);
export const getBackups = () => get<{ backups: BackupMeta[] }>("/api/admin/backups");
export const createBackup = () => post<BackupMeta>("/api/admin/backups");
export const deleteBackup = (id: string) => del<{ ok: boolean }>(`/api/admin/backups/${encodeURIComponent(id)}`);
export const restoreBackup = (id: string, operator: string) => post<{ ok: boolean }>(`/api/admin/backups/${encodeURIComponent(id)}/restore`, { operator });
export const startPeer = () => post<Peer>("/api/admin/peer/start");
