// import * as React from 'react'
import { motion } from 'framer-motion'
import { useDaemonData } from '@/hooks/useDaemonData'
import { Badge } from '@/components/ui/Badge'
import { Play, Plus, Trash2, Zap, Terminal, Activity } from 'lucide-react'

export function WorkflowsTable() {
  const { data: rules, loading, error } = useDaemonData<any[]>('/orchestrator/rules', 5000);

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    try {
      const res = await fetch(`http://localhost:9876/orchestrator/rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete rule');
      window.location.reload(); // Simple refresh for now
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRun = async (rule: any) => {
    try {
      const res = await fetch(`http://localhost:9876/msg/${encodeURIComponent(rule.channelPattern)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { triggeredBy: 'dashboard' }, sender: 'DASHBOARD' })
      });
      if (!res.ok) throw new Error('Failed to trigger rule');
      alert(`Published trigger to ${rule.channelPattern}`);
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) return <motion.div className="p-8 text-center opacity-50 font-black uppercase tracking-widest text-[10px] font-sans">Hailing Pipelines...</motion.div>;
  if (error) return <motion.div className="p-8 text-center text-[var(--p-red-400)] font-bold font-sans">Harbor Error: {error}</motion.div>;

  return (
    <motion.div className="flex flex-col h-full bg-[var(--surface-raised)] rounded-3xl border border-[var(--border-default)] overflow-hidden shadow-sm font-sans">
      <motion.div className="px-8 py-6 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-overlay)] font-sans">
        <motion.div className="font-sans">
          <motion.h2 className="text-lg font-bold flex items-center gap-2 font-display">
            <Zap size={20} className="text-[var(--brand-accent)]" />
            Reactive Pipelines
          </motion.h2>
          <motion.p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-widest mt-1 font-sans">
            Event-driven agent orchestration
          </motion.p>
        </motion.div>
        <motion.button 
          className="px-4 py-2 rounded-xl bg-[var(--brand-primary)] text-[var(--surface-base)] text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-[var(--brand-primary)]/20 font-sans"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Plus size={16} /> New Rule
        </motion.button>
      </motion.div>

      <motion.div className="flex-1 overflow-y-auto font-sans">
        <motion.table className="w-full text-left border-collapse font-sans">
          <motion.thead className="font-sans">
            <motion.tr className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-[var(--border-subtle)] font-sans">
              <motion.th className="px-8 py-4 font-sans">Status</motion.th>
              <motion.th className="px-4 py-4 font-sans">Rule Name</motion.th>
              <motion.th className="px-4 py-4 font-sans">Trigger (Channel)</motion.th>
              <motion.th className="px-4 py-4 font-sans">Action</motion.th>
              <motion.th className="px-8 py-4 text-right font-sans">Control</motion.th>
            </motion.tr>
          </motion.thead>
          <motion.tbody className="divide-y divide-[var(--border-subtle)] font-sans">
            {(rules || []).map((rule) => (
              <motion.tr 
                key={rule.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="group hover:bg-[var(--surface-overlay)] transition-colors font-sans"
              >
                <motion.td className="px-8 py-5 font-sans">
                  <motion.div className={`w-2.5 h-2.5 rounded-full ${rule.enabled ? 'bg-[var(--status-success)] shadow-[0_0_8px_var(--status-success)]' : 'bg-[var(--text-muted)]'}`} />
                </motion.td>
                <motion.td className="px-4 py-5 font-sans">
                  <motion.span className="font-bold text-sm font-sans" style={{ color: 'var(--text-primary)' }}>{rule.name}</motion.span>
                </motion.td>
                <motion.td className="px-4 py-5 font-sans">
                  <motion.code className="px-2 py-1 rounded bg-[var(--surface-overlay)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--brand-primary)]">
                    {rule.channelPattern}
                  </motion.code>
                </motion.td>
                <motion.td className="px-4 py-5 font-sans">
                  <motion.div className="flex items-center gap-2 font-sans">
                    {rule.action === 'spawn' ? (
                      <Badge variant="teal" className="flex items-center gap-1.5 py-1 px-3 font-sans">
                        <Activity size={12} /> pd spawn
                      </Badge>
                    ) : (
                      <Badge variant="default" className="flex items-center gap-1.5 py-1 px-3 font-sans">
                        <Terminal size={12} /> exec
                      </Badge>
                    )}
                  </motion.div>
                </motion.td>
                <motion.td className="px-8 py-5 text-right font-sans">
                  <motion.div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity font-sans">
                    <motion.button 
                      onClick={() => handleRun(rule)}
                      className="p-2 rounded-lg hover:bg-[var(--interactive-active)] text-[var(--text-muted)] hover:text-[var(--brand-primary)] transition-colors font-sans"
                      title="Trigger manually"
                      whileHover={{ scale: 1.1 }}
                    >
                      <Play size={16} />
                    </motion.button>
                    <motion.button 
                      onClick={() => handleDelete(rule.id)}
                      className="p-2 rounded-lg hover:bg-[var(--status-error)]/10 text-[var(--text-muted)] hover:text-[var(--status-error)] transition-colors font-sans"
                      title="Delete rule"
                      whileHover={{ scale: 1.1 }}
                    >
                      <Trash2 size={16} />
                    </motion.button>
                  </motion.div>
                </motion.td>
              </motion.tr>
            ))}
            {(!rules || rules.length === 0) && (
              <motion.tr className="font-sans">
                <motion.td colSpan={5} className="px-8 py-20 text-center text-[var(--text-muted)] font-sans">
                  <motion.div className="flex flex-col items-center gap-4 opacity-40 font-sans">
                    <Zap size={48} />
                    <motion.p className="text-sm font-medium font-sans">No reactive pipelines defined yet.</motion.p>
                  </motion.div>
                </motion.td>
              </motion.tr>
            )}
          </motion.tbody>
        </motion.table>
      </motion.div>
    </motion.div>
  )
}
