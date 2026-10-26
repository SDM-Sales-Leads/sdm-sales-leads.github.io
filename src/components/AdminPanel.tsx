import { CrmDropdownLists } from './crm/CrmDropdownLists';
import React, { useState, useEffect } from 'react';
import { TeamImport } from './TeamImport';
import { LandBankConnectionCard } from './LandBankConnectionCard';
import { Ticket, Category, SLAConfig, RolePermissions, Department, Role, ALL_DEPARTMENTS } from '../types';
import { adminService } from '../services/adminService';
import { ticketService } from '../services/ticketService';
import { useAuth } from '../services/AuthContext';
import { useTheme } from '../services/ThemeContext';
import { motion } from 'motion/react';
import { Upload, Download, Plus, Trash2, Save, Mail, ShieldCheck, Send, Loader2, AlertCircle, Edit2, History, CheckCircle2, Palette, Type, Layout, Sparkles, Lock, Eye, CheckSquare, Users } from 'lucide-react';

export const AdminPanel: React.FC = () => {
  const { user, refreshPermissions } = useAuth();
  const [activeTab, setActiveTab] = useState<'users' | 'system' | 'notifications' | 'styling' | 'roles' | 'lists'>('system');
  const { settings, updateSettings } = useTheme();
  const [users, setUsers] = useState<any[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [slaConfigs, setSlaConfigs] = useState<SLAConfig[]>([]);
  const [notificationLogs, setNotificationLogs] = useState<any[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermissions[]>([]);
  const [isSavingRoles, setIsSavingRoles] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [selectedRoleIndex, setSelectedRoleIndex] = useState<number>(0);
  const [selectedRoleForDepts, setSelectedRoleForDepts] = useState<number | null>(null);
  const [localSla, setLocalSla] = useState<SLAConfig[]>([]);
  const [emailConfig, setEmailConfig] = useState<{ host: string; user: string; pass: string; hasPassword: boolean }>({
    host: '', user: '', pass: '', hasPassword: false
  });
  const [aiKey, setAiKey] = useState('');
  const [aiKeySet, setAiKeySet] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [smtpLogs, setSmtpLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [actionStatus, setActionStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingUser, setIsEditingUser] = useState<number | string | null>(null);
  const [editUserData, setEditUserData] = useState({ name: '', email: '', role: '', department: '', teamLeaderId: undefined as string | number | undefined, annualTarget: '' as string | number });
  const [dbStatus, setDbStatus] = useState<'cloud' | 'local'>('local');

  // Form states
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'Requester', department: 'Development' as Department, teamLeaderId: undefined as string | number | undefined, annualTarget: '' as string | number });
  const [newCat, setNewCat] = useState({ type: '', subtype: '', department: 'Development' as Department });

  useEffect(() => {
    loadData(true);
    checkDbStatus();
    fetch('/api/admin/config').then(r => r.ok ? r.json() : null).then(j => j && setAiKeySet(!!j.geminiKeySet)).catch(() => {});
  }, []);

  const checkDbStatus = async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          const data = await res.json();
          setDbStatus(data.database || 'local');
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadData = async (isInitial: any = false) => {
    if (isInitial === true) setIsLoading(true);
    const errors: string[] = [];
    
    try {
      const [uRes, cRes, sRes, eRes, nRes, pRes] = await Promise.allSettled([
        adminService.getUsers({ fresh: true }),
        adminService.getCategories(),
        adminService.getSLA(),
        adminService.getEmailConfig(),
        adminService.getNotificationLogs(),
        adminService.getRolePermissions()
      ]);

      if (uRes.status === 'fulfilled') {
        setUsers(uRes.value || []);
      } else {
        console.error('Failed to load users:', uRes.reason);
        errors.push(`Users: ${uRes.reason instanceof Error ? uRes.reason.message : String(uRes.reason)}`);
      }

      if (cRes.status === 'fulfilled') {
        setCategories(cRes.value || []);
      } else {
        console.error('Failed to load categories:', cRes.reason);
        errors.push(`Categories: ${cRes.reason instanceof Error ? cRes.reason.message : String(cRes.reason)}`);
      }

      if (sRes.status === 'fulfilled') {
        const slaData = sRes.value || [];
        setSlaConfigs(slaData);
        setLocalSla(slaData);
      } else {
        console.error('Failed to load SLA configs:', sRes.reason);
        errors.push(`SLA Configs: ${sRes.reason instanceof Error ? sRes.reason.message : String(sRes.reason)}`);
      }

      if (eRes.status === 'fulfilled') {
        if (eRes.value) {
          setEmailConfig({ host: eRes.value.host || '', user: eRes.value.user || '', pass: '', hasPassword: !!eRes.value.hasPassword });
        }
      } else {
        console.error('Failed to load email config:', eRes.reason);
        errors.push(`Email Config: ${eRes.reason instanceof Error ? eRes.reason.message : String(eRes.reason)}`);
      }

      if (nRes.status === 'fulfilled') {
        setNotificationLogs(nRes.value || []);
      } else {
        console.error('Failed to load notification logs:', nRes.reason);
        errors.push(`Notification Logs: ${nRes.reason instanceof Error ? nRes.reason.message : String(nRes.reason)}`);
      }

      if (pRes.status === 'fulfilled') {
        const permissions = pRes.value || [];

        // the list is exactly what the server holds: a role deleted here must not come back on the next load
        setRolePermissions(permissions);
      } else {
        console.error('Failed to load role permissions:', pRes.reason);
        errors.push(`Role Permissions: ${pRes.reason instanceof Error ? pRes.reason.message : String(pRes.reason)}`);
      }

      if (errors.length > 0) {
        setActionStatus({
          type: 'error',
          message: `Some data failed to load: ${errors.join(', ')}`
        });
      }

    } catch (err) {
      console.error('Critical error in loadData:', err);
      setActionStatus({
        type: 'error',
        message: 'A critical error occurred while loading admin data.'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionStatus(null);
    try {
      const { annualTarget: newTarget, ...userBody } = newUser;
      const created = await adminService.addUser(userBody);
      // the create call does not take the target: set it right after (admins only, sales roles)
      if (newTarget !== '' && created?.id) await adminService.updateUser(created.id, { annualTarget: Number(newTarget) });
      setNewUser({ name: '', email: '', password: '', role: 'Requester', department: 'Development' as Department, teamLeaderId: undefined, annualTarget: '' });
      loadData();
      setActionStatus({ type: 'success', message: created?.temporaryPassword
        ? `User added. Temporary password (shown only now, give it to the user): ${created.temporaryPassword}`
        : 'User added. They must choose their own password at first sign-in.' });
    } catch (err: any) {
      setActionStatus({ type: 'error', message: `Failed to add user: ${err.message}` });
    }
  };

  const handleAddCat = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionStatus(null);
    try {
      await adminService.addCategory(newCat.type, newCat.subtype, newCat.department);
      setNewCat({ type: '', subtype: '', department: 'Development' as Department });
      loadData();
      setActionStatus({ type: 'success', message: 'Category added successfully!' });
    } catch (err: any) {
      setActionStatus({ type: 'error', message: `Failed to add category: ${err.message}` });
    }
  };

  const updatePermission = (idx: number, field: keyof RolePermissions, value: any) => {
    const next = [...rolePermissions];
    next[idx] = { ...next[idx], [field]: value };
    setRolePermissions(next);
  };

  const handleSaveRoles = async () => {
    setIsSavingRoles(true);
    setActionStatus(null);
    try {
      await adminService.saveRolePermissions(rolePermissions, user?.id.toString(), user?.name);
      await refreshPermissions();
      setActionStatus({ type: 'success', message: 'Role permissions saved successfully! Your permissions have been updated.' });
    } catch (err: any) {
      setActionStatus({ type: 'error', message: `Failed to save roles: ${err.message}` });
    } finally {
      setIsSavingRoles(false);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    
    // Check if role already exists
    if (rolePermissions.some(rp => rp.role?.toLowerCase() === newRoleName.trim().toLowerCase())) {
      setActionStatus({ type: 'error', message: `Role "${newRoleName}" already exists!` });
      return;
    }

    setIsCreatingRole(true);
    try {
      const newRole: RolePermissions = {
        role: newRoleName.trim(),
        canViewDashboard: true,
        canViewTickets: true,
        canViewKnowledgeBase: true,
        canViewWorkflowBuilder: false,
        canViewAdminPanel: false,
        canCreateWorkflow: false,
        canApproveWorkflow: false,
        canEditWorkflow: false,
        canCommentWorkflow: false
      };
      
      const updatedRoles = [...rolePermissions, newRole];
      await adminService.saveRolePermissions(updatedRoles);
      setRolePermissions(updatedRoles);
      setNewRoleName('');
      setActionStatus({ type: 'success', message: `Role "${newRoleName}" created successfully!` });
    } catch (err: any) {
      setActionStatus({ type: 'error', message: `Failed to create role: ${err.message}` });
    } finally {
      setIsCreatingRole(false);
    }
  };

  const handleUpdateSLA = async (priority: string, hours: number) => {
    setActionStatus(null);
    try {
      await adminService.updateSLA(priority, hours);
      loadData();
      setActionStatus({ type: 'success', message: `SLA for ${priority} updated!` });
    } catch (err: any) {
      setActionStatus({ type: 'error', message: `Failed to update SLA: ${err.message}` });
    }
  };

  const startEditUser = (user: any) => {
    setIsEditingUser(user.id);
    setEditUserData({ 
      name: user.name, 
      email: user.email, 
      role: user.role || '', 
      department: user.department || '',
      teamLeaderId: user.teamLeaderId,
      annualTarget: user.annualTarget ?? ''
    });
  };

  const handleUpdateUser = async (userId: string | number) => {
    try {
      const { annualTarget: tgt, ...rest } = editUserData;
      await adminService.updateUser(userId, { ...rest, annualTarget: tgt === '' ? null : Number(tgt) });
      setIsEditingUser(null);
      loadData();
      setActionStatus({ type: 'success', message: 'User updated successfully!' });
    } catch (err: any) {
      setActionStatus({ type: 'error', message: `Failed to update user: ${err.message}` });
    }
  };

  const handleSaveEmailConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingEmail(true);
    setEmailStatus(null);
    setSmtpLogs([]);
    setShowLogs(false);
    try {
      const result = await adminService.saveEmailConfig({ host: emailConfig.host, user: emailConfig.user, pass: emailConfig.pass });
      setEmailConfig({ ...emailConfig, pass: '', hasPassword: emailConfig.hasPassword || !!emailConfig.pass });
      if (result.verified) {
        setEmailStatus({ type: 'success', message: 'Saved. The mail server accepted the mailbox.' });
      } else {
        setEmailStatus({ type: 'error', message: `Saved, but the mail server check failed: ${result.error || 'no answer'}` });
      }
    } catch (err: any) {
      setEmailStatus({ type: 'error', message: 'Failed to save configuration: ' + (err.message || err) });
    } finally {
      setIsSavingEmail(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmailTo) return setEmailStatus({ type: 'error', message: 'Please enter a recipient email' });
    setIsTestingEmail(true);
    setEmailStatus(null);
    setSmtpLogs([]);
    setShowLogs(false);
    try {
      const result = await adminService.testEmail(testEmailTo, emailConfig);
      if (result && result.success) setEmailStatus({ type: 'success', message: 'Test e-mail sent. Check the inbox.' });
      else setEmailStatus({ type: 'error', message: (result && result.error) || 'The test e-mail could not be sent.' });
    } catch (err: any) {
      let msg = err.message || err;
      if (typeof msg !== 'string') {
        msg = JSON.stringify(msg);
      }
      setEmailStatus({ type: 'error', message: msg });
    } finally {
      setIsTestingEmail(false);
    }
  };

  const saveAiKey = async (key: string) => {
    try {
      const res = await fetch('/api/admin/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geminiKey: key }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not save the key');
      setAiKeySet(!!key);
      setAiKey('');
      setActionStatus({ type: 'success', message: key ? 'AI key saved.' : 'AI key removed.' });
    } catch (err: any) {
      setActionStatus({ type: 'error', message: err.message });
    }
  };

  if (isLoading) return <div className="p-8">Loading system configuration...</div>;

  const notificationStats = {
    total: notificationLogs.length,
    success: notificationLogs.filter(l => l.status === 'success').length,
    error: notificationLogs.filter(l => l.status === 'error').length,
    rate: notificationLogs.length > 0 
      ? Math.round((notificationLogs.filter(l => l.status === 'success').length / notificationLogs.length) * 100) 
      : 0
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-brand-black">Admin Control Panel</h2>
          <p className="text-brand-gray text-sm">System configuration and user management</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className={`px-4 py-2 rounded-xl border flex items-center gap-2 w-full sm:w-auto glass-panel ${
            dbStatus === 'cloud' 
              ? 'border-emerald-200 text-emerald-700' 
              : 'border-amber-200 text-amber-700'
          }`}>
            <div className={`w-2 h-2 rounded-full ${dbStatus === 'cloud' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {dbStatus === 'cloud' ? 'Google Cloud (Permanent)' : 'Local File (Temporary)'}
            </span>
          </div>
          {actionStatus && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className={`px-4 py-2 rounded-xl border text-[10px] font-bold flex items-center gap-2 glass-panel ${
                actionStatus.type === 'success' ? 'border-emerald-200 text-emerald-700' : 'border-red-200 text-red-700'
              }`}
            >
              {actionStatus.type === 'success' ? <ShieldCheck size={12} /> : <AlertCircle size={12} />}
              {actionStatus.message}
              <button onClick={() => setActionStatus(null)} className="ml-2 hover:opacity-50">×</button>
            </motion.div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-black/5 rounded-2xl w-fit">
        <button 
          onClick={() => setActiveTab('users')}
          className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'users' ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-brand-gray hover:bg-black/5'}`}
        >
          Users & Categories
        </button>
        <button 
          onClick={() => setActiveTab('system')}
          className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'system' ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-brand-gray hover:bg-black/5'}`}
        >
          System Config
        </button>
        <button 
          onClick={() => setActiveTab('notifications')}
          className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'notifications' ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-brand-gray hover:bg-black/5'}`}
        >
          Notification History
        </button>
        <button 
          onClick={() => setActiveTab('styling')}
          className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'styling' ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-brand-gray hover:bg-black/5'}`}
        >
          Styling
        </button>
        <button 
          onClick={() => setActiveTab('roles')}
          className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'roles' ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-brand-gray hover:bg-black/5'}`}
        >
          Roles & Permissions
        </button>
        <button 
          onClick={() => setActiveTab('lists')}
          className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'lists' ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-brand-gray hover:bg-black/5'}`}
        >
          Dropdown Lists
        </button>
      </div>

      {activeTab === 'users' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <div className="xl:col-span-2"><TeamImport onDone={() => loadData(false)} /></div>
          {/* User Management */}
          <div className="bento-card">
            <h3 className="font-bold text-xl mb-6 flex items-center gap-2">
              <Plus className="text-brand-red" /> User Management
            </h3>
            <form onSubmit={handleAddUser} className="grid grid-cols-2 gap-4 mb-8">
              <input 
                className="input-field" 
                placeholder="Full Name" 
                value={newUser.name} 
                onChange={e => setNewUser({...newUser, name: e.target.value})} 
                required
              />
              <input 
                className="input-field" 
                placeholder="Email" 
                type="email"
                value={newUser.email} 
                onChange={e => setNewUser({...newUser, email: e.target.value})} 
                required
              />
              <input 
                className="input-field" 
                placeholder="Temporary password (empty = generate one)" 
                type="password"
                autoComplete="new-password"
                value={newUser.password} 
                onChange={e => setNewUser({...newUser, password: e.target.value})} 
              />
              <select 
                className="input-field"
                value={newUser.role}
                onChange={e => setNewUser({...newUser, role: e.target.value})}
              >
                {rolePermissions.map(rp => (
                  <option key={rp.role} value={rp.role}>{rp.role}</option>
                ))}
              </select>
              <select 
                className="input-field"
                value={newUser.department}
                onChange={e => setNewUser({...newUser, department: e.target.value as Department})}
              >
                <option value="Development">Development</option>
                <option value="Finance">Finance</option>
                <option value="Infrastructure">Infrastructure</option>
                <option value="Sales">Sales</option>
                <option value="CRM">CRM</option>
                <option value="PMO">PMO</option>
                <option value="Procurement">Procurement</option>
                <option value="Community">Community</option>
                <option value="Business development">Business development</option>
                <option value="GM">GM</option>
                <option value="CEO">CEO</option>
                <option value="CFO">CFO</option>
                <option value="Finance OP">Finance OP</option>
                <option value="Finance Dev">Finance Dev</option>
                <option value="Sales Operation">Sales Operation</option>
                <option value="Projects">Projects</option>
                <option value="Legal">Legal</option>
                <option value="Document Control">Document Control</option>
                <option value="Office Manager">Office Manager</option>
                <option value="Sales Team">Sales Team</option>
                <option value="Sales Operation">Sales Operation</option>
              </select>
              {(newUser.role === 'Sales Rep') && (
                <select
                  className="input-field col-span-2"
                  value={newUser.teamLeaderId || ''}
                  onChange={e => setNewUser({...newUser, teamLeaderId: e.target.value ? e.target.value : undefined})}
                >
                  <option value="">No Team Leader Assigned</option>
                  {users.filter(u => u.role === 'Sales Team Leader').map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              )}
              {(newUser.role === 'Sales Rep' || newUser.role === 'Sales Team Leader') && (
                <input
                  type="number" min={0} step={1000}
                  className="input-field col-span-2"
                  placeholder="Annual target (EGP), optional"
                  value={newUser.annualTarget}
                  onChange={e => setNewUser({...newUser, annualTarget: e.target.value})}
                />
              )}
              <button type="submit" className="btn-primary col-span-2">Add User</button>
            </form>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-black/5">
                    <th className="pb-3 font-semibold">Name</th>
                    <th className="pb-3 font-semibold">Role</th>
                    <th className="pb-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {users.map(u => (
                    <tr key={u.id}>
                      <td className="py-3">
                        {isEditingUser === u.id ? (
                          <div className="space-y-2">
                            <input 
                              className="input-field text-xs py-1" 
                              value={editUserData.name}
                              onChange={e => setEditUserData({...editUserData, name: e.target.value})}
                            />
                            <input 
                              className="input-field text-xs py-1" 
                              value={editUserData.email}
                              onChange={e => setEditUserData({...editUserData, email: e.target.value})}
                            />
                            <div className="flex gap-2">
                              <select 
                                className="text-[10px] font-bold uppercase p-1 rounded border border-black/10"
                                value={editUserData.role}
                                onChange={e => setEditUserData({...editUserData, role: e.target.value})}
                              >
                                {rolePermissions.map(rp => (
                                  <option key={rp.role} value={rp.role}>{rp.role}</option>
                                ))}
                              </select>
                              <select 
                                className="text-[10px] font-bold uppercase p-1 rounded border border-black/10"
                                value={editUserData.department}
                                onChange={e => setEditUserData({...editUserData, department: e.target.value})}
                              >
                                <option value="">No Department</option>
                                <option value="Development">Development</option>
                                <option value="Finance">Finance</option>
                                <option value="Infrastructure">Infrastructure</option>
                                <option value="Sales">Sales</option>
                                <option value="CRM">CRM</option>
                                <option value="PMO">PMO</option>
                                <option value="Procurement">Procurement</option>
                                <option value="Community">Community</option>
                                <option value="Business development">Business development</option>
                                <option value="GM">GM</option>
                                <option value="CEO">CEO</option>
                                <option value="CFO">CFO</option>
                <option value="Finance OP">Finance OP</option>
                <option value="Finance Dev">Finance Dev</option>
                <option value="Sales Operation">Sales Operation</option>
                <option value="Projects">Projects</option>
                <option value="Legal">Legal</option>
                <option value="Document Control">Document Control</option>
                <option value="Office Manager">Office Manager</option>
                                <option value="Sales Team">Sales Team</option>
                                <option value="Sales Operation">Sales Operation</option>
                              </select>
                            </div>
                            {(editUserData.role === 'Sales Rep') && (
                              <select 
                                className="text-[10px] font-bold uppercase p-1 rounded border border-black/10 w-full"
                                value={editUserData.teamLeaderId || ''}
                                onChange={e => setEditUserData({...editUserData, teamLeaderId: e.target.value ? e.target.value : undefined})}
                              >
                                <option value="">No Team Leader</option>
                                {users.filter(u => u.role === 'Sales Team Leader').map(leader => (
                                  <option key={leader.id} value={leader.id}>{leader.name}</option>
                                ))}
                              </select>
                            )}
                            {(editUserData.role === 'Sales Rep' || editUserData.role === 'Sales Team Leader') && (
                              <input
                                type="number" min={0} step={1000}
                                className="text-xs p-1 rounded border border-black/10 w-full"
                                placeholder="Annual target (EGP)"
                                value={editUserData.annualTarget}
                                onChange={e => setEditUserData({...editUserData, annualTarget: e.target.value})}
                              />
                            )}
                            <div className="flex gap-2">
                              <button onClick={() => handleUpdateUser(u.id)} className="text-[10px] font-bold text-emerald-600">SAVE</button>
                              <button onClick={() => setIsEditingUser(null)} className="text-[10px] font-bold text-brand-gray">CANCEL</button>
                            </div>
                          </div>
                        ) : (
                          <div className="group flex items-center gap-2">
                            <div>
                              <p className="font-medium">{u.name}</p>
                              <p className="text-xs text-brand-gray">{u.email}</p>
                            </div>
                            <button 
                              onClick={() => startEditUser(u)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-brand-gray hover:text-brand-black transition-all"
                            >
                              <Edit2 size={12} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase w-fit ${
                            u.role === 'Admin' ? 'bg-brand-red/10 text-brand-red' : 
                            u.role === 'Technician' ? 'bg-brand-black/10 text-brand-black' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {u.role}
                          </span>
                          {u.department && (
                            <span className="text-[10px] font-medium text-brand-gray px-1">
                              {u.department}
                            </span>
                          )}
                          {u.annualTarget > 0 && (
                            <span className="text-[10px] font-medium text-brand-gray px-1">
                              Target {Number(u.annualTarget).toLocaleString('en-US')} EGP / yr
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          title="Reset password (generates a temporary one)"
                          aria-label={`Reset password for ${u.name}`}
                          onClick={async () => {
                            if (!window.confirm(`Reset the password of ${u.name}? A temporary password will be shown once.`)) return;
                            try {
                              const r = await adminService.updateUser(u.id, { resetPassword: true });
                              setActionStatus({ type: 'success', message: `Temporary password for ${u.name} (shown only now): ${r.temporaryPassword}` });
                            } catch (err: any) {
                              setActionStatus({ type: 'error', message: err.message });
                            }
                          }}
                          className="text-brand-gray hover:text-brand-black transition-colors mr-3"
                        >
                          <Lock size={16} />
                        </button>
                        <button 
                          aria-label={`Delete ${u.name}`}
                          onClick={async () => {
                            if (!window.confirm(`Delete ${u.name}? Their login is removed and cannot be undone.`)) return;
                            try {
                              await adminService.deleteUser(u.id, user?.id.toString(), user?.name);
                              loadData();
                            } catch (err: any) {
                              setActionStatus({ type: 'error', message: err.message });
                            }
                          }}
                          className="text-brand-gray hover:text-brand-red transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Category Management */}
          <div className="bento-card">
            <h3 className="font-bold text-xl mb-6">Category Management</h3>
            <form onSubmit={handleAddCat} className="flex gap-4 mb-6">
              <input 
                className="input-field" 
                placeholder="Type (e.g. Hardware)" 
                value={newCat.type}
                onChange={e => setNewCat({...newCat, type: e.target.value})}
                required
              />
              <input 
                className="input-field" 
                placeholder="Subtype" 
                value={newCat.subtype}
                onChange={e => setNewCat({...newCat, subtype: e.target.value})}
                required
              />
              <select 
                className="input-field"
                value={newCat.department}
                onChange={e => setNewCat({...newCat, department: e.target.value as Department})}
                required
              >
                <option value="Development">Development</option>
                <option value="Finance">Finance</option>
                <option value="Infrastructure">Infrastructure</option>
                <option value="Sales">Sales</option>
                <option value="CRM">CRM</option>
                <option value="PMO">PMO</option>
                <option value="Procurement">Procurement</option>
                <option value="Community">Community</option>
                <option value="Business development">Business development</option>
                <option value="GM">GM</option>
                <option value="CEO">CEO</option>
                <option value="CFO">CFO</option>
                <option value="Finance OP">Finance OP</option>
                <option value="Finance Dev">Finance Dev</option>
                <option value="Sales Operation">Sales Operation</option>
                <option value="Projects">Projects</option>
                <option value="Legal">Legal</option>
                <option value="Document Control">Document Control</option>
                <option value="Office Manager">Office Manager</option>
                <option value="Sales Team">Sales Team</option>
                <option value="Sales Operation">Sales Operation</option>
              </select>
              <button type="submit" className="btn-primary">Add</button>
            </form>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {categories.map(c => (
                <div key={c.id} className="flex justify-between items-center p-3 bg-white/30 rounded-xl border border-black/5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs uppercase text-brand-red">{c.type}</span>
                      {c.department && (
                        <span className="text-[10px] font-bold bg-brand-black/5 px-1.5 py-0.5 rounded border border-black/5 uppercase">
                          {c.department}
                        </span>
                      )}
                    </div>
                    <p className="font-medium">{c.subtype}</p>
                  </div>
                  <button 
                    onClick={async () => {
                      try {
                        await adminService.deleteCategory(c.id, user?.id.toString(), user?.name);
                        loadData();
                      } catch (err: any) {
                        alert(err.message);
                      }
                    }}
                    className="text-brand-gray hover:text-brand-red"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'lists' && <CrmDropdownLists />}

      {activeTab === 'roles' && (
        <div className="space-y-8">
          <div className="bento-card">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h3 className="font-bold text-xl flex items-center gap-2">
                  <ShieldCheck className="text-brand-red" /> Role-Based Access Control
                </h3>
                <p className="text-brand-gray text-xs mt-1">Define what each role can see and do in the system. <span className="text-brand-red font-bold">Note: Other users will need to refresh their page to see updated permissions.</span></p>
              </div>
              <div className="flex gap-4">
                <form onSubmit={handleCreateRole} className="flex gap-2">
                  <input 
                    className="input-field py-1 text-xs" 
                    placeholder="New Role Name" 
                    value={newRoleName}
                    onChange={e => setNewRoleName(e.target.value)}
                    required
                  />
                  <button 
                    type="submit" 
                    disabled={isCreatingRole}
                    className="btn-primary py-1 px-4 flex items-center gap-2 text-xs"
                  >
                    {isCreatingRole ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
                    Create Role
                  </button>
                </form>
                <button 
                  onClick={handleSaveRoles}
                  disabled={isSavingRoles}
                  className="btn-primary flex items-center gap-2"
                >
                  {isSavingRoles ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  Save Changes
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-1 border border-black/10 rounded-2xl p-4 flex flex-col gap-2 bg-black/5">
                <h4 className="font-bold text-xs uppercase text-brand-gray mb-2 px-2">System Roles</h4>
                {rolePermissions.map((rp, idx) => (
                  <button
                    key={rp.role}
                    onClick={() => setSelectedRoleIndex(idx)}
                    className={`text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all ${selectedRoleIndex === idx ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'hover:bg-black/5 text-brand-black'}`}
                  >
                    <span className="font-bold text-sm">{rp.role}</span>
                    <ShieldCheck size={16} className={selectedRoleIndex === idx ? 'text-white/80' : 'text-brand-gray/50'} />
                  </button>
                ))}
              </div>
              
              {rolePermissions[selectedRoleIndex] && (
                <div className="lg:col-span-3">
                  <div className="flex justify-between items-center mb-6 border-b border-black/5 pb-4">
                    <h3 className="font-bold text-xl">{rolePermissions[selectedRoleIndex].role} Permissions</h3>
                    {rolePermissions[selectedRoleIndex].role !== 'Admin' && users.filter((u) => u.role === rolePermissions[selectedRoleIndex].role).length === 0 && (
                      <button
                        onClick={async () => {
                          const r = rolePermissions[selectedRoleIndex].role;
                          if (!window.confirm(`Delete the role "${r}"? No user has it. This cannot be undone.`)) return;
                          try {
                            const next = rolePermissions.filter((x) => x.role !== r);
                            await adminService.saveRolePermissions(next);
                            setRolePermissions(next); setSelectedRoleIndex(0);
                            setActionStatus({ type: 'success', message: `Role "${r}" deleted.` });
                          } catch (err: any) { setActionStatus({ type: 'error', message: `Could not delete the role: ${err.message}` }); }
                        }}
                        className="px-4 py-2 bg-black/5 text-brand-gray hover:bg-brand-red hover:text-white transition-all rounded-xl font-bold text-xs"
                      >Delete this role</button>
                    )}
                    <button 
                       onClick={() => setSelectedRoleForDepts(selectedRoleIndex)}
                       className="px-4 py-2 bg-brand-red/10 text-brand-red hover:bg-brand-red hover:text-white transition-all rounded-xl font-bold text-xs flex items-center gap-2"
                     >
                       <Layout size={14} /> Department Restrictions
                     </button>
                  </div>
                  
                  <div className="space-y-8">
                    {/* Core System */}
                    <div>
                      <h4 className="font-bold text-xs text-brand-gray uppercase mb-3 tracking-wider">Core System Access</h4>
                      <div className="flex flex-wrap gap-2">
                        <PermissionToggle label="Service desk: overview" active={rolePermissions[selectedRoleIndex].canViewDashboard} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewDashboard', val)} />
                        <PermissionToggle label="Service desk: tickets and new ticket" active={rolePermissions[selectedRoleIndex].canViewTickets} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewTickets', val)} />
                        <PermissionToggle label="Service desk: knowledge base" active={rolePermissions[selectedRoleIndex].canViewKnowledgeBase} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewKnowledgeBase', val)} />
                        <PermissionToggle label="Workflow & SLA" active={rolePermissions[selectedRoleIndex].canViewWorkflowBuilder} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewWorkflowBuilder', val)} />
                        <PermissionToggle label="Setup: users, roles, system" active={rolePermissions[selectedRoleIndex].canViewAdminPanel} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewAdminPanel', val)} />
                      </div>
                    </div>

                    {/* Workflow Actions */}
                    <div>
                      <h4 className="font-bold text-xs text-brand-gray uppercase mb-3 tracking-wider">Workflow Actions</h4>
                      <div className="flex flex-wrap gap-2">
                        <PermissionToggle label="Create Workflows" active={rolePermissions[selectedRoleIndex].canCreateWorkflow} onChange={(val) => updatePermission(selectedRoleIndex, 'canCreateWorkflow', val)} />
                        <PermissionToggle label="Approve Workflows" active={rolePermissions[selectedRoleIndex].canApproveWorkflow} onChange={(val) => updatePermission(selectedRoleIndex, 'canApproveWorkflow', val)} />
                        <PermissionToggle label="Edit Workflows" active={rolePermissions[selectedRoleIndex].canEditWorkflow} onChange={(val) => updatePermission(selectedRoleIndex, 'canEditWorkflow', val)} />
                        <PermissionToggle label="Comment on Workflows" active={rolePermissions[selectedRoleIndex].canCommentWorkflow} onChange={(val) => updatePermission(selectedRoleIndex, 'canCommentWorkflow', val)} />
                      </div>
                    </div>

                    {/* Inquiries Sales */}
                    <div>
                      <h4 className="font-bold text-xs text-brand-gray uppercase mb-3 tracking-wider flex items-center gap-2">
                         <span className="w-2 h-2 rounded-full bg-blue-500"></span> Inquiries Sales Module
                      </h4>
                      <div className="flex flex-wrap gap-2 mb-4">
                        <PermissionToggle label="Access the Sales CRM (Home, Leads, Reports...)" active={!!rolePermissions[selectedRoleIndex].canViewSalesCrm} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesCrm', val)} />
                      </div>
                      
                      {rolePermissions[selectedRoleIndex].canViewSalesCrm && (
                        <div className="pl-4 border-l-2 border-black/5 flex flex-wrap gap-2">
                          <PermissionToggle label="Reports dashboard (Home numbers and Reports)" active={!!rolePermissions[selectedRoleIndex].canViewSalesDashboard} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesDashboard', val)} />
                          <PermissionToggle label="Leads (list, calendar)" active={!!rolePermissions[selectedRoleIndex].canViewSalesLeads} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesLeads', val)} />
                          <PermissionToggle label="Customers: contacts" active={!!rolePermissions[selectedRoleIndex].canViewSalesContacts} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesContacts', val)} />
                          <PermissionToggle label="Customers: corporate accounts" active={!!rolePermissions[selectedRoleIndex].canViewSalesCompanies} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesCompanies', val)} />
                          <PermissionToggle label="Intake: mailbox" active={!!rolePermissions[selectedRoleIndex].canViewSalesMail} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesMail', val)} />
                          <PermissionToggle label="Setup: routing rules, pool and dropdown lists (sees ALL leads)" active={!!rolePermissions[selectedRoleIndex].canViewSalesRules} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesRules', val)} />
                          <PermissionToggle label="Leads: activity log" active={!!rolePermissions[selectedRoleIndex].canViewSalesActivities} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesActivities', val)} />
                          <PermissionToggle label="Reports (all tabs)" active={!!rolePermissions[selectedRoleIndex].canViewSalesReports} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesReports', val)} />
                          <PermissionToggle label="Land and offers: plots, offers, printed offers" active={!!rolePermissions[selectedRoleIndex].canViewSalesPlotsInventory} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesPlotsInventory', val)} />
                          <PermissionToggle label="Intake: Excel import/export and duplicates" active={!!rolePermissions[selectedRoleIndex].canViewSalesTransfer} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesTransfer', val)} />
                          <PermissionToggle label="Deals: won deals and cash (view)" active={!!rolePermissions[selectedRoleIndex].canViewSalesFinance} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesFinance', val)} />
                          <PermissionToggle label="Confirm cash received" active={!!rolePermissions[selectedRoleIndex].canConfirmCash} onChange={(val) => updatePermission(selectedRoleIndex, 'canConfirmCash', val)} />
                          <PermissionToggle label="Deals: contracts (view)" active={!!rolePermissions[selectedRoleIndex].canViewSalesContracts} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesContracts', val)} />
                          <PermissionToggle label="Deals: contracts (manage, Excel import)" active={!!rolePermissions[selectedRoleIndex].canManageContracts} onChange={(val) => updatePermission(selectedRoleIndex, 'canManageContracts', val)} />
                          <PermissionToggle label="Targets" active={!!rolePermissions[selectedRoleIndex].canViewSalesTargets} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesTargets', val)} />
                          <PermissionToggle label="BD and external sales" active={!!rolePermissions[selectedRoleIndex].canViewSalesExternal} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesExternal', val)} />
                          <PermissionToggle label="Setup: lead audit trail" active={!!rolePermissions[selectedRoleIndex].canViewSalesAudit} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewSalesAudit', val)} />
                          <PermissionToggle label="See ALL leads (read-only)" active={!!rolePermissions[selectedRoleIndex].canViewAllLeads} onChange={(val) => updatePermission(selectedRoleIndex, 'canViewAllLeads', val)} />
                          <PermissionToggle label="Edit lead contact details / add unassigned leads (marketing)" active={!!rolePermissions[selectedRoleIndex].canEditLeadIdentity} onChange={(val) => updatePermission(selectedRoleIndex, 'canEditLeadIdentity', val)} />
                          <PermissionToggle label="Distribute leads (all leads, reassign)" active={!!rolePermissions[selectedRoleIndex].canDistributeLeads} onChange={(val) => updatePermission(selectedRoleIndex, 'canDistributeLeads', val)} />
                          <PermissionToggle label="Export the leads list to CSV (follows the filters)" active={!!rolePermissions[selectedRoleIndex].canExportLeads} onChange={(val) => updatePermission(selectedRoleIndex, 'canExportLeads', val)} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* User Role Assignment Summary */}
          <div className="bento-card">
            <h3 className="font-bold text-xl mb-6 flex items-center gap-2">
              <Users className="text-brand-red" /> User Role Assignments
            </h3>
            <p className="text-brand-gray text-xs mb-6">Overview of users currently assigned to each system role</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rolePermissions.map(rp => {
                const usersInRole = users.filter(u => u.role === rp.role);
                return (
                  <div key={rp.role} className="p-4 rounded-2xl bg-black/5 border border-black/5">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-bold text-brand-black">{rp.role}</h4>
                      <span className="px-2 py-0.5 rounded-full bg-brand-red/10 text-brand-red text-[10px] font-bold">
                        {usersInRole.length} {usersInRole.length === 1 ? 'User' : 'Users'}
                      </span>
                    </div>
                    {usersInRole.length > 0 ? (
                      <div className="space-y-2">
                        {usersInRole.slice(0, 5).map(u => (
                          <div key={u.id} className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-brand-red/10 flex items-center justify-center text-brand-red text-[10px] font-bold">
                              {u.name.charAt(0)}
                            </div>
                            <span className="text-xs text-brand-gray truncate">{u.name}</span>
                          </div>
                        ))}
                        {usersInRole.length > 5 && (
                          <p className="text-[10px] text-brand-gray italic pl-8">
                            + {usersInRole.length - 5} more users...
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[10px] text-brand-gray italic">No users assigned to this role</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {selectedRoleForDepts !== null && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bento-card border-2 border-brand-red/20"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="font-bold text-xl flex items-center gap-2">
                    <Layout className="text-brand-red" /> Department Restrictions
                  </h3>
                  <p className="text-brand-gray text-xs">Configuring access for: <span className="text-brand-red font-bold">{rolePermissions[selectedRoleForDepts].role}</span></p>
                </div>
                <button onClick={() => setSelectedRoleForDepts(null)} className="text-brand-gray hover:text-brand-black p-2 bg-black/5 rounded-full">×</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block text-[10px] font-bold mb-4 uppercase tracking-wider text-brand-gray">Can Create Workflows for Departments:</label>
                  <div className="grid grid-cols-2 gap-3">
                    {ALL_DEPARTMENTS.map((dept) => (
                      <label key={dept} className="flex items-center gap-3 p-3 rounded-xl border border-black/5 hover:bg-black/5 cursor-pointer transition-all">
                        <input 
                          type="checkbox" 
                          checked={rolePermissions[selectedRoleForDepts].allowedDepartmentsToCreate?.includes(dept as Department)}
                          onChange={(e) => {
                            const current = rolePermissions[selectedRoleForDepts].allowedDepartmentsToCreate || [];
                            const next = e.target.checked ? [...current, dept as Department] : current.filter(d => d !== dept);
                            updatePermission(selectedRoleForDepts, 'allowedDepartmentsToCreate', next);
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-brand-red focus:ring-brand-red"
                        />
                        <span className="text-xs font-medium">{dept}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold mb-4 uppercase tracking-wider text-brand-gray">Can Approve Workflows for Departments:</label>
                  <div className="grid grid-cols-2 gap-3">
                    {ALL_DEPARTMENTS.map((dept) => (
                      <label key={dept} className="flex items-center gap-3 p-3 rounded-xl border border-black/5 hover:bg-black/5 cursor-pointer transition-all">
                        <input 
                          type="checkbox" 
                          checked={rolePermissions[selectedRoleForDepts].allowedDepartmentsToApprove?.includes(dept as Department)}
                          onChange={(e) => {
                            const current = rolePermissions[selectedRoleForDepts].allowedDepartmentsToApprove || [];
                            const next = e.target.checked ? [...current, dept as Department] : current.filter(d => d !== dept);
                            updatePermission(selectedRoleForDepts, 'allowedDepartmentsToApprove', next);
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-brand-red focus:ring-brand-red"
                        />
                        <span className="text-xs font-medium">{dept}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {activeTab === 'system' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <div className="space-y-8">
          <LandBankConnectionCard />
          <div className="bento-card">
            <h3 className="font-bold text-xl mb-2 flex items-center gap-2">
              <Mail className="text-brand-red" /> Mailbox (Exchange)
            </h3>
            <p className="text-xs text-brand-gray mb-6">
              One mailbox is used to send ticket notifications and to read incoming sales-lead e-mails. The password is stored
              encrypted on the server and is never shown again.
            </p>

            {emailStatus && (
              <div className={`mb-6 p-4 rounded-xl border flex items-center gap-3 ${
                emailStatus.type === 'success' ? 'bg-emerald-50/50 border-emerald-200 text-emerald-700' : 'bg-red-50/50 border-red-200 text-red-700'
              }`} role="status">
                {emailStatus.type === 'success' ? <ShieldCheck size={18} className="shrink-0" /> : <AlertCircle size={18} className="shrink-0" />}
                <p className="text-xs font-bold leading-relaxed">{emailStatus.message}</p>
              </div>
            )}

            <form onSubmit={handleSaveEmailConfig} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase text-brand-gray">Mail server host</label>
                <input className="input-field" placeholder="mail.company.com" value={emailConfig.host || ''}
                  onChange={e => setEmailConfig({ ...emailConfig, host: e.target.value })} />
                <p className="text-[10px] text-brand-gray mt-1">Exchange Web Services over HTTPS (port 443). The certificate is always verified.</p>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-brand-gray">Mailbox user name</label>
                <input className="input-field" autoComplete="off" placeholder="mailbox@company.com" value={emailConfig.user || ''}
                  onChange={e => setEmailConfig({ ...emailConfig, user: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-brand-gray">Password</label>
                <input type="password" className="input-field" autoComplete="new-password"
                  placeholder={emailConfig.hasPassword ? 'Saved. Type only to replace it' : 'Mailbox password'}
                  value={emailConfig.pass || ''} onChange={e => setEmailConfig({ ...emailConfig, pass: e.target.value })} />
              </div>
              <button type="submit" disabled={isSavingEmail} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
                {isSavingEmail ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                {isSavingEmail ? 'Saving and checking...' : 'Save and verify'}
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-black/5">
              <h4 className="text-xs font-bold uppercase text-brand-gray mb-4">Send a test e-mail</h4>
              <div className="flex gap-2">
                <input className="input-field flex-1" type="email" placeholder="Send test email to..." value={testEmailTo} onChange={e => setTestEmailTo(e.target.value)} />
                <button onClick={handleTestEmail} disabled={isTestingEmail} className="btn-secondary flex items-center gap-2">
                  {isTestingEmail ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                  Test
                </button>
              </div>
            </div>
          </div>

          <div className="bento-card">
            <h3 className="font-bold text-xl mb-2">AI key (reads lead e-mails)</h3>
            <p className="text-xs text-brand-gray mb-4">
              A Gemini API key lets the system read the sales-lead e-mails more accurately. Without it, a simpler text matcher is used.
              The key is stored encrypted and is never shown again.
            </p>
            <div className="flex gap-2">
              <input type="password" autoComplete="off" className="input-field flex-1"
                placeholder={aiKeySet ? 'Saved. Type only to replace it' : 'Gemini API key'} value={aiKey} onChange={e => setAiKey(e.target.value)} />
              <button type="button" className="btn-secondary" disabled={!aiKey && !aiKeySet} onClick={() => saveAiKey(aiKey)}>{aiKey ? 'Save' : 'Remove'}</button>
            </div>
          </div>
          </div>

          <div className="space-y-8">
            <div className="bento-card">
              <h3 className="font-bold text-xl mb-6">SLA Configuration (Hours)</h3>
              <div className="space-y-4">
                {localSla.map(s => (
                  <div key={s.priority} className="flex items-center gap-4">
                    <div className="w-24 font-bold text-sm">{s.priority}</div>
                    <input 
                      type="number" 
                      className="input-field w-24" 
                      value={s.hours ?? ''}
                      onChange={e => {
                        const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                        setLocalSla(localSla.map(ls => ls.priority === s.priority ? { ...ls, hours: val } : ls));
                        if (val !== undefined && !isNaN(val)) {
                          adminService.updateSLA(s.priority, val).catch(err => console.error("Auto-save SLA failed:", err));
                        }
                      }}
                    />
                    <span className="text-brand-gray text-sm">hours to resolution</span>
                    <button 
                      onClick={() => handleUpdateSLA(s.priority, s.hours)}
                      className="p-2 text-brand-gray hover:text-brand-red transition-colors"
                      title="Save SLA"
                    >
                      <Save size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="bento-card">
              <h3 className="font-bold text-xl mb-6">Data Backup</h3>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={ticketService.exportTickets} className="btn-secondary flex items-center justify-center gap-2">
                  <Download size={18} /> Export Tickets
                </button>
                <label className="btn-secondary flex items-center justify-center gap-2 cursor-pointer">
                  <Upload size={18} /> Import Tickets
                  <input 
                    type="file" 
                    className="hidden" 
                    accept=".json"
                    onChange={async (e) => {
                      if (e.target.files?.[0]) {
                        await ticketService.importTickets(e.target.files[0]);
                        loadData();
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bento-card p-4">
              <p className="text-[10px] font-bold text-brand-gray uppercase mb-1">Total Sent</p>
              <p className="text-2xl font-bold">{notificationStats.total}</p>
            </div>
            <div className="bento-card p-4">
              <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Success</p>
              <p className="text-2xl font-bold text-emerald-600">{notificationStats.success}</p>
            </div>
            <div className="bento-card p-4">
              <p className="text-[10px] font-bold text-brand-red uppercase mb-1">Failed</p>
              <p className="text-2xl font-bold text-brand-red">{notificationStats.error}</p>
            </div>
            <div className="bento-card p-4">
              <p className="text-[10px] font-bold text-blue-600 uppercase mb-1">Delivery Rate</p>
              <p className="text-2xl font-bold text-blue-600">{notificationStats.rate}%</p>
            </div>
          </div>

          <div className="bento-card">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl flex items-center gap-2">
                <History className="text-brand-red" /> Notification History
              </h3>
              <div className="flex items-center gap-2">
                <button 
                  onClick={async () => {
                    if (window.confirm("CRITICAL WARNING: Are you sure you want to purge ALL notification logs from local storage and Cloud Firestore?")) {
                      try {
                        const res = await fetch('/api/admin/notifications/purge-all', { method: 'POST' });
                        if (res.ok) {
                          alert("All notification logs successfully purged from database and cloud.");
                          loadData();
                        } else {
                          alert("Failed to purge logs.");
                        }
                      } catch (err: any) {
                        alert("Error: " + err.message);
                      }
                    }
                  }}
                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-brand-red border border-red-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                  title="Purge all notification logs"
                >
                  <Trash2 size={13} />
                  <span>Purge Logs</span>
                </button>
                <button 
                  onClick={loadData}
                  className="p-2 hover:bg-black/5 rounded-lg transition-all"
                  title="Refresh Logs"
                >
                  <History size={18} />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-black/5">
                    <th className="pb-3 font-semibold">Timestamp</th>
                    <th className="pb-3 font-semibold">Recipient</th>
                    <th className="pb-3 font-semibold">Subject</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {notificationLogs.map(log => (
                    <tr key={log.id} className="hover:bg-black/5 transition-colors">
                      <td className="py-4 text-xs text-brand-gray">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="py-4 font-medium">{log.to}</td>
                      <td className="py-4 text-xs">{log.subject}</td>
                      <td className="py-4">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 w-fit ${
                          log.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {log.status === 'success' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                          {log.status}
                        </span>
                      </td>
                      <td className="py-4">
                        <div className="max-w-xs">
                          <p className="text-[10px] text-brand-gray truncate">{log.body}</p>
                          {log.error && <p className="text-[10px] text-brand-red mt-1 font-bold italic">{log.error}</p>}
                          {log.ticketId && <p className="text-[10px] text-brand-black mt-1 font-bold">Ticket: {log.ticketId}</p>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {notificationLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-brand-gray italic">No notification history found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'styling' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            {/* Theme Presets */}
            <div className="bento-card xl:col-span-1">
              <h3 className="font-bold text-xl mb-6 flex items-center gap-2">
                <Palette className="text-brand-red" /> Theme Presets
              </h3>
              <div className="grid grid-cols-1 gap-4">
                {[
                  { id: 'glass', name: 'Crystal Glass', desc: 'Modern glassmorphism', primary: '#A6192E' },
                  { id: 'dark', name: 'Midnight Oracle', desc: 'Sleek dark mode', primary: '#A6192E' },
                  { id: 'light', name: 'Classic Fusion', desc: 'Clean professional look', primary: '#A6192E' },
                  { id: 'corporate', name: 'Enterprise Pro', desc: 'Strict corporate style', primary: '#2D2926' }
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => updateSettings({
                      ...settings,
                      theme: t.id as any,
                      primaryColor: t.primary,
                      backgroundEffect: t.id === 'corporate' ? 'grid' : 'all',
                      glassIntensity: t.id === 'glass' ? 80 : 40,
                      borderRadius: t.id === 'corporate' ? 'md' : 'xl'
                    })}
                    className={`p-4 rounded-2xl border text-left transition-all hover:scale-[1.02] active:scale-[0.98] ${
                      settings.theme === t.id 
                        ? 'border-brand-red bg-brand-red/5 shadow-lg shadow-brand-red/10' 
                        : 'border-black/5 bg-white/50 hover:border-brand-red/30'
                    }`}
                  >
                    <p className="font-bold text-brand-black">{t.name}</p>
                    <p className="text-[10px] text-brand-gray uppercase tracking-wider">{t.desc}</p>
                  </button>
                ))}
              </div>

              <div className="mt-8 pt-6 border-t border-black/5 space-y-6">
                <div>
                  <h4 className="text-xs font-bold uppercase text-brand-gray mb-4">Primary Brand Color</h4>
                  <div className="flex gap-3 flex-wrap">
                    {['#A6192E', '#2D2926', '#0070d2', '#2e844a', '#f2a900', '#6b3c9b'].map(c => (
                      <button
                        key={c}
                        onClick={() => updateSettings({ ...settings, primaryColor: c })}
                        className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${
                          settings.primaryColor === c ? 'border-brand-black scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <input 
                      type="color" 
                      value={settings.primaryColor}
                      onChange={(e) => updateSettings({ ...settings, primaryColor: e.target.value })}
                      className="w-8 h-8 rounded-full border-none p-0 cursor-pointer overflow-hidden"
                    />
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase text-brand-gray mb-4">App Background Color</h4>
                  <div className="flex gap-3 flex-wrap">
                    {['#F2F2F2', '#FFFFFF', '#2D2926', '#1A1A1A', '#0F172A', '#000000'].map(c => (
                      <button
                        key={c}
                        onClick={() => updateSettings({ ...settings, backgroundColor: c })}
                        className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${
                          settings.backgroundColor === c ? 'border-brand-red scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <input 
                      type="color" 
                      value={settings.backgroundColor}
                      onChange={(e) => updateSettings({ ...settings, backgroundColor: e.target.value })}
                      className="w-8 h-8 rounded-full border-none p-0 cursor-pointer overflow-hidden"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Typography & Layout */}
            <div className="bento-card xl:col-span-1">
              <h3 className="font-bold text-xl mb-6 flex items-center gap-2">
                <Type className="text-brand-red" /> Typography & Layout
              </h3>
              
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-brand-gray">Font Family</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Inter', 'Roboto', 'JetBrains Mono', 'Playfair Display'].map(f => (
                      <button
                        key={f}
                        onClick={() => updateSettings({ ...settings, fontFamily: f as any })}
                        className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                          settings.fontFamily === f 
                            ? 'bg-brand-red text-white border-brand-red' 
                            : 'bg-white/50 text-brand-black border-black/5 hover:border-brand-red/30'
                        }`}
                        style={{ fontFamily: f === 'Inter' ? 'Inter' : f === 'Roboto' ? 'Roboto' : f === 'JetBrains Mono' ? 'JetBrains Mono' : 'Playfair Display' }}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-brand-gray">Font Size</label>
                  <div className="flex gap-2">
                    {['xs', 'sm', 'base', 'lg', 'xl'].map(s => (
                      <button
                        key={s}
                        onClick={() => updateSettings({ ...settings, fontSize: s as any })}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                          settings.fontSize === s 
                            ? 'bg-brand-red text-white border-brand-red' 
                            : 'bg-white/50 text-brand-black border-black/5 hover:border-brand-red/30'
                        }`}
                      >
                        {s.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-brand-gray">Border Radius</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['none', 'md', 'xl', '2xl', 'full'].map(r => (
                      <button
                        key={r}
                        onClick={() => updateSettings({ ...settings, borderRadius: r as any })}
                        className={`py-2 rounded-xl text-[10px] font-bold uppercase border transition-all ${
                          settings.borderRadius === r 
                            ? 'bg-brand-red text-white border-brand-red' 
                            : 'bg-white/50 text-brand-black border-black/5 hover:border-brand-red/30'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-brand-gray">Glass Intensity</label>
                    <span className="text-xs font-bold text-brand-red">{settings.glassIntensity}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={settings.glassIntensity}
                    onChange={(e) => updateSettings({ ...settings, glassIntensity: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-black/5 rounded-lg appearance-none cursor-pointer accent-brand-red"
                  />
                </div>
              </div>
            </div>

            {/* Background & Effects */}
            <div className="bento-card xl:col-span-1">
              <h3 className="font-bold text-xl mb-6 flex items-center gap-2">
                <Sparkles className="text-brand-red" /> Background & Effects
              </h3>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-brand-gray">Active Effects</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'none', name: 'None' },
                      { id: 'particles', name: 'Particles' },
                      { id: 'grid', name: 'Tech Grid' },
                      { id: 'orbs', name: 'Gradient Orbs' },
                      { id: 'all', name: 'All Effects' }
                    ].map(e => (
                      <button
                        key={e.id}
                        onClick={() => updateSettings({ ...settings, backgroundEffect: e.id as any })}
                        className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                          settings.backgroundEffect === e.id 
                            ? 'bg-brand-red text-white border-brand-red' 
                            : 'bg-white/50 text-brand-black border-black/5 hover:border-brand-red/30'
                        }`}
                      >
                        {e.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-brand-gray">Effect Color</label>
                  <div className="flex gap-3 flex-wrap">
                    {['#A6192E', '#FFFFFF', '#2D2926', '#0070d2', '#2e844a', '#f2a900'].map(c => (
                      <button
                        key={c}
                        onClick={() => updateSettings({ ...settings, effectColor: c })}
                        className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110 ${
                          settings.effectColor === c ? 'border-brand-red scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <input 
                      type="color" 
                      value={settings.effectColor}
                      onChange={(e) => updateSettings({ ...settings, effectColor: e.target.value })}
                      className="w-6 h-6 rounded-full border-none p-0 cursor-pointer overflow-hidden"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-brand-gray">Grid Pattern</label>
                  <div className="flex gap-2">
                    {['lines', 'dots', 'cross'].map(p => (
                      <button
                        key={p}
                        onClick={() => updateSettings({ ...settings, gridPattern: p as any })}
                        className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase border transition-all ${
                          settings.gridPattern === p 
                            ? 'bg-brand-red text-white border-brand-red' 
                            : 'bg-white/50 text-brand-black border-black/5 hover:border-brand-red/30'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-brand-gray">Particle Shape</label>
                  <div className="flex gap-2">
                    {['circle', 'square', 'star'].map(s => (
                      <button
                        key={s}
                        onClick={() => updateSettings({ ...settings, particleShape: s as any })}
                        className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase border transition-all ${
                          settings.particleShape === s 
                            ? 'bg-brand-red text-white border-brand-red' 
                            : 'bg-white/50 text-brand-black border-black/5 hover:border-brand-red/30'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-brand-gray">Effect Intensity</label>
                    <span className="text-xs font-bold text-brand-red">{settings.backgroundIntensity}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={settings.backgroundIntensity}
                    onChange={(e) => updateSettings({ ...settings, backgroundIntensity: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-black/5 rounded-lg appearance-none cursor-pointer accent-brand-red"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-brand-gray">Animation Speed</label>
                  <div className="flex gap-2">
                    {['slow', 'normal', 'fast'].map(s => (
                      <button
                        key={s}
                        onClick={() => updateSettings({ ...settings, animationSpeed: s as any })}
                        className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase border transition-all ${
                          settings.animationSpeed === s 
                            ? 'bg-brand-red text-white border-brand-red' 
                            : 'bg-white/50 text-brand-black border-black/5 hover:border-brand-red/30'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-brand-red/5 rounded-2xl border border-brand-red/10">
                  <div className="flex items-center gap-2 text-brand-red font-bold text-xs mb-2">
                    <ShieldCheck size={14} /> Global Sync Active
                  </div>
                  <p className="text-[10px] text-brand-gray leading-relaxed">
                    These styling settings are applied globally. All users will see the changes immediately upon their next session or page refresh.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PermissionToggle: React.FC<{ label: string, active: boolean, onChange: (val: boolean) => void }> = ({ label, active, onChange }) => (
  <button 
    onClick={() => onChange(!active)}
    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 border ${
      active 
        ? 'bg-brand-red/10 border-brand-red/20 text-brand-red' 
        : 'bg-black/5 border-transparent text-brand-gray hover:border-black/10'
    }`}
  >
    {active ? <CheckSquare size={12} /> : <Eye size={12} className="opacity-50" />}
    {label}
  </button>
);
