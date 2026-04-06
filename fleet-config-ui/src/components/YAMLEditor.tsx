import { useState, useEffect, useCallback } from 'react';
import { parse as parseYaml } from 'yaml';
import { fetchFleetConfig, saveFleetConfig } from '../api';
import type { TopologyValidation } from '../types';

interface Props {
  project: string;
  onSaved: () => void;
}

export default function YAMLEditor({ project, onSaved }: Props) {
  const [yaml, setYaml] = useState('');
  const [originalYaml, setOriginalYaml] = useState('');
  const [path, setPath] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [topology, setTopology] = useState<TopologyValidation | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const loadYaml = useCallback(async () => {
    try {
      const config = await fetchFleetConfig(project);
      setYaml(config.yaml);
      setOriginalYaml(config.yaml);
      setPath(config.path);
      setTopology(config.topology);
    } catch { /* will show empty */ }
  }, [project]);

  useEffect(() => { loadYaml(); }, [loadYaml]);

  // Live validation
  useEffect(() => {
    try {
      const parsed = parseYaml(yaml);
      if (!parsed || typeof parsed !== 'object') {
        setParseError('YAML did not parse to an object');
      } else {
        setParseError(null);
      }
    } catch (err) {
      setParseError((err as Error).message);
    }
  }, [yaml]);

  const handleSave = async () => {
    if (parseError) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const result = await saveFleetConfig(project, yaml);
      if (result.cycles?.length > 0) {
        setSaveResult(`Saved with ${result.cycles.length} cycle warning(s)`);
      } else {
        setSaveResult('Saved & reloaded');
      }
      setOriginalYaml(yaml);
      onSaved();
      // Refresh topology
      const config = await fetchFleetConfig(project);
      setTopology(config.topology);
    } catch (err) {
      setSaveResult(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const isDirty = yaml !== originalYaml;

  return (
    <div className="p-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-semibold tracking-wider opacity-30 mb-0.5" style={{ color: 'var(--pd-text)' }}>YAML</div>
          <div className="text-[10px] font-mono opacity-30" style={{ color: 'var(--pd-text)' }}>{path}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={loadYaml}
            className="px-2 py-1 rounded text-[10px]"
            style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
            Revert
          </button>
          <button onClick={handleSave} disabled={!isDirty || !!parseError || saving}
            className="px-3 py-1 rounded text-[10px] font-semibold"
            style={{ backgroundColor: isDirty && !parseError ? 'var(--pd-accent)' : 'var(--pd-bg)',
              color: isDirty && !parseError ? 'var(--pd-bg)' : 'var(--pd-muted)',
              border: '1px solid var(--pd-border)', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving...' : 'Save & Reload'}
          </button>
        </div>
      </div>

      {/* Errors/warnings */}
      {parseError && (
        <div className="text-[10px] px-3 py-2 rounded mb-2" style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}>
          Parse error: {parseError}
        </div>
      )}
      {topology && !topology.valid && (
        <div className="text-[10px] px-3 py-2 rounded mb-2" style={{ backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' }}>
          Cycle detected: {topology.cycles.map(c => c.join(' → ')).join('; ')}
        </div>
      )}
      {topology?.warnings && topology.warnings.length > 0 && (
        <div className="text-[10px] px-3 py-2 rounded mb-2" style={{ backgroundColor: 'var(--pd-surface-2)', color: 'var(--pd-dim)', border: '1px solid var(--pd-border)' }}>
          {topology.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}
      {saveResult && (
        <div className="text-[10px] px-3 py-2 rounded mb-2 opacity-70" style={{ color: saveResult.startsWith('Error') ? 'var(--pd-accent)' : 'var(--pd-success)' }}>
          {saveResult}
        </div>
      )}

      {/* Editor */}
      <textarea value={yaml} onChange={e => setYaml(e.target.value)}
        className="flex-1 rounded p-3 font-mono text-[11px] leading-relaxed resize-none"
        style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)',
          tabSize: 2, whiteSpace: 'pre', overflowWrap: 'normal' }}
        spellCheck={false}
      />
    </div>
  );
}
