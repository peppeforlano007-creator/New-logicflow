export const COLORS = {
  background: '#F0F2F5',
  surface: '#FFFFFF',
  surfaceSecondary: '#EEF0F4',
  text: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  primary: '#16A34A',
  primaryMuted: 'rgba(22, 163, 74, 0.10)',
  accent: '#16A34A',
  accentMuted: 'rgba(22, 163, 74, 0.10)',
  warning: '#D97706',
  warningMuted: 'rgba(217, 119, 6, 0.10)',
  danger: '#DC2626',
  dangerMuted: 'rgba(220, 38, 38, 0.10)',
  border: 'rgba(17, 24, 39, 0.08)',
  divider: 'rgba(17, 24, 39, 0.05)',

  // Status colors
  statusImported: '#1A56DB',
  statusImportedBg: 'rgba(26, 86, 219, 0.10)',
  statusReceiving: '#D97706',
  statusReceivingBg: 'rgba(217, 119, 6, 0.10)',
  statusReceived: '#B45309',
  statusReceivedBg: 'rgba(180, 83, 9, 0.10)',
  statusProcessing: '#7C3AED',
  statusProcessingBg: 'rgba(124, 58, 237, 0.10)',
  statusCompleted: '#16A34A',
  statusCompletedBg: 'rgba(22, 163, 74, 0.10)',
};

export type StatusType = 'imported' | 'receiving' | 'received' | 'processing' | 'completed';
export type ItemStatusType = 'pending' | 'processing' | 'completed';

export function getStatusColor(status: StatusType): string {
  switch (status) {
    case 'imported': return COLORS.statusImported;
    case 'receiving': return COLORS.statusReceiving;
    case 'received': return COLORS.statusReceived;
    case 'processing': return COLORS.statusProcessing;
    case 'completed': return COLORS.statusCompleted;
    default: return COLORS.textSecondary;
  }
}

export function getStatusBg(status: StatusType): string {
  switch (status) {
    case 'imported': return COLORS.statusImportedBg;
    case 'receiving': return COLORS.statusReceivingBg;
    case 'received': return COLORS.statusReceivedBg;
    case 'processing': return COLORS.statusProcessingBg;
    case 'completed': return COLORS.statusCompletedBg;
    default: return COLORS.surfaceSecondary;
  }
}

export function getStatusLabel(status: StatusType): string {
  switch (status) {
    case 'imported': return 'Importato';
    case 'receiving': return 'In Ricezione';
    case 'received': return 'Ricevuto';
    case 'processing': return 'In Lavorazione';
    case 'completed': return 'Completato';
    default: return status;
  }
}

export function getItemStatusColor(status: ItemStatusType): string {
  switch (status) {
    case 'pending': return COLORS.textSecondary;
    case 'processing': return COLORS.statusReceiving;
    case 'completed': return COLORS.statusCompleted;
    default: return COLORS.textSecondary;
  }
}

export function getItemStatusBg(status: ItemStatusType): string {
  switch (status) {
    case 'pending': return COLORS.surfaceSecondary;
    case 'processing': return COLORS.statusReceivingBg;
    case 'completed': return COLORS.statusCompletedBg;
    default: return COLORS.surfaceSecondary;
  }
}

export function getItemStatusLabel(status: ItemStatusType): string {
  switch (status) {
    case 'pending': return 'In attesa';
    case 'processing': return 'In lavorazione';
    case 'completed': return 'Completato';
    default: return status;
  }
}
