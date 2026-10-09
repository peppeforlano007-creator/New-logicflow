export interface SupplierFile {
  id: string;
  file_name: string;
  original_format: 'csv' | 'xlsx';
  status: 'imported' | 'receiving' | 'received' | 'processing' | 'completed';
  column_headers: string[];
  extra_columns: string[];
  imported_at: string;
  received_at: string | null;
  completed_at: string | null;
  imported_by: string | null;
  notes: string | null;
  // Legacy column selector (kept for backward compat)
  identificatore_column?: string | null;
  // Standardized column mappings
  lpn_column?: string | null;
  asin_column?: string | null;
  pkgid_column?: string | null;
  amazonprice_column?: string | null;
  descrizione_column?: string | null;
  adjreason_column?: string | null;
  quantita_column?: string | null;
}

export interface SupplierItem {
  id: string;
  file_id: string;
  row_index: number;
  item_code: string;
  original_data: Record<string, string>;
  extra_data: Record<string, string>;
  status: 'pending' | 'processing' | 'completed';
  processed_at: string | null;
  processed_by: string | null;
  created_at: string;
  quantita?: number;
  quantita_disponibile?: number;
  unit_recovery?: number | null;
}

export interface ReceptionLog {
  id: string;
  file_id: string;
  boxes_received: number;
  received_at: string;
  received_by: string | null;
  notes: string | null;
}
