import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { COLORS } from '@/constants/AppColors';
import { SUPABASE_PROJECT_URL, SUPABASE_ANON_TOKEN } from '@/constants/supabase';

const ADMIN_TOKEN = 'Sales123@';

const TAB_PERMISSIONS = [
  { key: 'import', label: 'Import' },
  { key: 'ricezione', label: 'Ricezione' },
  { key: 'lavorazione', label: 'Lavorazione' },
  { key: 'magazzino', label: 'Magazzino' },
  { key: 'export', label: 'Export' },
  { key: 'cassa', label: 'Cassa' },
  { key: 'store_manager', label: 'Store Manager' },
];

interface AdminUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  tab_permissions: string[];
  is_active: boolean;
}

const adminHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SUPABASE_ANON_TOKEN}`,
  'x-admin-token': ADMIN_TOKEN,
};

async function apiFetch(path: string, options?: RequestInit) {
  const url = `${SUPABASE_PROJECT_URL}/functions/v1/${path}`;
  console.log('[AdminPanel] fetch', options?.method ?? 'GET', url);
  const res = await fetch(url, { ...options, headers: adminHeaders });
  console.log('[AdminPanel] response status:', res.status, 'for', path);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

const emptyForm = {
  username: '',
  password: '',
  role: 'user' as 'admin' | 'user',
  tab_permissions: ['import', 'ricezione', 'lavorazione', 'magazzino', 'export'],
  is_active: true,
};

export default function AdminPanel() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    console.log('[AdminPanel] fetchUsers() called');
    setLoadingList(true);
    setListError(null);
    try {
      const data = await apiFetch('admin-list-users');
      const list: AdminUser[] = Array.isArray(data) ? data : (data.users ?? []);
      console.log('[AdminPanel] Loaded', list.length, 'users');
      setUsers(list);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Errore caricamento utenti';
      console.log('[AdminPanel] fetchUsers error:', msg);
      setListError(msg);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const openCreate = () => {
    console.log('[AdminPanel] "Nuovo Utente" button pressed');
    setForm({ ...emptyForm });
    setFormError(null);
    setShowCreateModal(true);
  };

  const openEdit = (u: AdminUser) => {
    console.log('[AdminPanel] Edit button pressed for user:', u.username);
    setEditTarget(u);
    setForm({
      username: u.username,
      password: '',
      role: u.role,
      tab_permissions: [...u.tab_permissions],
      is_active: u.is_active,
    });
    setFormError(null);
    setShowEditModal(true);
  };

  const togglePermission = (key: string) => {
    setForm(prev => {
      const has = prev.tab_permissions.includes(key);
      const updated = has
        ? prev.tab_permissions.filter(p => p !== key)
        : [...prev.tab_permissions, key];
      console.log('[AdminPanel] Toggle permission', key, '->', !has);
      return { ...prev, tab_permissions: updated };
    });
  };

  const handleCreate = async () => {
    console.log('[AdminPanel] "Crea Utente" button pressed, username:', form.username);
    if (!form.username.trim() || !form.password.trim()) {
      setFormError('Username e password sono obbligatori');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch('admin-create-user', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          role: form.role,
          tab_permissions: form.tab_permissions,
        }),
      });
      console.log('[AdminPanel] User created successfully');
      setShowCreateModal(false);
      fetchUsers();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Errore creazione utente';
      console.log('[AdminPanel] Create user error:', msg);
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    console.log('[AdminPanel] "Salva" button pressed for user:', editTarget.username);
    setSaving(true);
    setFormError(null);
    try {
      const body: Record<string, unknown> = {
        id: editTarget.id,
        role: form.role,
        tab_permissions: form.tab_permissions,
        is_active: form.is_active,
      };
      if (form.password.trim()) {
        body.password = form.password;
      }
      await apiFetch('admin-update-user', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      console.log('[AdminPanel] User updated successfully');
      setShowEditModal(false);
      fetchUsers();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Errore aggiornamento utente';
      console.log('[AdminPanel] Update user error:', msg);
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (u: AdminUser) => {
    console.log('[AdminPanel] Delete button pressed for user:', u.username);
    if (u.username === 'admin') {
      Alert.alert('Operazione non consentita', "Non è possibile eliminare l'utente admin.");
      return;
    }
    Alert.alert(
      'Elimina utente',
      `Sei sicuro di voler eliminare "${u.username}"?`,
      [
        { text: 'Annulla', style: 'cancel', onPress: () => console.log('[AdminPanel] Delete cancelled') },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: async () => {
            console.log('[AdminPanel] Confirmed delete for user:', u.username);
            try {
              await apiFetch('admin-delete-user', {
                method: 'POST',
                body: JSON.stringify({ id: u.id }),
              });
              console.log('[AdminPanel] User deleted successfully');
              fetchUsers();
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : 'Errore eliminazione';
              console.log('[AdminPanel] Delete error:', msg);
              Alert.alert('Errore', msg);
            }
          },
        },
      ]
    );
  };

  const handleLogout = async () => {
    console.log('[AdminPanel] Logout button pressed');
    await logout();
  };

  if (user?.role !== 'admin') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.deniedContainer}>
          <Text style={styles.deniedText}>Accesso negato</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderUser = ({ item }: { item: AdminUser }) => {
    const isAdmin = item.role === 'admin';
    const activeLabel = item.is_active ? 'Attivo' : 'Inattivo';
    const activeBg = item.is_active ? COLORS.accentMuted : COLORS.dangerMuted;
    const activeColor = item.is_active ? COLORS.accent : COLORS.danger;
    const roleBg = isAdmin ? COLORS.primaryMuted : COLORS.surfaceSecondary;
    const roleColor = isAdmin ? COLORS.primary : COLORS.textSecondary;
    const roleLabel = isAdmin ? 'Admin' : 'Utente';

    return (
      <View style={styles.userCard}>
        <View style={styles.userCardHeader}>
          <View style={styles.userCardLeft}>
            <Text style={styles.userName}>{item.username}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: roleBg }]}>
                <Text style={[styles.badgeText, { color: roleColor }]}>{roleLabel}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: activeBg }]}>
                <Text style={[styles.badgeText, { color: activeColor }]}>{activeLabel}</Text>
              </View>
            </View>
          </View>
          <View style={styles.userCardActions}>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => openEdit(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.editBtnText}>Modifica</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDelete(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.deleteBtnText}>Elimina</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.permissionsRow}>
          {item.tab_permissions.map(p => {
            const label = TAB_PERMISSIONS.find(t => t.key === p)?.label ?? p;
            return (
              <View key={p} style={styles.permChip}>
                <Text style={styles.permChipText}>{label}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            console.log('[AdminPanel] Back button pressed');
            router.back();
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.backBtnText}>← Indietro</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pannello Admin</Text>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text style={styles.logoutBtnText}>Esci</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loadingList ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Caricamento utenti...</Text>
        </View>
      ) : listError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{listError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchUsers}>
            <Text style={styles.retryBtnText}>Riprova</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={item => item.id}
          renderItem={renderUser}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={styles.sectionTitle}>{users.length} utenti registrati</Text>
          }
        />
      )}

      {/* Floating create button */}
      <TouchableOpacity style={styles.fab} onPress={openCreate} activeOpacity={0.85}>
        <Text style={styles.fabText}>+ Nuovo Utente</Text>
      </TouchableOpacity>

      {/* Create Modal */}
      <Modal visible={showCreateModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nuovo Utente</Text>
            <TouchableOpacity
              onPress={() => {
                console.log('[AdminPanel] Create modal dismissed');
                setShowCreateModal(false);
              }}
            >
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <UserForm
              form={form}
              setForm={setForm}
              togglePermission={togglePermission}
              showPassword
              showActive={false}
            />
            {formError ? (
              <View style={styles.formError}>
                <Text style={styles.formErrorText}>{formError}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleCreate}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Crea Utente</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={showEditModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Modifica Utente</Text>
            <TouchableOpacity
              onPress={() => {
                console.log('[AdminPanel] Edit modal dismissed');
                setShowEditModal(false);
              }}
            >
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <UserForm
              form={form}
              setForm={setForm}
              togglePermission={togglePermission}
              showPassword
              showActive
              usernameReadOnly
            />
            {formError ? (
              <View style={styles.formError}>
                <Text style={styles.formErrorText}>{formError}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleEdit}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Salva</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Sub-component: UserForm ─────────────────────────────────────────────────

interface UserFormProps {
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  togglePermission: (key: string) => void;
  showPassword: boolean;
  showActive: boolean;
  usernameReadOnly?: boolean;
}

function UserForm({ form, setForm, togglePermission, showPassword, showActive, usernameReadOnly }: UserFormProps) {
  return (
    <View>
      <Text style={styles.fieldLabel}>Username</Text>
      <TextInput
        style={[styles.input, usernameReadOnly && styles.inputReadOnly]}
        value={form.username}
        onChangeText={v => setForm(prev => ({ ...prev, username: v }))}
        placeholder="Username"
        placeholderTextColor={COLORS.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!usernameReadOnly}
      />

      {showPassword && (
        <>
          <Text style={styles.fieldLabel}>
            Password{usernameReadOnly ? ' (lascia vuoto per non cambiare)' : ''}
          </Text>
          <TextInput
            style={styles.input}
            value={form.password}
            onChangeText={v => setForm(prev => ({ ...prev, password: v }))}
            placeholder={usernameReadOnly ? 'Nuova password (opzionale)' : 'Password'}
            placeholderTextColor={COLORS.textTertiary}
            secureTextEntry
            autoCapitalize="none"
          />
        </>
      )}

      <Text style={styles.fieldLabel}>Ruolo</Text>
      <View style={styles.roleRow}>
        {(['user', 'admin'] as const).map(r => {
          const selected = form.role === r;
          return (
            <TouchableOpacity
              key={r}
              style={[styles.roleChip, selected && styles.roleChipSelected]}
              onPress={() => {
                console.log('[AdminPanel] Role selected:', r);
                setForm(prev => ({ ...prev, role: r }));
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.roleChipText, selected && styles.roleChipTextSelected]}>
                {r === 'admin' ? 'Admin' : 'Utente'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.fieldLabel}>Permessi Tab</Text>
      <View style={styles.permissionsGrid}>
        {TAB_PERMISSIONS.map(p => {
          const checked = form.tab_permissions.includes(p.key);
          return (
            <TouchableOpacity
              key={p.key}
              style={[styles.permToggle, checked && styles.permToggleChecked]}
              onPress={() => togglePermission(p.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.permToggleText, checked && styles.permToggleTextChecked]}>
                {checked ? '✓ ' : ''}{p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {showActive && (
        <View style={styles.activeRow}>
          <Text style={styles.fieldLabel}>Utente attivo</Text>
          <Switch
            value={form.is_active}
            onValueChange={v => {
              console.log('[AdminPanel] is_active toggled:', v);
              setForm(prev => ({ ...prev, is_active: v }));
            }}
            trackColor={{ false: COLORS.border, true: COLORS.accent }}
            thumbColor="#fff"
          />
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  deniedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deniedText: {
    fontSize: 18,
    color: COLORS.danger,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  backBtnText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  logoutBtn: {
    backgroundColor: COLORS.dangerMuted,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  logoutBtnText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  retryBtn: {
    backgroundColor: COLORS.primaryMuted,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  sectionTitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  userCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  userCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  userCardLeft: {
    flex: 1,
    gap: 6,
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  userCardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  editBtn: {
    backgroundColor: COLORS.primaryMuted,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  editBtnText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  deleteBtn: {
    backgroundColor: COLORS.dangerMuted,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  deleteBtnText: {
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  permissionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  permChip: {
    backgroundColor: COLORS.surfaceSecondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  permChipText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  modalSafe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  modalClose: {
    fontSize: 18,
    color: COLORS.textSecondary,
    padding: 4,
  },
  modalBody: {
    flex: 1,
    padding: 20,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inputReadOnly: {
    opacity: 0.6,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  roleChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  roleChipSelected: {
    backgroundColor: COLORS.primaryMuted,
    borderColor: COLORS.primary,
  },
  roleChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  roleChipTextSelected: {
    color: COLORS.primary,
  },
  permissionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  permToggle: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  permToggleChecked: {
    backgroundColor: COLORS.accentMuted,
    borderColor: COLORS.accent,
  },
  permToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  permToggleTextChecked: {
    color: COLORS.accent,
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  formError: {
    backgroundColor: COLORS.dangerMuted,
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  formErrorText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: '500',
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 40,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
